# DevPost Submission - Field by Field

## Basic Info

### Project Name
```
x404-r
```

### Tagline (≤100 characters)
```
Database-native runtime for crash-proof AI agents. Context is never lost.
```

### Project URL (optional)
```
https://github.com/shalwin04/x404-r
```

### Thumbnail Image
Use a logo or screenshot of the dashboard with the DAG visualization.

---

## About Your Project

### Describe what you built during the hackathon (required)

**The Problem:**

Long-running AI agents lose all progress when workers crash. Lambda timeouts, memory limits, network failures, deployments - any of these events result in hours of work lost. Context? 404 Not Found.

**Our Solution:**

x404-r is a crash-proof runtime for AI agents built on CockroachDB. The key insight: **state belongs in the database, not in memory**.

Workers are completely stateless. They checkpoint their progress to CockroachDB. If a worker dies, another one picks up exactly where it left off - no progress lost, ever.

**What We Built:**

1. **TypeScript SDK** (`@shalwin04/x404r-sdk`)
   - `ctx.checkpoint()` - Save state atomically to CockroachDB
   - `ctx.state` - Resume from last checkpoint automatically
   - DAG workflows with parallel execution
   - AI provider abstraction (Gemini, OpenAI, Anthropic)

2. **AWS Lambda Workers**
   - Stateless execution triggered by EventBridge
   - Atomic task claiming with `FOR UPDATE SKIP LOCKED`
   - Automatic crash recovery

3. **Next.js Dashboard**
   - Real-time DAG visualization with React Flow
   - Time travel debugging (replay from any checkpoint)
   - Cost tracking and metrics

4. **Production Deployment**
   - CockroachDB Serverless for state storage
   - AWS Lambda + API Gateway + EventBridge
   - Vercel for dashboard hosting

**Key Technical Achievement:**

Using CockroachDB's `FOR UPDATE SKIP LOCKED`, multiple workers can race to claim tasks without conflicts. Combined with distributed transactions for checkpoints, we achieve true crash-proof execution.

---

### How does your project use CockroachDB? (required)

x404-r uses CockroachDB as the core runtime layer - not just for storage, but as the coordination mechanism for distributed agent execution.

**CockroachDB Features Used:**

**1. FOR UPDATE SKIP LOCKED (Atomic Task Claiming)**
```sql
SELECT * FROM task_nodes
WHERE status = 'pending'
  AND (dependencies_met = true)
ORDER BY priority DESC
FOR UPDATE SKIP LOCKED
LIMIT 1;
```
- Multiple Lambda workers compete for tasks simultaneously
- No race conditions or duplicate processing
- Higher priority tasks claimed first
- Essential for our stateless worker architecture

**2. Distributed Transactions (Consistent Checkpoints)**
```sql
BEGIN;
  UPDATE task_nodes
    SET state = $1, heartbeat_at = NOW()
    WHERE id = $2;
  INSERT INTO checkpoints (task_id, step_index, state)
    VALUES ($2, $3, $1);
COMMIT;
```
- Checkpoints are ACID - never partial
- Task state and checkpoint saved atomically
- If transaction fails, nothing is saved (crash-safe)

**3. JSON Columns (Flexible State Storage)**
```sql
CREATE TABLE task_nodes (
  input_payload JSONB,
  state JSONB,           -- Checkpoint state
  output_payload JSONB
);
```
- Agent state is arbitrary JSON
- No schema migrations needed
- Query checkpoint data with SQL

**4. Vector Storage / Embeddings (Agent Memory)**
```sql
CREATE TABLE memory_vectors (
  embedding VECTOR(768),
  context_summary TEXT,
  task_type STRING
);

-- Query similar past experiences
SELECT * FROM memory_vectors
ORDER BY embedding <-> $1
LIMIT 5;
```
- Agents learn from past executions
- Similar failures/successes retrieved as context
- Improves agent performance over time

**5. Multi-Region Capability**
- Workers can run in any region
- CockroachDB handles replication
- Low latency reads from nearest replica

