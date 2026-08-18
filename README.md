# x404-r

**The runtime where context is never lost.**

> _404 - Not Found?_ Not anymore. x404-r ensures your AI agents never lose their place, even when workers crash mid-execution.

x404-r is database-native infrastructure for crash-proof AI agents. Built on CockroachDB, it transforms your database into a durable runtime where agent state survives any failure.

Transform CockroachDB into a runtime for AI agents. State lives in the database, not in memory. Workers can die anytime - agents resume exactly where they left off.

## The Problem

Long-running AI agents lose context when:

- Workers crash mid-task
- Memory limits are hit
- Deployments restart
- Network connections drop

**Result:** Hours of work lost. Tasks restart from zero. Context = 404 Not Found.

## The Solution: x404-r

State lives in CockroachDB, not memory. Workers are stateless. Kill one, another picks up exactly where it left off.

```
Context? Always found. Progress? Never lost. Agents? Crash-proof.
```

## Project Status

| Component               | Status      | Description                                           |
| ----------------------- | ----------- | ----------------------------------------------------- |
| **Core SDK**            | ✅ Complete | `@shalwin04/x404r-sdk` - TypeScript SDK for crash-proof agents |
| **One-Line API**        | ✅ Complete | `durable()` function for instant crash-proofing       |
| **Database Schema**     | ✅ Complete | Multi-tenant schema with checkpoints, memory vectors  |
| **Multi-Tenancy**       | ✅ Complete | Tenant isolation, API key auth, usage tracking        |
| **AI Integration**      | ✅ Complete | Gemini, OpenAI, Anthropic, **AWS Bedrock** support    |
| **Time Travel**         | ✅ Complete | Replay workflows from any checkpoint                  |
| **Cost Tracking**       | ✅ Complete | Token usage tracking, cost transparency               |
| **Dashboard**           | ✅ Complete | React Flow visualization, usage & settings pages      |
| **Worker System**       | ✅ Complete | Task claiming, heartbeats, crash recovery             |
| **Priority Scheduling** | ✅ Complete | Enterprise > Team > Pro > Free tenant priority        |
| **AWS Deployment**      | 🔧 Ready    | Lambda handlers ready for deployment                  |
| **GitHub OAuth**        | ✅ Complete | Session management, user auth                         |

### Hackathon Requirements

| Requirement | Implementation |
|-------------|----------------|
| **CockroachDB (2+ tools)** | ✅ FOR UPDATE SKIP LOCKED, Distributed Transactions, Vector Storage |
| **AWS (1+ services)** | ✅ Lambda (workers), API Gateway, EventBridge, Secrets Manager, Bedrock (optional) |

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        x404-r Runtime                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐    │
│  │   Your App   │     │   Dashboard  │     │  Admin Panel │    │
│  │              │     │  (React Flow)│     │              │    │
│  └──────┬───────┘     └──────┬───────┘     └──────┬───────┘    │
│         │                    │                    │             │
│         ▼                    ▼                    ▼             │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                      @shalwin04/x404r-sdk                         │   │
│  │  ┌─────────┐  ┌──────────┐  ┌────────┐  ┌───────────┐  │   │
│  │  │ x404r   │  │ Workflow │  │ Worker │  │ AIProvider│  │   │
│  │  │ Client  │  │ Builder  │  │        │  │           │  │   │
│  │  └─────────┘  └──────────┘  └────────┘  └───────────┘  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│                              ▼                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                      CockroachDB                         │   │
│  │  ┌─────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐ │   │
│  │  │  jobs   │ │task_nodes │ │checkpoints│ │  memory   │ │   │
│  │  │         │ │           │ │           │ │ _vectors  │ │   │
│  │  └─────────┘ └───────────┘ └───────────┘ └───────────┘ │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Why CockroachDB?

