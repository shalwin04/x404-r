# x404-r Demo Video Script & DevPost Submission

## Table of Contents
1. [Detailed Demo Video Script](#detailed-demo-video-script)
2. [Architecture Diagram](#architecture-diagram)
3. [DevPost Submission Content](#devpost-submission-content)

---

# Detailed Demo Video Script

**Total Duration: 5-6 minutes**

---

## INTRO (0:00 - 0:30)

### Visual
- Screen recording of terminal
- Show a long-running AI agent processing data
- Progress bar or counter showing "Processing item 847 of 1000..."

### Script
> "Imagine this: You're running an AI agent that's been working for 3 hours. It's processed 847 items, made hundreds of API calls, built up valuable context about your data..."

### Visual
- Suddenly: Network error appears OR process crashes
- Terminal shows: "Connection reset by peer" or just disappears

### Script
> "Then disaster strikes. Worker crash. Memory overflow. Network timeout. Lambda cold start."

### Visual
- Show empty terminal, or error message

### Script
> "All that progress? All that context? **404. Not Found.**"
>
> "You restart from zero. 3 hours of compute. Hundreds of API calls. Gone."

---

## THE PROBLEM (0:30 - 1:15)

### Visual
- Slide or animated diagram showing traditional architecture:
```
┌─────────────────┐
│   AI Agent      │
│   ┌───────────┐ │
│   │  Memory   │ │  ← State lives here
│   │  (RAM)    │ │
│   └───────────┘ │
└────────┬────────┘
         │
         ▼
    [CRASH! 💥]
         │
         ▼
    State = LOST
```

### Script
> "Here's the problem. Traditional AI agents store state in memory. In-process variables. Local state."
>
> "When that process dies - whether it's a worker crash, a deployment, or just hitting memory limits - everything dies with it."

### Visual
- Show real examples:
  - AWS Lambda timeout (15 min max)
  - Kubernetes pod eviction
  - Memory limit exceeded
  - Network partition

### Script
> "This isn't edge case. It's the norm for long-running agents:"
> - "Lambda times out after 15 minutes"
> - "Kubernetes evicts pods under memory pressure"
> - "Spot instances get reclaimed"
> - "Deployments restart workers"
>
> "Every time, you lose context. Every time, you restart from zero."

---

## INTRODUCING x404-r (1:15 - 2:00)

### Visual
- x404-r logo animation
- Tagline: "The runtime where context is never lost"

### Script
> "x404-r fixes this. It's a database-native runtime for crash-proof AI agents."

### Visual
- New architecture diagram:
```
┌─────────────────┐     ┌─────────────────┐
│   Worker 1      │     │   Worker 2      │
│   (Stateless)   │     │   (Stateless)   │
└────────┬────────┘     └────────┬────────┘
         │                       │
         └───────────┬───────────┘
                     │
                     ▼
         ┌─────────────────────┐
         │    CockroachDB      │
         │  ┌───────────────┐  │
         │  │ Checkpoints   │  │  ← State lives HERE
         │  │ Task State    │  │
         │  │ Memory Vectors│  │
         │  └───────────────┘  │
         └─────────────────────┘
```

### Script
> "The key insight: **state belongs in the database, not in memory**."
>
> "Workers are completely stateless. They're disposable. Kill one, spin up another - it picks up exactly where the last one left off."
>
> "Built on CockroachDB for distributed, ACID-compliant state storage."

---

## THE SDK (2:00 - 3:00)

### Visual
- VS Code with code editor
- Type out or show the installation

### Script
> "Let me show you how simple this is."

### Code Block 1: Installation
```bash
npm install @shalwin04/x404r-sdk
```

> "One package. Published on npm. Ready to use."

### Code Block 2: Initialize Runtime
```typescript
import { x404r } from '@shalwin04/x404r-sdk';

const runtime = await new x404r({
  connectionString: process.env.DATABASE_URL,  // CockroachDB
  ai: {
    provider: 'gemini',
    apiKey: process.env.GEMINI_API_KEY
  }
}).ready();
```

> "Connect to CockroachDB, configure your AI provider. That's your runtime."

### Code Block 3: Define Workflow with Checkpoints
```typescript
const workflow = runtime.workflow('process-documents', {
  steps: [{
    name: 'extract',
    handler: async (ctx) => {
      // Resume from checkpoint if we crashed
      let processed = ctx.state.processed || 0;

      for (let i = processed; i < documents.length; i++) {
        const result = await ctx.ai.generate(`Extract: ${documents[i]}`);

        // THIS IS THE MAGIC LINE
        await ctx.checkpoint({
          processed: i + 1,
          results: [...ctx.state.results, result]
        });
      }

      return { extracted: ctx.state.results };
    }
  }]
});
```

### Script (highlight the checkpoint line)
> "This is the magic: `ctx.checkpoint()`"
>
> "Every time you call checkpoint, your state is atomically saved to CockroachDB."
>
> "Notice `ctx.state.processed` - if we crashed and resumed, this contains the last checkpoint. We continue from where we left off, not from zero."

### Code Block 4: Start Workers
```typescript
const worker = runtime.worker({ concurrency: 5 });
worker.register(workflow);
await worker.start();

// Run the workflow
const result = await workflow.run({ documents }, { wait: true });
```

> "Start workers, register workflows, run them. Workers are stateless - they can crash, restart, scale up or down. The workflow completes regardless."

---

## LIVE CRASH DEMO (3:00 - 4:30)

### Visual
- Split screen: Terminal (left) + Dashboard (right)

### Script
> "Let me prove it. Live demo."

### Step 1: Start Workflow
**Terminal:**
```bash
curl -X POST http://localhost:3001/jobs/demo
```

**Dashboard:** Shows job created with 5 tasks in a DAG

> "I've created a demo job with 5 tasks. Watch them execute in the DAG."

### Step 2: Show Progress
**Dashboard:** Tasks turning from gray → yellow (running) → green (complete)

> "Task 1 complete. Task 2 running. Making progress..."

### Step 3: CRASH THE WORKER
**Terminal:**
```bash
# Simulate worker crash
curl -X POST http://localhost:3001/chaos/kill-worker \
  -H "Content-Type: application/json" \
  -d '{"taskId": "currently-running-task-id"}'
```

> "Now I'm going to kill the worker. Right in the middle of task 3."

**Dashboard:**
- Task turns RED (crashed)
- Brief pause
- New worker claims it (task pulses, turns YELLOW again)

> "Watch what happens..."
>
> "Task went red - worker died. But look - within seconds, a new worker claimed it."

### Step 4: Show Checkpoint Recovery
**Dashboard:** Click on the task, show checkpoint data

> "Look at this checkpoint. The task had completed 2 internal steps before crashing. The new worker resumed from step 2, not step 0."

### Step 5: Job Completes
**Dashboard:** All tasks green

> "And the job completes. Zero progress lost. That's x404-r."

---

## COCKROACHDB DEEP DIVE (4:30 - 5:15)

### Visual
- CockroachDB logo
- SQL query examples

### Script
> "Why CockroachDB? Three features make this possible."

### Feature 1: FOR UPDATE SKIP LOCKED
```sql
-- Atomic task claiming - no race conditions
SELECT * FROM task_nodes
WHERE status = 'pending'
ORDER BY priority DESC
FOR UPDATE SKIP LOCKED
LIMIT 1;
```

> "**FOR UPDATE SKIP LOCKED** - Multiple workers can race to claim tasks. No locks, no conflicts. The database handles it atomically."

### Feature 2: Distributed Transactions
```sql
-- Checkpoint saved atomically with task state
BEGIN;
  UPDATE task_nodes SET state = $1 WHERE id = $2;
  INSERT INTO checkpoints (task_id, state) VALUES ($2, $1);
COMMIT;
```

> "**Distributed transactions** - Checkpoints are ACID. Either the entire state saves, or none of it does. No partial state corruption."

### Feature 3: Multi-Region
- Show map with regions

> "**Multi-region deployment** - Run workers in any region, close to your data. CockroachDB replicates state globally."

---

## TWO MODES (5:15 - 5:45)

### Visual
- Side-by-side comparison

### Mode A: Embedded
```typescript
const runtime = new x404r({
  mode: 'embedded',
  connectionString: process.env.DATABASE_URL,
  ai: { provider: 'gemini', apiKey: '...' }
});

// You run workers
const worker = runtime.worker();
await worker.start();
```

> "**Embedded mode**: Your CockroachDB, your infrastructure, your workers. Full control."

### Mode B: Cloud
```typescript
const runtime = new x404r({
  mode: 'cloud',
  apiKey: 'x404r_live_...'
});

// Lambda workers execute automatically
const result = await runtime.submit('my-workflow', { data });
```

> "**Cloud mode**: Just submit jobs. AWS Lambda workers handle execution. Zero infrastructure."

---

## CLOSING (5:45 - 6:00)

### Visual
- Metrics dashboard showing:
  - Crashes recovered: 47
  - Tokens saved: 125,000
  - Cost saved: $12.50

### Script
> "x404-r tracks what it saves you. Every crash recovered. Every token preserved. Every dollar saved."

### Visual
- npm install command
- GitHub stars

### Script
> "Context is never lost. That's the promise."

```bash
npm install @shalwin04/x404r-sdk
```

> "x404-r. Try it now."

---

# Architecture Diagram

## ASCII Version (for documentation)

```
╔══════════════════════════════════════════════════════════════════════════════════╗
║                              x404-r ARCHITECTURE                                  ║
╠══════════════════════════════════════════════════════════════════════════════════╣
║                                                                                   ║
║  ┌─────────────────────────────────────────────────────────────────────────────┐ ║
║  │                              CLIENT LAYER                                    │ ║
║  │  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐  │ ║
║  │  │  Your App   │    │  Dashboard  │    │   CLI       │    │   API       │  │ ║
║  │  │  (Node.js)  │    │  (Next.js)  │    │             │    │  Clients    │  │ ║
║  │  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘    └──────┬──────┘  │ ║
║  └─────────┼──────────────────┼──────────────────┼──────────────────┼─────────┘ ║
║            │                  │                  │                  │           ║
║            ▼                  ▼                  ▼                  ▼           ║
║  ┌─────────────────────────────────────────────────────────────────────────────┐ ║
║  │                         @shalwin04/x404r-sdk                                 │ ║
║  │  ┌──────────────────────────────────────────────────────────────────────┐   │ ║
║  │  │                           x404r Client                                │   │ ║
║  │  │   ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐    │   │ ║
║  │  │   │  Workflow  │  │   Worker   │  │    AI      │  │   Event    │    │   │ ║
║  │  │   │  Builder   │  │  Manager   │  │  Provider  │  │  Emitter   │    │   │ ║
║  │  │   └────────────┘  └────────────┘  └────────────┘  └────────────┘    │   │ ║
║  │  └──────────────────────────────────────────────────────────────────────┘   │ ║
║  │                                    │                                         │ ║
║  │  ┌──────────────────────────────────────────────────────────────────────┐   │ ║
║  │  │                         Backend Abstraction                           │   │ ║
║  │  │   ┌─────────────────────────┐    ┌─────────────────────────┐        │   │ ║
║  │  │   │    EmbeddedBackend      │    │     CloudBackend        │        │   │ ║
║  │  │   │    (Direct DB)          │    │     (HTTP API)          │        │   │ ║
║  │  │   └─────────────────────────┘    └─────────────────────────┘        │   │ ║
║  │  └──────────────────────────────────────────────────────────────────────┘   │ ║
║  └─────────────────────────────────────────────────────────────────────────────┘ ║
║                                       │                                          ║
║            ┌──────────────────────────┼──────────────────────────┐              ║
║            │                          │                          │              ║
║            ▼                          ▼                          ▼              ║
║  ┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐       ║
║  │  AWS Lambda     │       │  AWS Lambda     │       │   Vercel        │       ║
║  │  (Worker)       │       │  (Supervisor)   │       │   (Dashboard)   │       ║
║  │                 │       │                 │       │                 │       ║
║  │ • Task claiming │       │ • Job creation  │       │ • DAG viz       │       ║
║  │ • Execution     │       │ • Task decomp   │       │ • Monitoring    │       ║
║  │ • Checkpointing │       │ • API routing   │       │ • Time travel   │       ║
║  │ • Heartbeats    │       │ • Auth          │       │ • Metrics       │       ║
║  └────────┬────────┘       └────────┬────────┘       └────────┬────────┘       ║
║           │                         │                         │                 ║
║           │    ┌────────────────────┼─────────────────────────┘                 ║
║           │    │                    │                                           ║
║           ▼    ▼                    ▼                                           ║
║  ┌─────────────────────────────────────────────────────────────────────────────┐ ║
║  │                            CockroachDB Cloud                                 │ ║
║  │  ┌───────────────────────────────────────────────────────────────────────┐  │ ║
║  │  │                         DATABASE SCHEMA                                │  │ ║
║  │  │                                                                        │  │ ║
║  │  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐ │  │ ║
║  │  │  │  tenants │  │   jobs   │  │  tasks   │  │checkpnts │  │ memory   │ │  │ ║
║  │  │  │          │  │          │  │ (nodes)  │  │          │  │ vectors  │ │  │ ║
║  │  │  │ • id     │  │ • id     │  │ • id     │  │ • id     │  │ • id     │ │  │ ║
║  │  │  │ • name   │  │ • name   │  │ • status │  │ • state  │  │ • embed  │ │  │ ║
║  │  │  │ • plan   │  │ • status │  │ • worker │  │ • step   │  │ • context│ │  │ ║
║  │  │  │ • limits │  │ • input  │  │ • deps   │  │ • time   │  │ • task   │ │  │ ║
║  │  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘ │  │ ║
║  │  │                                                                        │  │ ║
║  │  │  KEY FEATURES USED:                                                    │  │ ║
║  │  │  • FOR UPDATE SKIP LOCKED (atomic task claiming)                       │  │ ║
║  │  │  • Distributed Transactions (consistent checkpoints)                   │  │ ║
║  │  │  • JSON columns (flexible state storage)                               │  │ ║
║  │  │  • Vector storage (memory/learning)                                    │  │ ║
║  │  └───────────────────────────────────────────────────────────────────────┘  │ ║
║  └─────────────────────────────────────────────────────────────────────────────┘ ║
║                                                                                   ║
║  ┌─────────────────────────────────────────────────────────────────────────────┐ ║
║  │                           SUPPORTING SERVICES                                │ ║
║  │  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐  │ ║
║  │  │ EventBridge │    │   Secrets   │    │     API     │    │  CloudWatch │  │ ║
║  │  │  (Polling)  │    │   Manager   │    │   Gateway   │    │   (Logs)    │  │ ║
║  │  │  1min/2min  │    │  DB_URL     │    │  REST API   │    │  Monitoring │  │ ║
║  │  └─────────────┘    │  API_KEY    │    └─────────────┘    └─────────────┘  │ ║
║  │                     └─────────────┘                                         │ ║
║  └─────────────────────────────────────────────────────────────────────────────┘ ║
║                                                                                   ║
╚══════════════════════════════════════════════════════════════════════════════════╝
```

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              CRASH RECOVERY FLOW                                 │
└─────────────────────────────────────────────────────────────────────────────────┘

 1. NORMAL EXECUTION
 ═══════════════════

    Worker A                          CockroachDB
    ┌──────┐                         ┌──────────┐
    │ Task │ ──checkpoint({p:1})───▶ │ state:   │
    │  🔄  │                         │ {p:1}    │
    │      │ ──checkpoint({p:2})───▶ │ {p:2}    │
    │      │ ──checkpoint({p:3})───▶ │ {p:3}    │
    └──────┘                         └──────────┘


 2. CRASH HAPPENS
 ════════════════

    Worker A                          CockroachDB
    ┌──────┐                         ┌──────────┐
    │ Task │                         │ state:   │
    │  💥  │ ←── CRASH               │ {p:3}    │ ← Last checkpoint preserved!
    │      │                         │          │
    └──────┘                         └──────────┘


 3. RECOVERY
 ═══════════

    Worker B (new)                    CockroachDB
    ┌──────┐                         ┌──────────┐
    │ Task │ ◀── claim task ──────── │ state:   │
    │  🔄  │ ◀── load checkpoint ─── │ {p:3}    │
    │      │                         │          │
    │      │ ctx.state.p = 3         │          │
    │      │ // Resume from 3!       │          │
    │      │                         │          │
    │      │ ──checkpoint({p:4})───▶ │ {p:4}    │
    │  ✅  │ ──complete()──────────▶ │ done!    │
    └──────┘                         └──────────┘


 RESULT: Zero progress lost. Task continued from step 3.
```

---

# DevPost Submission Content

## Project Title
**x404-r: The Crash-Proof Runtime for AI Agents**

## Tagline (short description)
Database-native infrastructure where AI agent context is never lost. Built on CockroachDB + AWS Lambda.

## Inspiration

We've all been there: running a long AI agent task that crashes after hours of work. All that context, all those API calls, all that progress - gone. **404 Not Found.**

Traditional AI frameworks store state in memory. When processes crash - whether due to Lambda timeouts, memory limits, network errors, or deployments - everything is lost. You restart from zero.

We asked: **What if state lived in the database, not memory?** What if workers were completely stateless and disposable? What if any worker could pick up where another left off?

That's x404-r.

## What it does

x404-r is a database-native runtime that makes AI agents crash-proof. Key features:

**1. Checkpoint-Based Recovery**
- Call `ctx.checkpoint()` to save state atomically to CockroachDB
- If a worker crashes, the next worker resumes from the last checkpoint
- Zero progress lost, ever

**2. Stateless Workers**
- Workers are disposable - kill one, another picks up the task
- Scale up/down freely without losing state
- Perfect for Lambda's ephemeral execution model

**3. DAG Workflow Orchestration**
- Define complex multi-step workflows with dependencies
- Parallel execution when possible
- Each step independently checkpointed

**4. Dual Mode Operation**
- **Embedded**: Your CockroachDB, your infrastructure, full control
- **Cloud**: Just submit jobs, Lambda workers handle execution

**5. AI Provider Abstraction**
- Built-in support for Gemini, OpenAI, Anthropic
- Unified `ctx.ai.generate()` API across providers

**6. Time Travel Debugging**
- Replay any workflow from any checkpoint
- Debug production issues by replaying exact state

## How we built it

### Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Dashboard  │     │   Your App  │     │    CLI      │
│  (Vercel)   │     │  (Node.js)  │     │             │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       └───────────────────┼───────────────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │  @shalwin04/x404r-sdk  │
              │  (npm package)         │
              └───────────┬────────────┘
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
  ┌───────────┐    ┌───────────┐    ┌───────────┐
  │  Lambda   │    │  Lambda   │    │ API       │
  │  Worker   │    │Supervisor │    │ Gateway   │
  └─────┬─────┘    └─────┬─────┘    └───────────┘
        │                │
        └────────┬───────┘
                 ▼
        ┌─────────────────┐
        │  CockroachDB    │
        │  (Serverless)   │
        └─────────────────┘
```

### Technology Stack

| Layer | Technology |
|-------|------------|
| SDK | TypeScript, published to npm |
| Dashboard | Next.js 16, React Flow, Tailwind |
| Backend | AWS Lambda (Node.js 20) |
| API | AWS API Gateway |
| Scheduling | AWS EventBridge |
| Secrets | AWS Secrets Manager |
| Database | CockroachDB Serverless |
| AI | Google Gemini (primary) |

### CockroachDB Features Used

1. **FOR UPDATE SKIP LOCKED**
   - Atomic task claiming without race conditions
   - Multiple workers compete fairly for tasks
   - No duplicate processing

2. **Distributed Transactions**
   - Checkpoints saved atomically
   - Task state + checkpoint in single transaction
   - No partial state corruption

3. **JSON Columns**
   - Flexible state storage
   - No schema migrations for new state shapes
   - Query JSON fields with SQL

4. **Vector Storage (pgvector)**
   - Store embeddings of past executions
   - Query similar memories for context
   - Agents learn from history

### AWS Services Used

1. **AWS Lambda** - Stateless worker execution
2. **API Gateway** - REST API endpoints
3. **EventBridge** - Scheduled worker polling (every minute)
4. **Secrets Manager** - Secure credential storage
5. **CloudWatch** - Logging and monitoring

## Challenges we ran into

1. **Lambda Cold Starts**: Initial attempts had slow cold starts. Solution: esbuild bundling to create single-file Lambdas with all dependencies.

2. **Race Conditions**: Multiple workers claiming same task. Solution: CockroachDB's `FOR UPDATE SKIP LOCKED` - perfect atomic claiming.

3. **Checkpoint Consistency**: Ensuring checkpoints are never partial. Solution: Wrap checkpoint + task state update in single transaction.

4. **EventBridge Limitations**: Minimum 1-minute schedule. Acceptable tradeoff for simplicity vs. SQS complexity.

5. **Dual-Mode Architecture**: Supporting both embedded (direct DB) and cloud (HTTP API) modes required careful abstraction in the SDK.

## Accomplishments that we're proud of

1. **Published npm Package**: `@shalwin04/x404r-sdk` is live and installable
2. **78 Tests Passing**: Comprehensive test coverage for the SDK
3. **Zero-Config Recovery**: Checkpoint/resume is completely automatic
4. **True Crash-Proof**: Killed workers mid-task, verified recovery works
5. **Production Architecture**: Full AWS deployment with CDK

## What we learned

1. **Database as Runtime**: CockroachDB's features (SKIP LOCKED, distributed txns) are perfect for building durable execution systems
2. **Stateless is Powerful**: Once you move state to the database, scaling becomes trivial
3. **Checkpoints > Event Sourcing**: For this use case, checkpoint-based recovery is simpler and more intuitive than full event sourcing
4. **AWS Lambda + CockroachDB**: Great combination for serverless + stateful workloads

## What's next for x404-r

1. **Python SDK**: Bring crash-proof agents to the Python ecosystem
2. **Webhook Notifications**: Real-time updates on job completion
3. **Billing Integration**: Stripe integration for multi-tenant SaaS
4. **Self-Hosted Helm Chart**: One-click Kubernetes deployment
5. **More AI Providers**: AWS Bedrock, Azure OpenAI

## Built With

- TypeScript
- Node.js
- CockroachDB
- AWS Lambda
- AWS API Gateway
- AWS EventBridge
- AWS Secrets Manager
- Next.js
- React Flow
- Tailwind CSS
- Vercel
- esbuild
- Vitest

## Try it out

**npm Package:**
```bash
npm install @shalwin04/x404r-sdk
```

**Links:**
- GitHub: https://github.com/shalwin04/x404-r
- npm: https://www.npmjs.com/package/@shalwin04/x404r-sdk
- Live Dashboard: [Your Vercel URL]
- API Endpoint: https://gb74j85no4.execute-api.us-east-1.amazonaws.com/prod

---

## Video Demo Checklist

- [ ] Show the problem (agent crash losing state)
- [ ] Introduce x404-r solution
- [ ] SDK installation and code walkthrough
- [ ] Live crash demo with dashboard
- [ ] Show checkpoint recovery in action
- [ ] CockroachDB features explanation
- [ ] Dual mode (embedded vs cloud)
- [ ] Metrics/savings display
- [ ] Call to action (npm install)
