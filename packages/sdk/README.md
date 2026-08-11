# @x404-r/sdk

**The runtime where context is never lost.**

Database-native infrastructure for crash-proof AI agents. Built on CockroachDB for distributed, fault-tolerant agent execution.

## Installation

```bash
npm install @x404-r/sdk
```

## Why x404-r?

Long-running AI agents lose context when workers crash. Hours of progress? **404 Not Found.**

x404-r fixes this. State lives in CockroachDB, not memory. Workers are stateless. Kill one, another picks up exactly where it left off.

## Features

- **Crash-Proof Execution**: Checkpoint state at any point. Resume exactly where you left off.
- **DAG Workflows**: Define complex workflows with step dependencies. Parallel execution when possible.
- **Priority Scheduling**: Enterprise tenants processed first via `FOR UPDATE SKIP LOCKED`.
- **AI Integration**: Built-in support for Gemini, OpenAI, and Anthropic.
- **Memory & Learning**: Query embeddings of past executions for context.
- **Multi-Tenant**: Full tenant isolation with usage tracking.

## Quick Start

```typescript
import { x404r } from '@x404-r/sdk';

// Initialize the runtime
const runtime = await new x404r({
  connectionString: process.env.DATABASE_URL,
  ai: {
    provider: 'gemini',
    apiKey: process.env.GEMINI_API_KEY,
  },
  debug: true,
}).ready();

// Define a crash-proof workflow
const myWorkflow = runtime.workflow('my-workflow', {
  steps: [
    {
      name: 'process',
      handler: async (ctx) => {
        // Resume from checkpoint if crashed
        let progress = ctx.state.progress || 0;

        for (let i = progress; i < 100; i++) {
          await doWork(i);

          // Checkpoint - survives any crash!
          await ctx.checkpoint({ progress: i + 1 });
        }

        return { done: true };
      },
    },
  ],
});

// Start workers
const worker = runtime.worker({ concurrency: 5 });
worker.register(myWorkflow);
await worker.start();

// Run workflows
const result = await myWorkflow.run({ input: 'data' }, { wait: true });
```

## Core Concepts

### Checkpoints = Context Saved

```typescript
handler: async (ctx) => {
  for (const item of items) {
    await processItem(item);

    // Saved to CockroachDB - crash-proof!
    await ctx.checkpoint({ lastItem: item });
  }
}
```

If the worker crashes after checkpoint, the next worker resumes from `ctx.state.lastItem`.

### DAG Workflows

```typescript
const workflow = runtime.workflow('pipeline', {
  steps: [
    { name: 'a', handler: async (ctx) => ({ result: 'a' }) },
    { name: 'b', handler: async (ctx) => ({ result: 'b' }) },
    { name: 'c', dependsOn: ['a', 'b'], handler: async (ctx) => ({ result: 'c' }) },
  ],
});
```

Steps `a` and `b` run in parallel. Step `c` waits for both.

### Workers

```typescript
const worker = runtime.worker({
  concurrency: 5,           // Max concurrent tasks
  pollInterval: 1000,       // Poll every 1s
  heartbeatInterval: 10000, // Heartbeat every 10s
  taskTypes: ['process'],   // Optional: filter by step name
});

worker.register(workflow1);
worker.register(workflow2);

await worker.start();
await worker.stop(); // Graceful shutdown
```

### AI Providers

```typescript
// Gemini (default)
const runtime = await new x404r({
  ai: { provider: 'gemini', apiKey: '...' },
}).ready();

// OpenAI (requires: npm install openai)
const runtime = await new x404r({
  ai: { provider: 'openai', apiKey: '...', defaultModel: 'gpt-4-turbo' },
}).ready();

// Anthropic (requires: npm install @anthropic-ai/sdk)
const runtime = await new x404r({
  ai: { provider: 'anthropic', apiKey: '...', defaultModel: 'claude-3-opus' },
}).ready();
```

#### Using AI in Handlers

```typescript
handler: async (ctx) => {
  // Simple generation
  const response = await ctx.ai.generate('Analyze this...');

  // With system prompt
  const analysis = await ctx.ai.generate('Review the code', {
    systemPrompt: 'You are a senior engineer.',
    temperature: 0.3,
  });

  // Structured JSON
  const data = await ctx.ai.generateJSON<{ name: string }>('Extract name from...');

  return { response, analysis, data };
}
```

## API Reference

### x404r (Client)

```typescript
const runtime = new x404r(config);
await runtime.ready(); // Wait for AI provider init
```

| Option | Type | Description |
|--------|------|-------------|
| connectionString | string | CockroachDB connection URL |
| ai | AIConfig | AI provider config |
| tenantId | string | Tenant ID (multi-tenant mode) |
| debug | boolean | Enable debug logging |

Methods:
- `workflow(name, definition)` - Create a workflow
- `worker(config)` - Create a worker
- `on(handler)` - Register event handler
- `close()` - Close connection

### WorkflowBuilder

```typescript
const workflow = runtime.workflow<TInput, TOutput>(name, definition);
```

Methods:
- `run(input, options)` - Execute the workflow
- `name` - Workflow name
- `version` - Workflow version

Run options:
- `wait: boolean` - Wait for completion
- `timeout: number` - Timeout in ms
- `priority: number` - Job priority

### Worker

```typescript
const worker = runtime.worker(config);
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| concurrency | number | 5 | Max concurrent tasks |
| pollInterval | number | 1000 | Poll interval (ms) |
| heartbeatInterval | number | 10000 | Heartbeat interval (ms) |
| taskTypes | string[] | [] | Filter by step name |

Methods:
- `register(workflow)` - Register a workflow
- `start()` - Start processing
- `stop()` - Graceful shutdown
- `id` - Worker ID
- `isRunning` - Running status
- `activeTaskCount` - Active tasks

### StepContext

Available in handlers:

| Property | Type | Description |
|----------|------|-------------|
| input | TInput | Step input |
| state | object | Checkpoint state |
| workflow | object | Workflow info |
| task | object | Task info |
| ai | AIProvider | AI provider |

Methods:
- `checkpoint(state?)` - Save checkpoint
- `log(message, data?)` - Log with prefix
- `sleep(ms)` - Async sleep

### Events

```typescript
runtime.on(async (event) => {
  switch (event.type) {
    case 'workflow:created':
    case 'workflow:completed':
    case 'workflow:failed':
      console.log(event.workflow);
      break;
    case 'task:started':
    case 'task:completed':
    case 'task:failed':
      console.log(event.task);
      break;
  }
});
```

## CockroachDB Features

| Feature | Usage |
|---------|-------|
| `FOR UPDATE SKIP LOCKED` | Atomic task claiming |
| Transactions | Consistent checkpoints |
| Multi-region | Workers close to data |
| JSON columns | Flexible payloads |

## Examples

```bash
# Simple checkpoint demo
npx tsx examples/simple-workflow.ts

# AI code review agent
npx tsx examples/code-review-agent.ts
```

## Environment Variables

```bash
DATABASE_URL=postgresql://user:pass@host:26257/db?sslmode=verify-full
GEMINI_API_KEY=your-gemini-key
```

## License

MIT

---

**x404-r** - Context is never lost.
