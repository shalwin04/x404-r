# DevPost Submission Form - Complete Responses

## Additional Info (For Judges)

---

### URL to your functional demo application
```
https://[YOUR-VERCEL-APP].vercel.app
```

### Testing credentials/instructions for functional demo
```
═══════════════════════════════════════════════════════════════
                    x404-r TESTING GUIDE
═══════════════════════════════════════════════════════════════

No authentication required for testing. All endpoints are open.

───────────────────────────────────────────────────────────────
OPTION 1: API TESTING (No setup required)
───────────────────────────────────────────────────────────────

# Health Check
curl https://gb74j85no4.execute-api.us-east-1.amazonaws.com/prod/ready
# Returns: {"status":"ok","timestamp":"..."}

# Create Demo Job (creates 5 tasks automatically)
curl -X POST https://gb74j85no4.execute-api.us-east-1.amazonaws.com/prod/jobs/demo
# Returns: {"jobId":"...", "taskCount":5, "tasks":[...]}

# Get Job Status
curl https://gb74j85no4.execute-api.us-east-1.amazonaws.com/prod/jobs/{jobId}
# Returns: {"job":{...}, "tasks":[...], "stats":{...}}

# Simulate Worker Crash (for demo)
curl -X POST https://gb74j85no4.execute-api.us-east-1.amazonaws.com/prod/chaos/kill-worker \
  -H "Content-Type: application/json" \
  -d '{"taskId": "TASK_ID_FROM_ABOVE"}'
# Returns: {"success":true, "message":"Simulated crash..."}

───────────────────────────────────────────────────────────────
OPTION 2: SDK TESTING (Run 78 unit tests)
───────────────────────────────────────────────────────────────

git clone https://github.com/shalwin04/x404-r.git
cd x404-r
npm install
cd packages/sdk
npm test

# Expected: 78 tests passing in ~500ms
# No external dependencies needed for unit tests

───────────────────────────────────────────────────────────────
OPTION 3: FULL SDK INTEGRATION TEST
───────────────────────────────────────────────────────────────

# Requires: CockroachDB (free) + Gemini API key (free)

# 1. Create test file
cat > test-sdk.ts << 'EOF'
import { x404r } from '@shalwin04/x404r-sdk';

async function main() {
  const runtime = await new x404r({
    connectionString: process.env.DATABASE_URL!,
    ai: { provider: 'gemini', apiKey: process.env.GEMINI_API_KEY! },
    debug: true
  }).ready();

  // Define workflow with checkpointing
  const workflow = runtime.workflow('test', {
    steps: [{
      name: 'process',
      handler: async (ctx) => {
        let progress = ctx.state.progress || 0; // Resume point

        for (let i = progress; i < 5; i++) {
          console.log(`Step ${i + 1}/5`);
          await ctx.checkpoint({ progress: i + 1 }); // Crash-proof!
        }
        return { done: true };
      }
    }]
  });

  const worker = runtime.worker({ concurrency: 1 });
  worker.register(workflow);
  await worker.start();

  const result = await workflow.run({}, { wait: true });
  console.log('Result:', result);

  await worker.stop();
  await runtime.close();
}
main();
EOF

# 2. Run
DATABASE_URL="postgresql://..." GEMINI_API_KEY="..." npx tsx test-sdk.ts

───────────────────────────────────────────────────────────────
OPTION 4: DASHBOARD TESTING
───────────────────────────────────────────────────────────────

1. Visit: [VERCEL_URL]
2. View existing jobs in DAG visualization
3. Click "Create Demo Job" to see task execution
4. Watch tasks transition: pending → running → completed
5. Use "Kill Worker" to simulate crash and see recovery

───────────────────────────────────────────────────────────────
KEY FEATURES TO VERIFY
───────────────────────────────────────────────────────────────

✓ Checkpoint saves state to CockroachDB
✓ Crashed tasks resume from last checkpoint (not from start)
✓ DAG workflows execute with correct dependencies
✓ Parallel tasks run simultaneously
✓ AI integration (Gemini) works through ctx.ai.generate()
✓ FOR UPDATE SKIP LOCKED prevents race conditions

───────────────────────────────────────────────────────────────
ENDPOINTS SUMMARY
───────────────────────────────────────────────────────────────

GET  /ready              → Health check
GET  /jobs               → List all jobs
POST /jobs               → Create job with AI decomposition
POST /jobs/demo          → Create pre-built demo job
GET  /jobs/{id}          → Get job with tasks and stats
POST /chaos/kill-worker  → Simulate worker crash

Base URL: https://gb74j85no4.execute-api.us-east-1.amazonaws.com/prod
```

