# @agentdb/sdk

Database-native infrastructure for crash-proof AI agents. Built on CockroachDB for distributed, fault-tolerant agent execution.

## Installation

```bash
npm install @agentdb/sdk
```

## Features

- **Crash-Proof Execution**: Checkpoint state at any point. Resume exactly where you left off after crashes.
- **DAG Workflows**: Define complex workflows with step dependencies. Tasks execute in parallel when possible.
- **Priority Scheduling**: Enterprise tenants get priority. `FOR UPDATE SKIP LOCKED` ensures atomic task claiming.
- **AI Integration**: Built-in support for Gemini, OpenAI, and Anthropic with structured JSON output.
- **Memory & Learning**: Store embeddings of past executions. Query similar memories for context.
- **Multi-Tenant**: Full tenant isolation with usage tracking and rate limiting.

## Quick Start

```typescript
import { AgentDB } from '@agentdb/sdk';

// Initialize (note: call .ready() to wait for async AI provider setup)
const agent = await new AgentDB({
  connectionString: process.env.DATABASE_URL,
  ai: {
    provider: 'gemini',
    apiKey: process.env.GEMINI_API_KEY,
  },
  debug: true,
}).ready();

// Define a workflow
const myWorkflow = agent.workflow('my-workflow', {
  steps: [
    {
      name: 'step-1',
      handler: async (ctx) => {
        // Use AI
        const result = await ctx.ai.generate('Analyze this data...');

        // Checkpoint (crash-proof!)
        await ctx.checkpoint({ result });

        return { result };
      },
    },
    {
      name: 'step-2',
      dependsOn: ['step-1'], // Runs after step-1 completes
      handler: async (ctx) => {
        // Access previous checkpoint state via ctx.state
        return { done: true };
      },
    },
  ],
});

// Start a worker
const worker = agent.worker({ concurrency: 5 });
worker.register(myWorkflow);
await worker.start();

// Run workflows
const result = await myWorkflow.run(
  { input: 'data' },
  { wait: true, timeout: 60000 }
);
```

## Core Concepts

### Workflows

Workflows define a DAG of steps. Each step has a handler function and optional dependencies.

```typescript
const workflow = agent.workflow('name', {
  version: '1.0.0',
  steps: [
    { name: 'a', handler: async (ctx) => ({ data: 'a' }) },
    { name: 'b', handler: async (ctx) => ({ data: 'b' }) },
    { name: 'c', dependsOn: ['a', 'b'], handler: async (ctx) => ({ data: 'c' }) },
  ],
});
```

Steps `a` and `b` run in parallel, then `c` runs after both complete.

### Checkpoints

Checkpoints save state to CockroachDB. If a worker crashes, the task resumes from the last checkpoint.

```typescript
handler: async (ctx) => {
  const items = ctx.input.items;
  let processed = ctx.state.processed || 0; // Resume from checkpoint

  for (let i = processed; i < items.length; i++) {
    await processItem(items[i]);
    await ctx.checkpoint({ processed: i + 1 }); // Saved to DB
  }

  return { total: items.length };
}
```

### Workers

Workers claim and execute tasks. Multiple workers can run in parallel for horizontal scaling.

```typescript
const worker = agent.worker({
  concurrency: 5,       // Max concurrent tasks
  pollInterval: 1000,   // Poll every 1s
  heartbeatInterval: 10000, // Heartbeat every 10s
  taskTypes: ['step-1'], // Optional: only handle specific steps
});

worker.register(workflow1);
worker.register(workflow2);

await worker.start();

// Graceful shutdown
await worker.stop();
```

### AI Providers

Built-in support for multiple AI providers:

```typescript
// Gemini (default model: gemini-2.5-flash)
const agent = await new AgentDB({
  ai: { provider: 'gemini', apiKey: '...' },
}).ready();

// OpenAI (requires: npm install openai)
const agent = await new AgentDB({
  ai: { provider: 'openai', apiKey: '...', defaultModel: 'gpt-4-turbo' },
}).ready();

// Anthropic (requires: npm install @anthropic-ai/sdk)
const agent = await new AgentDB({
  ai: { provider: 'anthropic', apiKey: '...', defaultModel: 'claude-3-opus' },
}).ready();
```

