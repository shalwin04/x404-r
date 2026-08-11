# AgentDB

**Database-native infrastructure for crash-proof AI agents.** Built on CockroachDB for distributed, fault-tolerant agent execution.

> Transform CockroachDB into a runtime for AI agents. State lives in the database, not in memory. Workers can die anytime - agents resume exactly where they left off.

## Project Status

| Component | Status | Description |
|-----------|--------|-------------|
| **Core SDK** | ✅ Complete | `@agentdb/sdk` - TypeScript SDK for building crash-proof agents |
| **Database Schema** | ✅ Complete | Multi-tenant schema with checkpoints, memory vectors |
| **Multi-Tenancy** | ✅ Complete | Tenant isolation, API key auth, usage tracking |
| **AI Integration** | ✅ Complete | Gemini, OpenAI, Anthropic support |
| **Dashboard** | ✅ Complete | React Flow visualization, admin panel |
| **Worker System** | ✅ Complete | Task claiming, heartbeats, crash recovery |
| **Priority Scheduling** | ✅ Complete | Enterprise > Team > Pro > Free tenant priority |
| **AWS Deployment** | 🔧 Ready | CDK infrastructure (Lambda + CockroachDB) |
| **GitHub OAuth** | 🔧 Ready | Session management, user auth |
| **Stripe Billing** | ⏳ Planned | Usage-based billing integration |

## What is AgentDB?

AgentDB is infrastructure for AI agents that:

1. **Never loses progress** - Checkpoint state to CockroachDB at any point
2. **Survives crashes** - Workers resume from last checkpoint automatically
3. **Scales horizontally** - Run 100s of workers, CockroachDB handles coordination
4. **Learns from failures** - Vector memory stores past executions for context

### Why CockroachDB?

| Feature | How AgentDB Uses It |
|---------|---------------------|
| `FOR UPDATE SKIP LOCKED` | Atomic task claiming - no race conditions |
| Multi-region | Deploy workers close to data |
| Transactions | Consistent checkpoints across crashes |
| JSON columns | Flexible agent state storage |
| Horizontal scale | Handle millions of agent tasks |

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         AgentDB Platform                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐    │
│  │   Your App   │     │   Dashboard  │     │  Admin Panel │    │
│  │              │     │  (React Flow)│     │              │    │
│  └──────┬───────┘     └──────┬───────┘     └──────┬───────┘    │
│         │                    │                    │             │
│         ▼                    ▼                    ▼             │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    @agentdb/sdk                          │   │
│  │  ┌─────────┐  ┌──────────┐  ┌────────┐  ┌───────────┐  │   │
│  │  │ AgentDB │  │ Workflow │  │ Worker │  │ AIProvider│  │   │
│  │  │  Client │  │ Builder  │  │        │  │           │  │   │
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

## Quick Start

### 1. Install the SDK

```bash
npm install @agentdb/sdk
```

### 2. Create an Agent

```typescript
import { AgentDB } from '@agentdb/sdk';

// Initialize
const agent = await new AgentDB({
  connectionString: process.env.DATABASE_URL,
  ai: {
    provider: 'gemini',
    apiKey: process.env.GEMINI_API_KEY,
  },
}).ready();

// Define a workflow with crash-proof checkpoints
const myWorkflow = agent.workflow('process-documents', {
  steps: [
    {
      name: 'extract',
      handler: async (ctx) => {
        const docs = ctx.input.documents;

        for (let i = 0; i < docs.length; i++) {
          const result = await ctx.ai.generate(`Extract data from: ${docs[i]}`);

          // Checkpoint after each document - crash-proof!
          await ctx.checkpoint({ processed: i + 1, results: [...(ctx.state.results || []), result] });
        }

        return { extracted: ctx.state.results };
      },
    },
    {
      name: 'summarize',
      dependsOn: ['extract'],
      handler: async (ctx) => {
        const summary = await ctx.ai.generate('Summarize all extracted data...');
        return { summary };
      },
    },
  ],
});

// Start workers
const worker = agent.worker({ concurrency: 5 });
worker.register(myWorkflow);
await worker.start();

// Run the workflow
const result = await myWorkflow.run({ documents: ['doc1.pdf', 'doc2.pdf'] }, { wait: true });
```

### 3. Set Up the Database

```bash
# Clone the repo
git clone https://github.com/your-org/agentdb.git
cd agentdb

# Install dependencies
npm install

# Set environment variables
cp .env.example .env
# Edit .env with your CockroachDB connection string and API keys

# Set up the database schema
npm run setup-db
```

## Project Structure