| Feature                  | How x404-r Uses It                        |
| ------------------------ | ----------------------------------------- |
| `FOR UPDATE SKIP LOCKED` | Atomic task claiming - no race conditions |
| Multi-region             | Deploy workers close to data              |
| Transactions             | Consistent checkpoints across crashes     |
| JSON columns             | Flexible agent state storage              |
| Horizontal scale         | Handle millions of agent tasks            |

## Quick Start

### 1. Install the SDK

```bash
npm install @shalwin04/x404r-sdk
```

### 2. Create a Crash-Proof Agent

```typescript
import { x404r } from "@shalwin04/x404r-sdk";

// Initialize the runtime
const runtime = await new x404r({
  connectionString: process.env.DATABASE_URL,
  ai: {
    provider: "gemini",
    apiKey: process.env.GEMINI_API_KEY,
  },
}).ready();

// Define a workflow - context is NEVER lost
const processDocuments = runtime.workflow("process-docs", {
  steps: [
    {
      name: "extract",
      handler: async (ctx) => {
        const docs = ctx.input.documents;

        // Resume from last checkpoint if we crashed
        let processed = ctx.state.processed || 0;

        for (let i = processed; i < docs.length; i++) {
          const result = await ctx.ai.generate(`Extract data from: ${docs[i]}`);

          // Checkpoint - survives any crash!
          await ctx.checkpoint({
            processed: i + 1,
            results: [...(ctx.state.results || []), result],
          });
        }

        return { extracted: ctx.state.results };
      },
    },
    {
      name: "summarize",
      dependsOn: ["extract"],
      handler: async (ctx) => {
        const summary = await ctx.ai.generate(
          "Summarize all extracted data...",
        );
        return { summary };
      },
    },
  ],
});

// Start workers (stateless - can crash anytime)
const worker = runtime.worker({ concurrency: 5 });
worker.register(processDocuments);
await worker.start();

// Run the workflow
const result = await processDocuments.run(
  { documents: ["doc1.pdf", "doc2.pdf", "doc3.pdf"] },
  { wait: true },
);
// Even if workers crash 100 times, this completes successfully
```

### 3. Set Up the Database

```bash
# Clone the repo
git clone https://github.com/your-org/x404-r.git
cd x404-r

# Install dependencies
npm install

# Set environment variables
cp .env.example .env
# Edit .env with your CockroachDB connection string

# Set up the database schema
npm run setup-db
```

## Core Concepts

### Checkpoints = Context Saved

```typescript
handler: async (ctx) => {
  for (const item of items) {
    await processItem(item);

    // Context saved to CockroachDB
    await ctx.checkpoint({ lastItem: item });

    // Worker crashes here? No problem.
    // Next worker resumes from checkpoint.
  }
};
```

### DAG Workflows

```typescript
const workflow = runtime.workflow("pipeline", {
  steps: [
    { name: "a", handler: async (ctx) => ({ data: "a" }) },
    { name: "b", handler: async (ctx) => ({ data: "b" }) },
    // 'c' waits for both 'a' and 'b'
    {
      name: "c",
      dependsOn: ["a", "b"],
      handler: async (ctx) => ({ data: "c" }),
    },
  ],
});
```

### Priority Scheduling

```sql
-- Enterprise customers processed first
ORDER BY
  CASE tenant.plan
    WHEN 'enterprise' THEN 0
    WHEN 'team' THEN 1
    WHEN 'pro' THEN 2
    ELSE 3
  END,
  job.priority DESC
```

### Memory & Learning

```typescript
// Agents learn from past executions
// Before each task, similar memories are retrieved
ctx.state._memories = [
  {
    summary: "Task X failed due to rate limit",
    resolution: "Added retry logic",
  },
  { summary: "Task Y succeeded with batch size 10", resolution: null },
];
```

## Project Structure

