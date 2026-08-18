# x404-r SDK Testing Guide

Complete guide for judges and developers to test the SDK functionality.

---

## Quick Start (5 minutes)

### 1. Install the SDK

```bash
npm install @shalwin04/x404r-sdk
```

### 2. Run Built-in Tests (No External Dependencies)

```bash
# Clone the repo
git clone https://github.com/shalwin04/x404-r.git
cd x404-r

# Install dependencies
npm install

# Run SDK tests (78 tests, no DB required)
cd packages/sdk
npm test
```

**Expected Output:**
```
✓ src/__tests__/workflow.test.ts  (14 tests)
✓ src/__tests__/ai.test.ts  (16 tests)
✓ src/__tests__/durable.test.ts  (15 tests)
✓ src/__tests__/chaos.test.ts  (21 tests)
✓ src/__tests__/backend.test.ts  (12 tests)

Test Files  5 passed (5)
     Tests  78 passed (78)
```

---

## Full SDK Testing (With Database)

### Prerequisites

1. **CockroachDB** (Free Serverless): https://cockroachlabs.cloud
2. **Gemini API Key** (Free): https://aistudio.google.com

### Setup Environment

```bash
# Create .env file
cat > .env << 'EOF'
DATABASE_URL=postgresql://YOUR_USER:YOUR_PASS@YOUR_HOST:26257/defaultdb?sslmode=verify-full
GEMINI_API_KEY=YOUR_GEMINI_API_KEY
EOF
```

### Initialize Database

```bash
# Run setup script
npm run setup-db

# Or manually via psql:
psql "$DATABASE_URL" -f scripts/setup-db.sql
```

---

## SDK Code Examples

### Example 1: Basic Workflow with Checkpointing

```typescript
// test-basic.ts
import { x404r } from '@shalwin04/x404r-sdk';

async function main() {
  // Initialize runtime
  const runtime = await new x404r({
    connectionString: process.env.DATABASE_URL!,
    ai: {
      provider: 'gemini',
      apiKey: process.env.GEMINI_API_KEY!
    },
    debug: true  // Enable logging
  }).ready();

  console.log('✅ Runtime initialized');

  // Define a workflow with checkpointing
  const workflow = runtime.workflow('test-workflow', {
    steps: [{
      name: 'process-items',
      handler: async (ctx) => {
        const items = ctx.input.items || [1, 2, 3, 4, 5];

        // Resume from checkpoint if crashed
        let processed = ctx.state.processed || 0;
        const results = ctx.state.results || [];

        console.log(`Starting from item ${processed + 1}`);

        for (let i = processed; i < items.length; i++) {
          // Simulate work
          console.log(`Processing item ${i + 1}/${items.length}`);
          await new Promise(r => setTimeout(r, 500));

          results.push({ item: items[i], doubled: items[i] * 2 });

          // CHECKPOINT - survives crashes!
          await ctx.checkpoint({
            processed: i + 1,
            results: results
          });

          console.log(`✓ Checkpoint saved at item ${i + 1}`);
        }

        return { results };
      }
    }]
  });

  // Start a worker
  const worker = runtime.worker({ concurrency: 1 });
  worker.register(workflow);
  await worker.start();

  console.log('✅ Worker started');

  // Run the workflow
  const result = await workflow.run(
    { items: [10, 20, 30, 40, 50] },
    { wait: true, timeout: 60000 }
  );

  console.log('✅ Workflow completed');
  console.log('Result:', JSON.stringify(result, null, 2));

  // Cleanup
  await worker.stop();
  await runtime.close();
}

main().catch(console.error);
```

**Run:**
```bash
npx tsx test-basic.ts
```