#### Using AI in Handlers

```typescript
handler: async (ctx) => {
  // Simple generation
  const response = await ctx.ai.generate('Summarize this text...');

  // With system prompt
  const analysis = await ctx.ai.generate('Analyze the code', {
    systemPrompt: 'You are a senior code reviewer.',
    temperature: 0.3,
    maxTokens: 1000,
  });

  // Structured JSON output
  const data = await ctx.ai.generateJSON<{ name: string; age: number }>(
    'Extract user info from: John is 25 years old'
  );

  return { response, analysis, data };
}
```

## CockroachDB Features Used

| Feature | How AgentDB Uses It |
|---------|---------------------|
| `FOR UPDATE SKIP LOCKED` | Atomic task claiming without conflicts |
| Transactions | Consistent state across checkpoints |
| Multi-region | Deploy workers close to data |
| JSON columns | Flexible input/output payloads |
| Array columns | Step dependencies as UUID arrays |

## API Reference

### AgentDB

```typescript
const agent = new AgentDB(config: AgentDBConfig);
await agent.ready(); // Wait for AI provider initialization
```

| Option | Type | Description |
|--------|------|-------------|
| connectionString | string | PostgreSQL/CockroachDB connection URL |
| ai | AIConfig | AI provider configuration |
| tenantId | string | Tenant ID for multi-tenant mode |
| debug | boolean | Enable debug logging |

Methods:
- `workflow(name, definition)` - Create a workflow builder
- `worker(config)` - Create a task worker
- `on(handler)` - Register an event handler
- `close()` - Close database connection

### WorkflowBuilder

```typescript
const workflow = agent.workflow<TInput, TOutput>(name, definition);
```

Methods:
- `run(input, options)` - Start a workflow execution
- `name` - Get workflow name
- `version` - Get workflow version
- `steps` - Get step definitions

Run options:
- `wait: boolean` - Wait for completion
- `timeout: number` - Timeout in milliseconds
- `priority: number` - Job priority (higher = first)

### Worker

```typescript
const worker = agent.worker(config: WorkerConfig);
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| concurrency | number | 5 | Max concurrent tasks |
| pollInterval | number | 1000 | Polling interval (ms) |
| heartbeatInterval | number | 10000 | Heartbeat interval (ms) |
| taskTypes | string[] | [] | Task types to handle |

Methods:
- `register(workflow)` - Register a workflow
- `start()` - Start processing tasks
- `stop()` - Graceful shutdown
- `id` - Get worker ID
- `isRunning` - Check if running
- `activeTaskCount` - Get active task count

### StepContext

Available in step handlers:

| Property | Type | Description |
|----------|------|-------------|
| input | TInput | Step input data |
| state | object | Mutable state (persisted via checkpoint) |
| workflow | object | Workflow metadata (id, name, input) |
| task | object | Task metadata (id, name, attemptCount) |
| ai | AIProvider | AI provider instance |

Methods:
- `checkpoint(state?)` - Save checkpoint to database
- `log(message, data?)` - Log with workflow/task prefix
- `sleep(ms)` - Async sleep helper

### Events

```typescript
agent.on(async (event) => {
  switch (event.type) {
    case 'workflow:created':
    case 'workflow:started':
    case 'workflow:completed':
    case 'workflow:failed':
      console.log('Workflow:', event.workflow);
      break;
    case 'task:started':
    case 'task:completed':
    case 'task:failed':
      console.log('Task:', event.task);
      break;
  }
});
```

## Examples

### Simple Workflow

```bash
npx tsx examples/simple-workflow.ts
```

Demonstrates basic checkpointing and crash recovery.

### Code Review Agent

```bash
npx tsx examples/code-review-agent.ts
```

Full AI agent that reviews code for security issues.

## Environment Variables

```bash
# Required
DATABASE_URL=postgresql://user:pass@host:26257/db?sslmode=verify-full

# AI Provider (at least one)
GEMINI_API_KEY=your-gemini-key
OPENAI_API_KEY=your-openai-key
ANTHROPIC_API_KEY=your-anthropic-key
```

## License

MIT