```
agentdb/
├── packages/
│   ├── sdk/                 # @agentdb/sdk - Core SDK
│   │   ├── src/
│   │   │   ├── client.ts    # Main AgentDB client
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
│   │   ├── usage.ts         # Usage tracking
│   │   └── middleware.ts    # Auth middleware
│   │
│   ├── dashboard/           # Next.js dashboard
│   │   ├── app/
│   │   │   ├── page.tsx     # Main dashboard with React Flow
│   │   │   ├── admin/       # Admin panel
│   │   │   └── login/       # GitHub OAuth login
│   │   └── components/      # UI components
│   │
│   ├── worker/              # Lambda worker handlers
│   └── supervisor/          # Task decomposition
│
├── scripts/
│   ├── setup-db.sql         # Database schema
│   └── local-server.ts      # Local development server
│
├── infrastructure/          # AWS CDK
└── demo-repo/               # Sample code for demos
```

## Core Concepts

### Workflows

Workflows define a DAG of steps with dependencies:

```typescript
const workflow = agent.workflow('my-workflow', {
  steps: [
    { name: 'a', handler: async (ctx) => ({ result: 'a' }) },
    { name: 'b', handler: async (ctx) => ({ result: 'b' }) },
    { name: 'c', dependsOn: ['a', 'b'], handler: async (ctx) => ({ result: 'c' }) },
  ],
});
```

### Checkpoints

Save state to survive crashes:

```typescript
handler: async (ctx) => {
  for (const item of items) {
    await processItem(item);
    await ctx.checkpoint({ lastProcessed: item }); // Saved to CockroachDB
  }
  // If worker crashes, next worker resumes from last checkpoint
}
```

### Priority Scheduling

Enterprise tenants get priority through CockroachDB query:

```sql
ORDER BY
  CASE tenant.plan
    WHEN 'enterprise' THEN 0
    WHEN 'team' THEN 1
    WHEN 'pro' THEN 2
    ELSE 3
  END,
  job.priority DESC,
  task.created_at ASC
```

### Memory & Learning

Agents learn from past executions:

```typescript
// Automatically queries similar past tasks before execution
const memories = await client.queryMemories(embedding, taskType, 5);
// memories: [{ summary: "Task X failed due to...", resolution: "Fixed by..." }]
```

## Multi-Tenant Features

| Feature | Description |
|---------|-------------|
| **Tenant Isolation** | All data scoped by `tenant_id` |
| **API Key Auth** | SHA-256 hashed keys with scopes |
| **Usage Tracking** | Task counts, API calls per billing period |
| **Rate Limiting** | Configurable limits per plan |
| **Priority Queue** | Higher-tier tenants processed first |

## Database Schema

```sql
-- Core tables
tenants           -- Organizations/workspaces
jobs              -- Workflow instances
task_nodes        -- Individual tasks with dependencies
checkpoints       -- Crash-recovery state snapshots
memory_vectors    -- Past execution embeddings

-- Auth & billing
api_keys          -- Hashed API keys with scopes
usage_events      -- Individual usage records
usage_monthly     -- Aggregated monthly usage
```

## Local Development

```bash
# Terminal 1: Start the backend
npm run dev:server

# Terminal 2: Start the dashboard
npm run dev:dashboard

# Terminal 3: Run the SDK examples
cd packages/sdk
npx tsx examples/simple-workflow.ts
npx tsx examples/code-review-agent.ts
```

## AWS Deployment

```bash
# Set secrets
aws secretsmanager create-secret --name agentdb/database-url --secret-string "your-db-url"
aws secretsmanager create-secret --name agentdb/gemini-api-key --secret-string "your-api-key"

# Deploy with CDK
cd infrastructure
npm run deploy
```

## API Reference

See [SDK Documentation](./packages/sdk/README.md) for full API reference.

### Key Classes

- **`AgentDB`** - Main client for database and AI operations
- **`WorkflowBuilder`** - Defines workflows with step dependencies
- **`Worker`** - Claims and processes tasks with heartbeats
- **`StepContext`** - Available in handlers: `input`, `ai`, `checkpoint()`, `log()`

## Roadmap

- [x] Core SDK with checkpointing
- [x] Multi-tenant database schema
- [x] API key authentication
- [x] Usage tracking
- [x] Priority scheduling
- [x] Dashboard with React Flow
- [x] AI provider abstraction (Gemini/OpenAI/Anthropic)
- [ ] Stripe billing integration
- [ ] Webhook notifications
- [ ] SDK for Python
- [ ] Self-hosted deployment guide

## License

MIT

---

Built for the AWS + CockroachDB Hackathon 2024