---

### URL to open source code repository
```
https://github.com/shalwin04/x404-r
```

---

### URL to open-source license file
```
https://github.com/shalwin04/x404-r/blob/main/LICENSE
```

**Note**: Create a LICENSE file if not exists:
```bash
# Run this to create MIT license
cat > LICENSE << 'EOF'
MIT License

Copyright (c) 2026 Shalwin Sanju

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
EOF
```

---

### Which CockroachDB tools are used? (Select all that apply)

**Select:**
- ✅ **Cloud Managed** - Using CockroachDB Serverless Cloud
- ✅ **Distributed Vector Indexing** - Using vector storage for agent memory/embeddings

**Features Used (explain in integration section):**
- FOR UPDATE SKIP LOCKED
- Distributed Transactions
- JSON Columns
- Vector Storage (pgvector compatible)

---

### Which AWS Services are used? (Select all that apply)

**Select:**
- ✅ **AWS Lambda** - Primary compute for workers and supervisor
- ✅ **Other AWS service** - API Gateway, EventBridge, Secrets Manager

---

### How your project meaningfully integrated CockroachDB and AWS

```
x404-r uses CockroachDB and AWS as the foundation for crash-proof AI agent execution:

**CockroachDB Integration (4 features):**

1. FOR UPDATE SKIP LOCKED (Atomic Task Claiming)
   - Multiple Lambda workers compete for tasks simultaneously
   - SQL: SELECT * FROM task_nodes WHERE status='pending' FOR UPDATE SKIP LOCKED LIMIT 1
   - Guarantees exactly-once task execution without race conditions
   - Critical for our stateless worker architecture

2. Distributed Transactions (Consistent Checkpoints)
   - Checkpoints saved atomically with task state updates
   - BEGIN; UPDATE task_nodes SET state=$1; INSERT INTO checkpoints...; COMMIT;
   - If crash occurs mid-transaction, nothing is saved (crash-safe)
   - Ensures agents never have partial/corrupted state

3. JSON Columns (Flexible State Storage)
   - Agent state stored as JSONB: input_payload, state, output_payload
   - No schema migrations when state shape changes
   - Query checkpoint data using SQL JSON operators

4. Vector Storage (Agent Memory & Learning)
   - memory_vectors table stores embeddings of past executions
   - Agents query similar past experiences before tasks
   - Enables learning from failures and successes
   - Uses pgvector-compatible vector similarity search

**AWS Integration (4 services):**

1. AWS Lambda (Compute)
   - Worker Lambda: Claims tasks, executes with checkpointing, sends heartbeats
   - Supervisor Lambda: Job creation, task decomposition, API routing
   - Stateless by design - perfect for crash-proof architecture
   - 1024MB memory, 5-minute timeout for workers

2. Amazon API Gateway (REST API)
   - Exposes supervisor endpoints: /jobs, /ready, /chaos/kill-worker
   - CORS enabled for dashboard access
   - Proxies to Lambda with request/response transformation

3. Amazon EventBridge (Scheduling)
   - Triggers worker every 1 minute to poll for tasks
   - Triggers reclaim every 2 minutes for stale tasks
   - Enables serverless, event-driven task processing

4. AWS Secrets Manager (Security)
   - Stores CockroachDB connection string securely
   - Stores Gemini API key for AI inference
   - Lambda retrieves secrets at runtime

**How They Work Together:**
EventBridge triggers Worker Lambda → Worker claims task from CockroachDB (SKIP LOCKED) →
Worker executes with checkpoints saved via distributed transaction →
If crash, new worker claims and resumes from checkpoint →
Supervisor Lambda handles API requests via API Gateway
```

---

### What date did you start this project? (MM-DD-YY)
```
08-11-26
```
(Adjust to your actual start date within the hackathon period)

---

