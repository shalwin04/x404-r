# x404-r Deployment Guide

## Production Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         PRODUCTION STACK                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   ┌─────────────────┐         ┌─────────────────────────────────────┐  │
│   │     Vercel      │         │            AWS                      │  │
│   │   (Dashboard)   │         │  ┌─────────────┐  ┌─────────────┐  │  │
│   │                 │────────▶│  │ API Gateway │──│ Supervisor  │  │  │
│   │   Next.js       │  HTTPS  │  └─────────────┘  │   Lambda    │  │  │
│   └─────────────────┘         │                   └──────┬──────┘  │  │
│                               │                          │         │  │
│                               │  ┌─────────────┐         │         │  │
│                               │  │ EventBridge │         │         │  │
│                               │  │ (10s poll)  │         │         │  │
│                               │  └──────┬──────┘         │         │  │
│                               │         │                │         │  │
│                               │         ▼                │         │  │
│                               │  ┌─────────────┐         │         │  │
│                               │  │   Worker    │         │         │  │
│                               │  │   Lambda    │◀────────┘         │  │
│                               │  └──────┬──────┘                   │  │
│                               └─────────┼──────────────────────────┘  │
│                                         │                              │
│                                         ▼                              │
│                               ┌─────────────────┐                      │
│                               │  CockroachDB    │                      │
│                               │     Cloud       │                      │
│                               └─────────────────┘                      │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## 1. CockroachDB Cloud

### Create Free Cluster

1. Go to https://cockroachlabs.cloud
2. Sign up (free, no credit card)
3. Create cluster → Select "Serverless" (free tier)
4. Choose region closest to your Lambda (e.g., `us-east-1`)
5. Click "Connect" → Copy connection string

### Initialize Database

```bash
# Connect to your cluster
cockroach sql --url "YOUR_CONNECTION_STRING"

# Run setup script
\i scripts/setup-db.sql
```

Or via psql:
```bash
psql "YOUR_CONNECTION_STRING" -f scripts/setup-db.sql
```

## 2. AWS Lambda Deployment

### Prerequisites

```bash
# Install AWS CLI
curl "https://awscli.amazonaws.com/AWSCLIV2.pkg" -o "AWSCLIV2.pkg"
sudo installer -pkg AWSCLIV2.pkg -target /

# Configure credentials
aws configure
# AWS Access Key ID: YOUR_KEY
# AWS Secret Access Key: YOUR_SECRET
# Default region: us-east-1
# Default output format: json

# Install CDK
npm install -g aws-cdk

# Verify
aws sts get-caller-identity
cdk --version
```

### Store Secrets

```bash
# Database connection string
aws secretsmanager create-secret \
  --name x404-r/database-url \
  --description "CockroachDB connection string" \
  --secret-string "postgresql://user:pass@host:26257/x404r?sslmode=verify-full" \
  --region us-east-1

# AI API key
aws secretsmanager create-secret \
  --name x404-r/gemini-api-key \
  --description "Gemini API key for AI inference" \
  --secret-string "your-gemini-api-key" \
  --region us-east-1

# Verify secrets created
aws secretsmanager list-secrets --region us-east-1
```

### Build & Deploy

```bash
# Build worker packages
cd packages/worker
npm install
npm run build

cd ../supervisor
npm install
npm run build

# Deploy infrastructure
cd ../../infrastructure
npm install

# Bootstrap CDK (first time only)
npx cdk bootstrap

# Deploy
npx cdk deploy CrashProofStack \
  --parameters databaseSecretArn=arn:aws:secretsmanager:us-east-1:ACCOUNT:secret:x404-r/database-url \
  --parameters geminiApiKeySecretArn=arn:aws:secretsmanager:us-east-1:ACCOUNT:secret:x404-r/gemini-api-key

# Note the outputs:
# CrashProofStack.ApiUrl = https://xxxxx.execute-api.us-east-1.amazonaws.com/prod
```

### Verify Lambda Deployment

```bash
# Test health endpoint
curl https://YOUR_API_URL/prod/ready
# Expected: OK

# Test job creation
curl -X POST https://YOUR_API_URL/prod/jobs/demo \
  -H "Content-Type: application/json"

# Check CloudWatch logs
aws logs tail /aws/lambda/CrashProofStack-WorkerLambda --follow
```

## 3. Vercel Deployment (Dashboard)

### Deploy

```bash
cd packages/dashboard

# Install Vercel CLI
npm install -g vercel

# Login
vercel login

# Deploy
vercel deploy --prod
```

### Set Environment Variables

Via Vercel Dashboard:
1. Go to your project settings
2. Navigate to "Environment Variables"
3. Add:
   - `NEXT_PUBLIC_API_URL` = `https://YOUR_API_GATEWAY_URL/prod`

Via CLI:
```bash
vercel env add NEXT_PUBLIC_API_URL production
# Enter your API Gateway URL
```

### Custom Domain (Optional)

```bash
vercel domains add x404r.yourdomain.com
```

## 4. SDK Installation

Once deployed, users can install the SDK:

```bash
npm install @shalwin04/x404r-sdk
```

### Embedded Mode (Self-hosted)
```typescript
import { x404r } from '@shalwin04/x404r-sdk';

const runtime = await new x404r({
  mode: 'embedded',
  connectionString: process.env.DATABASE_URL,
  ai: { provider: 'gemini', apiKey: process.env.GEMINI_API_KEY }
}).ready();
```

### Cloud Mode (Use your Lambda API)
```typescript
import { x404r } from '@shalwin04/x404r-sdk';

const runtime = new x404r({
  mode: 'cloud',
  apiKey: 'your-api-key',
  baseUrl: 'https://YOUR_API_GATEWAY_URL/prod'
});

const job = await runtime.submit('workflow-name', { input: 'data' });
```

## 5. Monitoring

### CloudWatch Dashboards

```bash
# View Lambda metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Invocations \
  --dimensions Name=FunctionName,Value=CrashProofStack-WorkerLambda \
  --start-time $(date -u -v-1H +%Y-%m-%dT%H:%M:%SZ) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 300 \
  --statistics Sum
```

### CockroachDB Console

- Go to https://cockroachlabs.cloud
- Select your cluster
- View SQL Activity, Metrics, and Insights

## Troubleshooting

### Lambda Timeout
```bash
# Increase timeout (default 5 min max)
aws lambda update-function-configuration \
  --function-name CrashProofStack-WorkerLambda \
  --timeout 300
```

### Database Connection Issues
```bash
# Test connection from local
psql "YOUR_CONNECTION_STRING" -c "SELECT 1"

# Check Lambda can reach CockroachDB
# Ensure security groups allow outbound HTTPS
```

### Vercel Build Failures
```bash
# Clear cache and redeploy
vercel --force
```

## Cost Estimates

| Service | Free Tier | Estimated Monthly |
|---------|-----------|-------------------|
| CockroachDB Serverless | 10GB, 50M RUs | $0 |
| AWS Lambda | 1M requests | $0-5 |
| API Gateway | 1M requests | $0-3 |
| Vercel | 100GB bandwidth | $0 |
| **Total** | | **$0-10/month** |