```
x404-r/
├── packages/
│   ├── sdk/                 # @shalwin04/x404r-sdk - Core SDK
│   │   ├── src/
│   │   │   ├── client.ts    # Main x404r client
│   │   │   ├── workflow.ts  # Workflow builder with DAG validation
│   │   │   ├── worker.ts    # Task processor with heartbeats
│   │   │   ├── context.ts   # Step context with checkpointing
│   │   │   ├── ai/          # AI provider abstraction
│   │   │   └── types.ts     # TypeScript types
│   │   └── examples/        # Working examples
│   │
│   ├── shared/              # Shared utilities
│   │   ├── auth.ts          # API key utilities
│   │   ├── tenant-db.ts     # Multi-tenant database wrapper
│   │   └── middleware.ts    # Auth middleware
│   │
│   ├── dashboard/           # Next.js dashboard
│   │   └── app/
│   │       ├── page.tsx     # Main dashboard with React Flow
│   │       └── admin/       # Admin panel
│   │
│   ├── worker/              # Lambda worker handlers
│   └── supervisor/          # Task decomposition
│
├── scripts/
│   ├── setup-db.sql         # Database schema
│   └── local-server.ts      # Local development server
│
└── infrastructure/          # AWS CDK
```

## Multi-Tenant Features

| Feature              | Description                               |
| -------------------- | ----------------------------------------- |
| **Tenant Isolation** | All data scoped by `tenant_id`            |
| **API Key Auth**     | SHA-256 hashed keys with scopes           |
| **Usage Tracking**   | Task counts, API calls per billing period |
| **Rate Limiting**    | Configurable limits per plan              |
| **Priority Queue**   | Higher-tier tenants processed first       |

## Local Development

```bash
# Terminal 1: Backend
npm run dev:server

# Terminal 2: Dashboard
npm run dev:dashboard

# Terminal 3: Run examples
cd packages/sdk
npx tsx examples/simple-workflow.ts
npx tsx examples/code-review-agent.ts
```

## Deployment

### Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         PRODUCTION ARCHITECTURE                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   Users                                                                 │
│     │                                                                   │
│     ▼                                                                   │
│   ┌─────────────────┐         ┌─────────────────┐                      │
│   │     Vercel      │         │   AWS Lambda    │                      │
│   │   (Dashboard)   │────────▶│   (Workers)     │                      │
│   │   Next.js UI    │  API    │                 │                      │
│   └─────────────────┘         └────────┬────────┘                      │
│                                        │                                │
│                                        ▼                                │
│                               ┌─────────────────┐                      │
│                               │  CockroachDB    │                      │
│                               │     Cloud       │                      │
│                               │  (Free Tier)    │                      │
│                               └─────────────────┘                      │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Step 1: CockroachDB Cloud Setup

```bash
# 1. Go to https://cockroachlabs.cloud
# 2. Create a free cluster (no credit card required)
# 3. Click "Connect" → Get connection string
# 4. Save it - you'll need it for Lambda and local dev

# Connection string format:
# postgresql://username:password@free-tier.gcp-us-central1.cockroachlabs.cloud:26257/x404r?sslmode=verify-full
```

### Step 2: AWS Lambda Deployment (Manual)

#### Prerequisites
```bash
# Install AWS CLI
brew install awscli  # macOS
# or: https://aws.amazon.com/cli/

# Configure AWS credentials
aws configure
# Enter: AWS Access Key ID, Secret Access Key, Region (us-east-1)

# Verify
aws sts get-caller-identity
```

#### Step 2.1: Build Lambda Packages

```bash
# Build the worker Lambda
cd packages/worker
npm install
npm run build

# Create deployment zip
cd dist
zip -r ../worker-lambda.zip .
cd ..

# Build the supervisor Lambda
cd ../supervisor
npm install
npm run build

# Create deployment zip
cd dist
zip -r ../supervisor-lambda.zip .
cd ../..
```

#### Step 2.2: Create IAM Role for Lambda