**Expected Output:**
```
[x404-r] Connecting to database...
✅ Runtime initialized
✅ Worker started
Starting from item 1
Processing item 1/5
✓ Checkpoint saved at item 1
Processing item 2/5
✓ Checkpoint saved at item 2
Processing item 3/5
✓ Checkpoint saved at item 3
Processing item 4/5
✓ Checkpoint saved at item 4
Processing item 5/5
✓ Checkpoint saved at item 5
✅ Workflow completed
Result: {
  "results": [
    { "item": 10, "doubled": 20 },
    { "item": 20, "doubled": 40 },
    { "item": 30, "doubled": 60 },
    { "item": 40, "doubled": 80 },
    { "item": 50, "doubled": 100 }
  ]
}
```

---

### Example 2: Crash Recovery Demo

```typescript
// test-crash-recovery.ts
import { x404r } from '@shalwin04/x404r-sdk';

async function main() {
  const runtime = await new x404r({
    connectionString: process.env.DATABASE_URL!,
    ai: { provider: 'gemini', apiKey: process.env.GEMINI_API_KEY! },
    debug: true
  }).ready();

  // Workflow that "crashes" at item 3
  const workflow = runtime.workflow('crash-test', {
    steps: [{
      name: 'risky-process',
      handler: async (ctx) => {
        let progress = ctx.state.progress || 0;
        const results = ctx.state.results || [];

        console.log(`\n📍 Starting from progress: ${progress}`);

        for (let i = progress; i < 5; i++) {
          console.log(`Processing step ${i + 1}/5...`);

          // Simulate crash at step 3 (only on first attempt)
          if (i === 2 && ctx.task.attempt === 1) {
            console.log('💥 SIMULATING CRASH!');
            throw new Error('Simulated crash at step 3');
          }

          await new Promise(r => setTimeout(r, 300));
          results.push(`step-${i + 1}-done`);

          // Checkpoint after each step
          await ctx.checkpoint({ progress: i + 1, results });
          console.log(`✓ Checkpoint: progress=${i + 1}`);
        }

        return { results };
      }
    }]
  });

  const worker = runtime.worker({ concurrency: 1 });
  worker.register(workflow);
  await worker.start();

  console.log('🚀 Starting workflow (will crash and recover)...\n');

  try {
    const result = await workflow.run({}, { wait: true, timeout: 30000 });
    console.log('\n✅ Workflow completed!');
    console.log('Final result:', result);
  } catch (e) {
    console.log('\n❌ Workflow failed:', e);
  }

  await worker.stop();
  await runtime.close();
}

main().catch(console.error);
```

**Expected Output:**
```
🚀 Starting workflow (will crash and recover)...

📍 Starting from progress: 0
Processing step 1/5...
✓ Checkpoint: progress=1
Processing step 2/5...
✓ Checkpoint: progress=2
Processing step 3/5...
💥 SIMULATING CRASH!

[Worker retries task...]

📍 Starting from progress: 2    ← RESUMED FROM CHECKPOINT!
Processing step 3/5...
✓ Checkpoint: progress=3
Processing step 4/5...
✓ Checkpoint: progress=4
Processing step 5/5...
✓ Checkpoint: progress=5

✅ Workflow completed!
Final result: { results: ['step-1-done', 'step-2-done', 'step-3-done', 'step-4-done', 'step-5-done'] }
```

---

### Example 3: DAG Workflow (Parallel Execution)

