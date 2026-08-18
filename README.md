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
| **Core SDK**            | ✅ Complete | `@x404-r/sdk` - TypeScript SDK for crash-proof agents |
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
│  │                      @x404-r/sdk                         │   │
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
npm install @x404-r/sdk
```

### 2. Create a Crash-Proof Agent

```typescript
import { x404r } from "@x404-r/sdk";

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
│   ├── sdk/                 # @x404-r/sdk - Core SDK
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

## AWS Deployment

```bash
# Set secrets
aws secretsmanager create-secret --name x404-r/database-url --secret-string "your-db-url"
aws secretsmanager create-secret --name x404-r/gemini-api-key --secret-string "your-api-key"

# Deploy with CDK
cd infrastructure
npm run deploy
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
import { durable } from '@x404-r/sdk';

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