```bash
# Create trust policy file
cat > trust-policy.json << 'EOF'
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

# Create the IAM role
aws iam create-role \
  --role-name x404r-lambda-role \
  --assume-role-policy-document file://trust-policy.json

# Attach basic Lambda execution policy
aws iam attach-role-policy \
  --role-name x404r-lambda-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

# Attach Secrets Manager read policy
aws iam attach-role-policy \
  --role-name x404r-lambda-role \
  --policy-arn arn:aws:iam::aws:policy/SecretsManagerReadWrite

# Get the role ARN (save this!)
aws iam get-role --role-name x404r-lambda-role --query 'Role.Arn' --output text
# Output: arn:aws:iam::123456789:role/x404r-lambda-role
```

#### Step 2.3: Store Secrets in AWS Secrets Manager

```bash
# Store CockroachDB connection string
aws secretsmanager create-secret \
  --name x404r/database-url \
  --description "CockroachDB connection string" \
  --secret-string "postgresql://YOUR_USER:YOUR_PASS@YOUR_HOST:26257/x404r?sslmode=verify-full" \
  --region us-east-1

# Store Gemini API key
aws secretsmanager create-secret \
  --name x404r/gemini-api-key \
  --description "Gemini API key" \
  --secret-string "YOUR_GEMINI_API_KEY" \
  --region us-east-1

# Verify secrets
aws secretsmanager list-secrets --region us-east-1
```

#### Step 2.4: Create Worker Lambda

```bash
# Create the Worker Lambda function
aws lambda create-function \
  --function-name x404r-worker \
  --runtime nodejs20.x \
  --role arn:aws:iam::YOUR_ACCOUNT_ID:role/x404r-lambda-role \
  --handler handler.handler \
  --zip-file fileb://packages/worker/worker-lambda.zip \
  --timeout 300 \
  --memory-size 1024 \
  --environment "Variables={DATABASE_SECRET_ARN=arn:aws:secretsmanager:us-east-1:YOUR_ACCOUNT_ID:secret:x404r/database-url,GEMINI_SECRET_ARN=arn:aws:secretsmanager:us-east-1:YOUR_ACCOUNT_ID:secret:x404r/gemini-api-key}" \
  --region us-east-1

# Verify
aws lambda get-function --function-name x404r-worker --region us-east-1
```

#### Step 2.5: Create Supervisor Lambda

```bash
# Create the Supervisor Lambda function
aws lambda create-function \
  --function-name x404r-supervisor \
  --runtime nodejs20.x \
  --role arn:aws:iam::YOUR_ACCOUNT_ID:role/x404r-lambda-role \
  --handler handler.handler \
  --zip-file fileb://packages/supervisor/supervisor-lambda.zip \
  --timeout 120 \
  --memory-size 1024 \
  --environment "Variables={DATABASE_SECRET_ARN=arn:aws:secretsmanager:us-east-1:YOUR_ACCOUNT_ID:secret:x404r/database-url,GEMINI_SECRET_ARN=arn:aws:secretsmanager:us-east-1:YOUR_ACCOUNT_ID:secret:x404r/gemini-api-key}" \
  --region us-east-1
```

#### Step 2.6: Create EventBridge Rule (Worker Polling)

```bash
# Create rule to trigger worker every 10 seconds
aws events put-rule \
  --name x404r-worker-poll \
  --schedule-expression "rate(1 minute)" \
  --state ENABLED \
  --region us-east-1

# Add permission for EventBridge to invoke Lambda
aws lambda add-permission \
  --function-name x404r-worker \
  --statement-id eventbridge-invoke \
  --action lambda:InvokeFunction \
  --principal events.amazonaws.com \
  --source-arn arn:aws:events:us-east-1:YOUR_ACCOUNT_ID:rule/x404r-worker-poll \
  --region us-east-1

# Add Lambda as target
aws events put-targets \
  --rule x404r-worker-poll \
  --targets "Id"="1","Arn"="arn:aws:lambda:us-east-1:YOUR_ACCOUNT_ID:function:x404r-worker","Input"="{\"action\":\"process\"}" \
  --region us-east-1
```

#### Step 2.7: Create API Gateway