### Pre-existing code or work incorporated
```
This project was built from scratch during the hackathon submission period.

Standard tools and libraries used:
- Next.js 16 (React framework)
- React Flow (DAG visualization library)
- AWS CDK (infrastructure as code)
- pg (PostgreSQL/CockroachDB client)
- @google/generative-ai (Gemini SDK)
- Tailwind CSS (styling)
- Vitest (testing framework)
- esbuild (bundling)

AI Coding Assistants Used:
- Claude (Anthropic) for code generation and architecture design

No pre-existing application code was incorporated. All application logic,
SDK implementation, database schema, and infrastructure code was written
during the hackathon period.
```

---

### Submitter type
```
Individual
```
(Or "Team" if applicable)

---

### Submitter country of residence
```
India
```
(Adjust to your country)

---

### Organization name (if applicable)
```
[Leave blank or your company name]
```

---

### Which AI tools have you leveraged?
```
Development AI Tools:
- Claude (Anthropic) - Architecture design, code generation, debugging
- GitHub Copilot - Code completion

AI Integrated into Project:
- Google Gemini API - Primary AI provider for agent task execution
- Support for OpenAI, Anthropic as alternative providers

The SDK provides an abstraction layer (AIProvider) that supports multiple AI backends,
allowing users to choose their preferred provider.
```

---

### Level of learning derived from project
**Select:** `Significant learning - I/we learned multiple new technologies or concepts`

```
Key learnings:

1. CockroachDB Advanced Features
   - FOR UPDATE SKIP LOCKED for distributed task queues
   - Distributed transactions for consistent state management
   - Vector storage for ML embeddings

2. Serverless Architecture Patterns
   - Stateless workers with external state management
   - Event-driven task processing with EventBridge
   - Lambda cold start optimization with esbuild bundling

3. Crash-Proof System Design
   - Checkpoint-based recovery vs event sourcing
   - Heartbeat mechanisms for failure detection
   - Atomic state transitions

4. SDK Design
   - Dual-mode architecture (embedded vs cloud)
   - Backend abstraction patterns
   - TypeScript best practices for library design
```

---

### Did you gain AI value for your career?
**Select:** `Yes`

```
This project provided hands-on experience with:

1. Building AI agent infrastructure
   - Understanding agent state management challenges
   - Implementing crash-proof execution patterns

2. AI provider abstraction
   - Designing unified interfaces for multiple AI backends
   - Handling API differences (Gemini, OpenAI, Anthropic)

3. Production AI deployment
   - Lambda-based AI inference
   - Cost tracking and token management
   - Rate limiting and usage quotas

4. Vector databases for AI
   - Storing and querying embeddings
   - Similarity search for context retrieval
   - Agent memory and learning patterns

These skills are directly applicable to building production AI systems.
```

---

### Feedback on CockroachDB AI tools (Optional)
```
CockroachDB's features proved excellent for AI agent infrastructure:

Strengths:
1. FOR UPDATE SKIP LOCKED is perfect for distributed task queues -
   exactly what's needed for multi-worker agent systems

2. Serverless tier made it easy to get started with no upfront cost

3. PostgreSQL compatibility meant we could use familiar tools (pg client)

4. JSON columns provide the flexibility needed for arbitrary agent state

Suggestions:
1. Built-in pgvector support documentation could be more prominent
2. Example patterns for agent/workflow state management would help
3. Serverless cold start times could impact latency-sensitive agents

Overall, CockroachDB is an excellent choice for AI agent infrastructure
due to its strong consistency guarantees and distributed transaction support.
```

---

## Files to Upload

### Architecture Diagram
Upload: `docs/architecture.html` (open in browser, screenshot, save as PNG)

Or take screenshot of the rendered HTML page.

---

## Quick Checklist

- [ ] Demo URL filled (Vercel app)
- [ ] Testing instructions provided
- [ ] GitHub URL: https://github.com/shalwin04/x404-r
- [ ] LICENSE file created and URL provided
- [ ] CockroachDB tools selected (Cloud Managed, Distributed Vector Indexing)
- [ ] AWS services selected (Lambda, Other)
- [ ] Integration explanation written
- [ ] Start date provided
- [ ] Pre-existing code disclosure written
- [ ] Submitter info filled
- [ ] AI tools disclosed
- [ ] Learning level selected
- [ ] Career value selected
- [ ] Architecture diagram uploaded
- [ ] Video demo uploaded
