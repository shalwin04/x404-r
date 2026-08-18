#!/bin/bash
# ============================================
# x404-r Manual Lambda Deployment Script
# ============================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║           x404-r Lambda Deployment Script                     ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

# Configuration - UPDATE THESE!
AWS_REGION="${AWS_REGION:-us-east-1}"
AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:-}"

# Check if AWS CLI is configured
if ! aws sts get-caller-identity &>/dev/null; then
  echo -e "${RED}❌ AWS CLI not configured. Run 'aws configure' first.${NC}"
  exit 1
fi

# Get account ID if not set
if [ -z "$AWS_ACCOUNT_ID" ]; then
  AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
fi

echo -e "${BLUE}AWS Account: $AWS_ACCOUNT_ID${NC}"
echo -e "${BLUE}AWS Region: $AWS_REGION${NC}"
echo ""

# ============================================
# Step 1: Build Lambda packages
# ============================================
echo -e "${YELLOW}📦 Building Lambda packages...${NC}"

cd "$(dirname "$0")/.."

# Build worker
echo "  Building worker..."
cd packages/worker
npm install --silent
npm run build --silent 2>/dev/null || true

# Create zip (include node_modules for dependencies)
rm -f worker-lambda.zip
cd dist
zip -rq ../worker-lambda.zip . 2>/dev/null
cd ..
echo -e "  ${GREEN}✓ Worker built: packages/worker/worker-lambda.zip${NC}"

# Build supervisor
echo "  Building supervisor..."
cd ../supervisor
npm install --silent
npm run build --silent 2>/dev/null || true

rm -f supervisor-lambda.zip
cd dist
zip -rq ../supervisor-lambda.zip . 2>/dev/null
cd ..
echo -e "  ${GREEN}✓ Supervisor built: packages/supervisor/supervisor-lambda.zip${NC}"

cd ../..

# ============================================
# Step 2: Create/Update IAM Role
# ============================================
echo ""
echo -e "${YELLOW}🔐 Setting up IAM role...${NC}"

ROLE_NAME="x404r-lambda-role"
ROLE_ARN="arn:aws:iam::${AWS_ACCOUNT_ID}:role/${ROLE_NAME}"

# Check if role exists
if aws iam get-role --role-name $ROLE_NAME &>/dev/null; then
  echo -e "  ${GREEN}✓ IAM role already exists${NC}"
else
  echo "  Creating IAM role..."

  cat > /tmp/trust-policy.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "lambda.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

  aws iam create-role \
    --role-name $ROLE_NAME \
    --assume-role-policy-document file:///tmp/trust-policy.json \
    --region $AWS_REGION >/dev/null

  aws iam attach-role-policy \
    --role-name $ROLE_NAME \
    --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

  aws iam attach-role-policy \
    --role-name $ROLE_NAME \
    --policy-arn arn:aws:iam::aws:policy/SecretsManagerReadWrite

  # Wait for role to propagate
  echo "  Waiting for IAM role to propagate..."
  sleep 10

  echo -e "  ${GREEN}✓ IAM role created${NC}"
fi

# ============================================
# Step 3: Create/Update Worker Lambda
# ============================================
echo ""
echo -e "${YELLOW}⚡ Deploying Worker Lambda...${NC}"

WORKER_NAME="x404r-worker"

if aws lambda get-function --function-name $WORKER_NAME --region $AWS_REGION &>/dev/null; then
  echo "  Updating existing function..."
  aws lambda update-function-code \
    --function-name $WORKER_NAME \
    --zip-file fileb://packages/worker/worker-lambda.zip \
    --region $AWS_REGION >/dev/null
  echo -e "  ${GREEN}✓ Worker Lambda updated${NC}"
