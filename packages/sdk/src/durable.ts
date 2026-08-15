/**
 * One-Line Durable API
 *
 * Simplifies crash-proof execution to a single function call.
 *
 * @example
 * ```typescript
 * import { durable } from '@x404-r/sdk';
 *
 * const result = await durable('process-data', async (ctx) => {
 *   const data = await fetchData();
 *   await ctx.checkpoint('fetched');
 *
 *   const processed = await processData(data);
 *   await ctx.checkpoint('processed');
 *
 *   return processed;
 * });
 * ```
 */

import { AgentDB } from './client.js';
import type { AIConfig, AIProvider, StepContext } from './types.js';

export interface DurableContext {
  /** Create a named checkpoint (survives crashes) */
  checkpoint: (name: string, state?: Record<string, unknown>) => Promise<void>;

  /** Access persistent state */
  state: Record<string, unknown>;

  /** AI provider for LLM calls */
  ai: AIProvider;

  /** Log a message */
  log: (message: string, data?: Record<string, unknown>) => void;

  /** Sleep for specified milliseconds */
  sleep: (ms: number) => Promise<void>;

  /** Current execution info */
  execution: {
    id: string;
    attemptCount: number;
    checkpointName?: string;
  };
}

export interface DurableOptions {
  /** CockroachDB connection string (or uses DATABASE_URL env) */
  connectionString?: string;

  /** AI provider configuration */
  ai?: AIConfig;

  /** Maximum retry attempts */
  maxAttempts?: number;

  /** Timeout in milliseconds */
  timeout?: number;

  /** Tenant ID for multi-tenancy */
  tenantId?: string;
}

type DurableHandler<T> = (ctx: DurableContext) => Promise<T>;

// Global connection pool (reused across calls)
let globalRuntime: AgentDB | null = null;

async function getRuntime(options?: DurableOptions): Promise<AgentDB> {
  if (globalRuntime) {
    return globalRuntime;
  }

  const connectionString = options?.connectionString || process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable or connectionString option required');
  }

  globalRuntime = new AgentDB({
    connectionString,
    tenantId: options?.tenantId,
    ai: options?.ai,
  });

  await globalRuntime.ready();
  return globalRuntime;
}

/**
 * Execute a function durably with automatic crash recovery.
 *
 * The function can call `ctx.checkpoint()` at any point to save progress.
 * If the process crashes, execution resumes from the last checkpoint.
 *
 * @param name - Unique name for this durable function
 * @param handler - The function to execute durably
 * @param options - Configuration options
 * @returns The result of the handler function
 */
export async function durable<T>(
  name: string,
  handler: DurableHandler<T>,
  options?: DurableOptions
): Promise<T> {
  const runtime = await getRuntime(options);

  // Create a workflow with a single step
  const workflow = runtime.workflow<Record<string, unknown>, T>(name, {
    version: '1.0.0',
    steps: [
      {
        name: 'execute',
        maxAttempts: options?.maxAttempts ?? 3,
        timeout: options?.timeout,
        handler: async (ctx) => {
          // Create durable context wrapper
          let checkpointIndex = 0;
          const durableCtx: DurableContext = {
            state: ctx.state,
            ai: ctx.ai,
            log: ctx.log,
            sleep: ctx.sleep,
            execution: {
              id: ctx.task.id,
              attemptCount: ctx.task.attemptCount,
              checkpointName: ctx.state.__lastCheckpoint as string | undefined,
            },
            checkpoint: async (checkpointName: string, state?: Record<string, unknown>) => {
              checkpointIndex++;
              await ctx.checkpoint({
                ...state,
                __lastCheckpoint: checkpointName,
                __checkpointIndex: checkpointIndex,
              });
            },
          };

          return handler(durableCtx);
        },
      },
    ],
  });

  // Create worker and run
  const worker = runtime.worker({ concurrency: 1 });
  worker.register(workflow);

  // Start worker in background
  const workerPromise = worker.start();

  try {
    // Run workflow and wait for completion
    const result = await workflow.run({}, { wait: true, timeout: options?.timeout });

    if (result.status === 'failed') {
      throw new Error(result.error || 'Durable function failed');
    }

    return result.output as T;
  } finally {
    // Stop worker
    await worker.stop();
  }
}

/**
 * Create a reusable durable function with preset options.
 *
 * @example
 * ```typescript
 * const processOrder = createDurable<{ orderId: string }, void>('process-order', {
 *   maxAttempts: 5,
 *   timeout: 60000,
 * });
 *
 * // Later:
 * await processOrder({ orderId: '123' }, async (ctx) => {
 *   // ... implementation
 * });
 * ```
 */
export function createDurable<TInput, TOutput>(
  name: string,
  options?: DurableOptions
): (input: TInput, handler: (ctx: DurableContext & { input: TInput }) => Promise<TOutput>) => Promise<TOutput> {
  return async (input: TInput, handler) => {
    return durable(
      name,
      async (ctx) => {
        const contextWithInput = {
          ...ctx,
          input,
        };
        return handler(contextWithInput);
      },
      options
    );
  };
}

/**
 * Close the global runtime connection.
 * Call this when shutting down your application.
 */
export async function closeDurable(): Promise<void> {
  if (globalRuntime) {
    await globalRuntime.close();
    globalRuntime = null;
  }
}