**Why CockroachDB over Postgres?**
- `SKIP LOCKED` works across distributed nodes
- Transactions are globally consistent
- Serverless tier perfect for hackathon/startup scale
- Vector support built-in

---

### How does your project use AWS? (required)

x404-r uses AWS as the serverless compute layer for executing crash-proof agent tasks.

**AWS Services Used:**

**1. AWS Lambda (Primary Compute)**

*Worker Lambda:*
- Executes agent tasks with checkpointing
- Triggered every 1 minute by EventBridge
- Claims tasks atomically from CockroachDB
- Sends heartbeats during execution
- Timeout: 5 minutes, Memory: 1024MB

*Supervisor Lambda:*
- Handles API requests (job creation, status)
- Task decomposition using Gemini AI
- Authentication and authorization
- Timeout: 2 minutes, Memory: 1024MB

**2. Amazon API Gateway**
- REST API for dashboard and SDK clients
- Endpoints:
  - `GET /ready` - Health check
  - `POST /jobs` - Create new job
  - `GET /jobs` - List jobs
  - `GET /jobs/{id}` - Get job details
  - `POST /chaos/kill-worker` - Demo crash simulation
- CORS enabled for dashboard access

**3. Amazon EventBridge**
- Scheduled rules for worker polling:
  - `rate(1 minute)` - Poll for new tasks
  - `rate(2 minutes)` - Reclaim stale tasks (dead workers)
- Enables serverless, event-driven architecture
- No long-running processes needed

**4. AWS Secrets Manager**
- Secure storage for:
  - CockroachDB connection string
  - Gemini API key
- Lambda retrieves secrets at runtime
- No credentials in code or environment

**5. Amazon CloudWatch**
- Lambda execution logs
- Metrics for invocations, errors, duration
- Debugging and monitoring

**6. AWS CDK (Infrastructure)**
- Infrastructure as code
- Single `npx cdk deploy` for full stack
- Reproducible deployments

**Why Serverless?**
- Workers are stateless by design - perfect for Lambda
- Pay only for execution time
- Auto-scaling handled by AWS
- No server management

---

### What did you learn while building this project?

**Technical Learnings:**

1. **CockroachDB as a Coordination Layer**
   - `FOR UPDATE SKIP LOCKED` is incredibly powerful for distributed task queues
   - Distributed transactions enable true crash-proof checkpointing
   - JSON columns provide schema flexibility without sacrificing query power

2. **Stateless Architecture Benefits**
   - Moving state to the database simplifies everything
   - Workers become interchangeable and disposable
   - Scaling is trivial - just add more Lambdas

3. **Lambda Packaging Challenges**
   - Initially deployed with unbundled code - missing dependencies
   - Solution: esbuild to create single-file bundles with all deps
   - Reduced cold start times significantly

4. **EventBridge Limitations**
   - Minimum 1-minute schedule (not seconds)
   - Acceptable tradeoff for simplicity
   - Alternative: SQS with Lambda triggers (more complex)

**Architecture Insights:**

5. **Checkpoint vs Event Sourcing**
   - Checkpoints are simpler for crash recovery
   - Don't need full event history, just last known good state
   - Easier to reason about and debug

6. **Dual-Mode SDK Design**
   - Abstract backend behind interface
   - Same SDK API for embedded (direct DB) and cloud (HTTP)
   - Users choose based on their infrastructure needs

**Process Learnings:**

7. **Test Early, Test Often**
   - 78 tests for SDK caught many edge cases
   - Mock AI providers for fast test execution
   - Integration tests with real CockroachDB for confidence

8. **Documentation is a Feature**
   - Clear README with examples
   - Working code samples in `examples/`
   - Users can copy-paste and run immediately

---

### What is the potential business value of this project?

**The Problem is Real and Expensive:**

- AI agent tasks can run for hours
- Crashes cost: compute time + API calls + human time
- Enterprises can lose $100s-$1000s per crash
- Current solutions: restart from scratch, hope for the best

**x404-r Value Proposition:**