else
  echo "  Creating new function..."
  aws lambda create-function \
    --function-name $WORKER_NAME \
    --runtime nodejs20.x \
    --role $ROLE_ARN \
    --handler handler.handler \
    --zip-file fileb://packages/worker/worker-lambda.zip \
    --timeout 300 \
    --memory-size 1024 \
    --region $AWS_REGION >/dev/null
  echo -e "  ${GREEN}✓ Worker Lambda created${NC}"
fi

# ============================================
# Step 4: Create/Update Supervisor Lambda
# ============================================
echo ""
echo -e "${YELLOW}⚡ Deploying Supervisor Lambda...${NC}"

SUPERVISOR_NAME="x404r-supervisor"

if aws lambda get-function --function-name $SUPERVISOR_NAME --region $AWS_REGION &>/dev/null; then
  echo "  Updating existing function..."
  aws lambda update-function-code \
    --function-name $SUPERVISOR_NAME \
    --zip-file fileb://packages/supervisor/supervisor-lambda.zip \
    --region $AWS_REGION >/dev/null
  echo -e "  ${GREEN}✓ Supervisor Lambda updated${NC}"
else
  echo "  Creating new function..."
  aws lambda create-function \
    --function-name $SUPERVISOR_NAME \
    --runtime nodejs20.x \
    --role $ROLE_ARN \
    --handler handler.handler \
    --zip-file fileb://packages/supervisor/supervisor-lambda.zip \
    --timeout 120 \
    --memory-size 1024 \
    --region $AWS_REGION >/dev/null
  echo -e "  ${GREEN}✓ Supervisor Lambda created${NC}"
fi

# ============================================
# Step 5: Create EventBridge Rule
# ============================================
echo ""
echo -e "${YELLOW}⏰ Setting up EventBridge...${NC}"

RULE_NAME="x404r-worker-poll"

if aws events describe-rule --name $RULE_NAME --region $AWS_REGION &>/dev/null; then
  echo -e "  ${GREEN}✓ EventBridge rule already exists${NC}"
else
  aws events put-rule \
    --name $RULE_NAME \
    --schedule-expression "rate(1 minute)" \
    --state ENABLED \
    --region $AWS_REGION >/dev/null

  aws lambda add-permission \
    --function-name $WORKER_NAME \
    --statement-id eventbridge-invoke \
    --action lambda:InvokeFunction \
    --principal events.amazonaws.com \
    --source-arn arn:aws:events:${AWS_REGION}:${AWS_ACCOUNT_ID}:rule/${RULE_NAME} \
    --region $AWS_REGION 2>/dev/null || true

  aws events put-targets \
    --rule $RULE_NAME \
    --targets "Id"="1","Arn"="arn:aws:lambda:${AWS_REGION}:${AWS_ACCOUNT_ID}:function:${WORKER_NAME}","Input"="{\"action\":\"process\"}" \
    --region $AWS_REGION >/dev/null

  echo -e "  ${GREEN}✓ EventBridge rule created (triggers every 1 minute)${NC}"
fi

# ============================================
# Summary
# ============================================
echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║                    DEPLOYMENT COMPLETE                        ║"
echo "╠═══════════════════════════════════════════════════════════════╣"
echo "║                                                               ║"
echo "║  Lambda Functions:                                            ║"
echo "║  ├── x404r-worker     (EventBridge trigger)                   ║"
echo "║  └── x404r-supervisor (needs API Gateway)                     ║"
echo "║                                                               ║"
echo "║  Next Steps:                                                  ║"
echo "║  1. Create API Gateway in AWS Console                         ║"
echo "║  2. Add environment variables to Lambdas:                     ║"
echo "║     - DATABASE_URL: your CockroachDB connection string        ║"
echo "║     - GEMINI_API_KEY: your Gemini API key                     ║"
echo "║  3. Deploy dashboard to Vercel                                ║"
echo "║                                                               ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""
echo -e "${BLUE}View Lambda logs:${NC}"
echo "  aws logs tail /aws/lambda/x404r-worker --follow"
echo "  aws logs tail /aws/lambda/x404r-supervisor --follow"
echo ""