```bash
# Create REST API
aws apigateway create-rest-api \
  --name x404r-api \
  --description "x404-r API" \
  --region us-east-1

# Get the API ID (save this!)
API_ID=$(aws apigateway get-rest-apis --query "items[?name=='x404r-api'].id" --output text --region us-east-1)
echo "API ID: $API_ID"

# Get root resource ID
ROOT_ID=$(aws apigateway get-resources --rest-api-id $API_ID --query "items[?path=='/'].id" --output text --region us-east-1)
echo "Root ID: $ROOT_ID"

# Create /jobs resource
aws apigateway create-resource \
  --rest-api-id $API_ID \
  --parent-id $ROOT_ID \
  --path-part jobs \
  --region us-east-1

JOBS_ID=$(aws apigateway get-resources --rest-api-id $API_ID --query "items[?path=='/jobs'].id" --output text --region us-east-1)

# Create GET method for /jobs
aws apigateway put-method \
  --rest-api-id $API_ID \
  --resource-id $JOBS_ID \
  --http-method GET \
  --authorization-type NONE \
  --region us-east-1

# Create POST method for /jobs
aws apigateway put-method \
  --rest-api-id $API_ID \
  --resource-id $JOBS_ID \
  --http-method POST \
  --authorization-type NONE \
  --region us-east-1

# Integrate with Supervisor Lambda
aws apigateway put-integration \
  --rest-api-id $API_ID \
  --resource-id $JOBS_ID \
  --http-method GET \
  --type AWS_PROXY \
  --integration-http-method POST \
  --uri arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-1:YOUR_ACCOUNT_ID:function:x404r-supervisor/invocations \
  --region us-east-1

aws apigateway put-integration \
  --rest-api-id $API_ID \
  --resource-id $JOBS_ID \
  --http-method POST \
  --type AWS_PROXY \
  --integration-http-method POST \
  --uri arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-1:YOUR_ACCOUNT_ID:function:x404r-supervisor/invocations \
  --region us-east-1

# Add Lambda permission for API Gateway
aws lambda add-permission \
  --function-name x404r-supervisor \
  --statement-id apigateway-invoke \
  --action lambda:InvokeFunction \
  --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:us-east-1:YOUR_ACCOUNT_ID:$API_ID/*" \
  --region us-east-1

# Deploy API
aws apigateway create-deployment \
  --rest-api-id $API_ID \
  --stage-name prod \
  --region us-east-1

# Get your API URL
echo "API URL: https://$API_ID.execute-api.us-east-1.amazonaws.com/prod"
```

#### Step 2.8: Test Deployment

```bash
# Test the API
curl https://YOUR_API_ID.execute-api.us-east-1.amazonaws.com/prod/jobs

# Check Lambda logs
aws logs tail /aws/lambda/x404r-worker --follow
aws logs tail /aws/lambda/x404r-supervisor --follow
```

#### Updating Lambda Code

```bash
# After making changes, rebuild and update:

# Update Worker
cd packages/worker
npm run build
cd dist && zip -r ../worker-lambda.zip . && cd ..
aws lambda update-function-code \
  --function-name x404r-worker \
  --zip-file fileb://worker-lambda.zip \
  --region us-east-1

# Update Supervisor
cd ../supervisor
npm run build
cd dist && zip -r ../supervisor-lambda.zip . && cd ..
aws lambda update-function-code \
  --function-name x404r-supervisor \
  --zip-file fileb://supervisor-lambda.zip \
  --region us-east-1
```

#### Lambda Architecture

| Lambda | Trigger | Purpose |
|--------|---------|---------|
| **x404r-worker** | EventBridge (every 1 min) | Claims and executes tasks |
| **x404r-supervisor** | API Gateway | Job management, time travel, cost tracking |

#### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/jobs` | GET | List all jobs |
| `/jobs` | POST | Create new job |
| `/jobs/{id}` | GET | Get job details |
| `/jobs/{id}/checkpoints` | GET | Get checkpoints (time travel) |
| `/jobs/{id}/replay` | POST | Replay from checkpoint |
| `/chaos/kill-worker` | POST | Simulate crash (demo) |