1. **Cost Savings**
   - Don't re-run crashed work
   - Resume from checkpoint = pay only for remaining work
   - Track exact savings in dashboard

2. **Reliability SLA**
   - "Your agent WILL complete"
   - No more manual restarts
   - Predictable execution times

3. **Developer Productivity**
   - Simple SDK - one line to checkpoint
   - Don't build crash recovery yourself
   - Focus on agent logic, not infrastructure

**Market Opportunity:**

- AI agent market growing rapidly (AutoGPT, CrewAI, LangGraph)
- Long-running tasks becoming more common
- Enterprises need reliability guarantees

**Monetization:**

1. **Self-Hosted (Open Source)**
   - Free SDK, bring your own CockroachDB
   - Builds community and adoption

2. **Cloud (SaaS)**
   - Managed Lambda workers
   - Usage-based pricing (tasks/month)
   - Tiers: Free (100 tasks) → Pro → Enterprise

3. **Enterprise**
   - Private deployment
   - SLA guarantees
   - Priority support

**Competitive Advantage:**

- Built specifically for crash-proof execution
- CockroachDB integration is deep, not bolted on
- Dual-mode (embedded/cloud) serves all segments

---

## Links and Media

### Video Demo URL (required)
```
[Your YouTube/Loom URL]
```

### GitHub Repository
```
https://github.com/shalwin04/x404-r
```

### Live Demo URL
```
https://[your-vercel-app].vercel.app
```

### API Endpoint
```
https://gb74j85no4.execute-api.us-east-1.amazonaws.com/prod
```

### npm Package
```
https://www.npmjs.com/package/@shalwin04/x404r-sdk
```

---

## Screenshots to Include

1. **Dashboard - DAG Visualization**
   - Show job with multiple tasks
   - Some completed (green), some running (yellow)

2. **Dashboard - Crash Recovery**
   - Task in red (crashed)
   - Then recovered (green pulse)

3. **Code - SDK Usage**
   - Clean code showing `ctx.checkpoint()`

4. **Terminal - npm install**
   - Show successful installation

5. **Architecture Diagram**
   - The ASCII diagram converted to image

6. **CockroachDB Console**
   - Show tables with data

7. **AWS Console**
   - Lambda functions
   - EventBridge rules

---

## Team Information

### Team Members
- Shalwin Sanju - Full Stack Developer

### Technologies/Tools Used (select all that apply)
- [x] CockroachDB
- [x] AWS Lambda
- [x] AWS API Gateway
- [x] AWS EventBridge
- [x] AWS Secrets Manager
- [x] TypeScript
- [x] Node.js
- [x] Next.js
- [x] React
- [x] Vercel

---

## Checklist Before Submission

- [ ] Project description completed
- [ ] CockroachDB usage explained (2+ features)
- [ ] AWS usage explained (1+ services)
- [ ] Video demo uploaded (max 3 minutes recommended)
- [ ] GitHub repo linked
- [ ] Live demo accessible
- [ ] All screenshots uploaded
- [ ] npm package published and working

---

## Quick Copy-Paste Sections

### One-Liner
```
x404-r: Crash-proof AI agents with CockroachDB checkpointing and AWS Lambda execution.
```

### Tweet-Length
```
Built x404-r at the CockroachDB x AWS Hackathon 🚀

AI agents that NEVER lose context. State lives in CockroachDB, not memory. Workers crash? No problem - another picks up exactly where it left off.

npm install @shalwin04/x404r-sdk

#BuildWithCockroachDB
```

### Elevator Pitch (30 seconds)
```
Long-running AI agents lose everything when they crash. x404-r fixes this.

We built a runtime where state lives in CockroachDB, not memory. Every checkpoint is atomically saved. Workers are stateless - kill one, another resumes from the last checkpoint.

Using CockroachDB's FOR UPDATE SKIP LOCKED for atomic task claiming and distributed transactions for consistent checkpoints, we achieve true crash-proof execution.

One npm package. One line to checkpoint. Context is never lost.
```