```typescript
// test-dag.ts
import { x404r } from '@shalwin04/x404r-sdk';

async function main() {
  const runtime = await new x404r({
    connectionString: process.env.DATABASE_URL!,
    ai: { provider: 'gemini', apiKey: process.env.GEMINI_API_KEY! },
    debug: true
  }).ready();

  // DAG: A and B run in parallel, C waits for both
  const workflow = runtime.workflow('dag-demo', {
    steps: [
      {
        name: 'task-a',
        handler: async (ctx) => {
          console.log('🅰️ Task A starting...');
          await new Promise(r => setTimeout(r, 1000));
          console.log('🅰️ Task A complete!');
          return { a: 'result-a' };
        }
      },
      {
        name: 'task-b',
        handler: async (ctx) => {
          console.log('🅱️ Task B starting...');
          await new Promise(r => setTimeout(r, 800));
          console.log('🅱️ Task B complete!');
          return { b: 'result-b' };
        }
      },
      {
        name: 'task-c',
        dependsOn: ['task-a', 'task-b'],  // Waits for A and B
        handler: async (ctx) => {
          console.log('🅲 Task C starting (after A and B)...');
          // Access outputs from dependencies
          console.log('  Input from A:', ctx.input.a);
          console.log('  Input from B:', ctx.input.b);
          await new Promise(r => setTimeout(r, 500));
          console.log('🅲 Task C complete!');
          return { c: 'final-result', combined: [ctx.input.a, ctx.input.b] };
        }
      }
    ]
  });

  const worker = runtime.worker({ concurrency: 3 }); // Allow parallel
  worker.register(workflow);
  await worker.start();

  console.log('🚀 Starting DAG workflow...\n');
  const start = Date.now();

  const result = await workflow.run({}, { wait: true });

  console.log(`\n✅ Completed in ${Date.now() - start}ms`);
  console.log('Result:', JSON.stringify(result, null, 2));

  await worker.stop();
  await runtime.close();
}

main().catch(console.error);
```

**Expected Output:**
```
🚀 Starting DAG workflow...

🅰️ Task A starting...
🅱️ Task B starting...     ← A and B run in PARALLEL
🅱️ Task B complete!
🅰️ Task A complete!
🅲 Task C starting (after A and B)...
  Input from A: result-a
  Input from B: result-b
🅲 Task C complete!

✅ Completed in 1823ms    ← Faster than sequential (2300ms)
Result: {
  "c": "final-result",
  "combined": ["result-a", "result-b"]
}
```

---

### Example 4: AI Integration

```typescript
// test-ai.ts
import { x404r } from '@shalwin04/x404r-sdk';

async function main() {
  const runtime = await new x404r({
    connectionString: process.env.DATABASE_URL!,
    ai: {
      provider: 'gemini',
      apiKey: process.env.GEMINI_API_KEY!
    },
    debug: true
  }).ready();

  const workflow = runtime.workflow('ai-demo', {
    steps: [{
      name: 'analyze',
      handler: async (ctx) => {
        const text = ctx.input.text;

        console.log('📝 Input text:', text);
        console.log('🤖 Calling Gemini AI...\n');

        // Simple text generation
        const summary = await ctx.ai.generate(
          `Summarize this in one sentence: "${text}"`,
          { temperature: 0.3 }
        );

        console.log('Summary:', summary);

        // Structured JSON output
        const analysis = await ctx.ai.generateJSON<{
          sentiment: string;
          topics: string[];
          wordCount: number;
        }>(`
          Analyze this text and return JSON:
          "${text}"

          Return: { sentiment: "positive/negative/neutral", topics: [...], wordCount: number }
        `);

        console.log('Analysis:', JSON.stringify(analysis, null, 2));

        return { summary, analysis };
      }
    }]
  });

  const worker = runtime.worker({ concurrency: 1 });
  worker.register(workflow);
  await worker.start();

  const result = await workflow.run({
    text: "CockroachDB is a distributed SQL database that provides consistency, scalability, and resilience. It's designed for cloud-native applications that require global distribution."
  }, { wait: true });

  console.log('\n✅ AI workflow completed!');

  await worker.stop();
  await runtime.close();
}

main().catch(console.error);
```

**Expected Output:**
```
📝 Input text: CockroachDB is a distributed SQL database...
🤖 Calling Gemini AI...

Summary: CockroachDB is a cloud-native distributed SQL database offering consistency, scalability, and global resilience.
Analysis: {
  "sentiment": "positive",
  "topics": ["database", "distributed systems", "cloud", "SQL"],
  "wordCount": 24
}

✅ AI workflow completed!
```

---

### Example 5: Cloud Mode (Using Deployed API)