### Step 3: Vercel Deployment (Dashboard)

```bash
# 1. Install Vercel CLI
npm install -g vercel

# 2. Navigate to dashboard
cd packages/dashboard

# 3. Deploy to Vercel
vercel deploy --prod

# 4. Set environment variables in Vercel Dashboard:
#    NEXT_PUBLIC_API_URL = https://your-api-gateway-url.amazonaws.com/prod

# Or via CLI:
vercel env add NEXT_PUBLIC_API_URL production
# Enter: https://xxxxxxxx.execute-api.us-east-1.amazonaws.com/prod
```

### Step 4: Verify Deployment

```bash
# Test Lambda API
curl https://YOUR_API_GATEWAY_URL/prod/ready
# Expected: OK

# Test creating a job
curl -X POST https://YOUR_API_GATEWAY_URL/prod/jobs \
  -H "Content-Type: application/json" \
  -d '{"name": "test-job", "input": {"test": true}}'

# Check Vercel dashboard
open https://your-app.vercel.app
```

### Local Development

```bash
# Terminal 1: Start backend
npm run dev

# Terminal 2: Start dashboard
npm run dev:dashboard

# Services:
# - Dashboard: http://localhost:3000
# - API:       http://localhost:3001
```

### Docker Deployment (Alternative)

```bash
# For self-hosted deployment
docker-compose up -d

# Services:
# - Dashboard:   http://localhost:3000
# - API:         http://localhost:3001
# - CockroachDB: http://localhost:8080 (Admin UI)
```

## Why "x404-r"?

```
x    = the unknown, the variable, the experimental
404  = "Not Found" - the error that haunts long-running agents
r    = Runtime

x404-r = The runtime where context is never "not found"
```

When your agent runs for hours and a worker crashes, traditional systems return a metaphorical 404 - your context is gone. x404-r ensures that never happens.

## New Features

### One-Line Durability

The simplest way to make any function crash-proof:

```typescript
import { durable } from '@shalwin04/x404r-sdk';

const result = await durable('my-task', async (ctx) => {
  await ctx.checkpoint('step-1');  // Survives crashes
  const data = await fetchData();
  await ctx.checkpoint('step-2');
  return processData(data);
});
```

### Time Travel Debugging

Replay any workflow from any checkpoint:

```bash
# Get checkpoints for a job
GET /jobs/:id/checkpoints

# Replay from a specific checkpoint
POST /jobs/:id/replay
{
  "checkpointId": "checkpoint-uuid",
  "newInput": { ... }  // Optional input override
}
```

### Cost Transparency

Track exactly what you're spending:

```bash
GET /jobs/:id/cost

{
  "summary": {
    "estimatedCostUsd": 0.0023,
    "savedByRecoveryUsd": 0.0018,  // Money saved by not re-running on crash
    "tokens": { "input": 1200, "output": 450 }
  }
}
```

### AWS Bedrock Integration

Use Claude, Titan, or Llama via AWS Bedrock:

```typescript
const runtime = await new x404r({
  connectionString: process.env.DATABASE_URL,
  ai: {
    provider: 'bedrock',
    region: 'us-east-1',
    defaultModel: 'anthropic.claude-3-sonnet-20240229-v1:0',
  },
}).ready();
```

## Roadmap

- [x] Core SDK with checkpointing
- [x] Multi-tenant database schema
- [x] API key authentication
- [x] Usage tracking & priority scheduling
- [x] Dashboard with React Flow
- [x] AI provider abstraction (Gemini/OpenAI/Anthropic/Bedrock)
- [x] One-line durable API
- [x] Time travel debugging
- [x] Cost transparency
- [ ] Stripe billing integration
- [ ] Webhook notifications
- [ ] Python SDK
- [ ] Self-hosted deployment guide

## License

MIT

---

**x404-r** - Context is never lost.

Built for the [CockroachDB x AWS Hackathon](https://cockroachdb-ai.devpost.com/)