```typescript
// test-cloud.ts
import { x404r } from '@shalwin04/x404r-sdk';

async function main() {
  // Cloud mode - uses Lambda workers, no local DB needed
  const runtime = new x404r({
    mode: 'cloud',
    apiKey: 'demo',  // Use 'demo' for testing
    baseUrl: 'https://gb74j85no4.execute-api.us-east-1.amazonaws.com/prod'
  });

  console.log('☁️ Cloud mode - submitting job to Lambda workers...\n');

  // Submit a job
  const { workflowId } = await runtime.submit('demo-job', {
    action: 'process',
    data: [1, 2, 3]
  });

  console.log('📤 Job submitted:', workflowId);

  // Check status
  const status = await runtime.status(workflowId);
  console.log('📊 Status:', status?.status);

  // Wait for completion (polling)
  console.log('⏳ Waiting for completion...');
  const result = await runtime.wait(workflowId, { timeout: 60000 });

  console.log('✅ Job completed!');
  console.log('Result:', JSON.stringify(result, null, 2));
}

main().catch(console.error);
```

---

## API Testing (curl)

### Health Check
```bash
curl https://gb74j85no4.execute-api.us-east-1.amazonaws.com/prod/ready
```
**Response:**
```json
{"status":"ok","timestamp":"2026-08-18T12:00:00.000Z"}
```

### Create Demo Job
```bash
curl -X POST https://gb74j85no4.execute-api.us-east-1.amazonaws.com/prod/jobs/demo \
  -H "Content-Type: application/json"
```
**Response:**
```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "taskCount": 5,
  "tasks": [
    {"id": "...", "name": "parse", "type": "analyze"},
    {"id": "...", "name": "lint", "type": "validate"},
    ...
  ]
}
```

### Get Job Status
```bash
curl https://gb74j85no4.execute-api.us-east-1.amazonaws.com/prod/jobs/{jobId}
```
**Response:**
```json
{
  "job": {
    "id": "...",
    "status": "running",
    "name": "Demo Job"
  },
  "tasks": [...],
  "stats": {
    "pending": 2,
    "running": 1,
    "completed": 2
  }
}
```

### Simulate Crash (Kill Worker)
```bash
curl -X POST https://gb74j85no4.execute-api.us-east-1.amazonaws.com/prod/chaos/kill-worker \
  -H "Content-Type: application/json" \
  -d '{"taskId": "TASK_ID_HERE"}'
```
**Response:**
```json
{
  "success": true,
  "message": "Simulated crash for task. Worker will be reclaimed."
}
```

---

## Test Summary

| Test | What It Proves |
|------|----------------|
| **Unit Tests (78)** | SDK logic works correctly |
| **Basic Workflow** | Checkpointing saves state |
| **Crash Recovery** | Resume from checkpoint after failure |
| **DAG Workflow** | Parallel execution + dependencies |
| **AI Integration** | Gemini API works through SDK |
| **Cloud Mode** | HTTP API + Lambda workers function |
| **API curl** | REST endpoints work |

---

## Troubleshooting

### "Cannot connect to database"
- Check DATABASE_URL format: `postgresql://user:pass@host:26257/db?sslmode=verify-full`
- Ensure CockroachDB cluster is running

### "AI generation failed"
- Verify GEMINI_API_KEY is valid
- Check API quota at https://aistudio.google.com

### "Task stuck in pending"
- Ensure worker is running: `await worker.start()`
- Check worker has registered the workflow

---

## Files Location

```
packages/sdk/
├── examples/
│   ├── simple-workflow.ts    # Basic example
│   └── code-review-agent.ts  # AI agent example
└── src/__tests__/
    ├── workflow.test.ts      # Workflow tests
    ├── chaos.test.ts         # Crash recovery tests
    ├── ai.test.ts            # AI provider tests
    └── backend.test.ts       # Database tests
```

**Run examples:**
```bash
cd packages/sdk
npx tsx examples/simple-workflow.ts
```
