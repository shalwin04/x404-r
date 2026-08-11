/**
 * x404-r SDK
 * The runtime where context is never lost
 * Database-native infrastructure for crash-proof AI agents
 *
 * @example
 * ```typescript
 * import { x404r } from '@x404-r/sdk';
 *
 * const runtime = await new x404r({
 *   connectionString: process.env.DATABASE_URL,
 *   ai: {
 *     provider: 'gemini',
 *     apiKey: process.env.GEMINI_API_KEY,
 *   },
 * }).ready();
 *
 * // Define a crash-proof workflow
 * const refactor = runtime.workflow('refactor-code', {
 *   steps: [
 *     {
 *       name: 'analyze',
 *       handler: async (ctx) => {
 *         const analysis = await ctx.ai.generate(
 *           `Analyze this code: ${ctx.input.code}`
 *         );
 *         return { analysis };
 *       },
 *     },
 *     {
 *       name: 'refactor',
 *       dependsOn: ['analyze'],
 *       handler: async (ctx) => {
 *         // Checkpoint after each file
 *         for (const file of ctx.input.files) {
 *           await ctx.checkpoint({ lastFile: file });
 *           // If we crash here, we resume from checkpoint
 *         }
 *         return { success: true };
 *       },
 *     },
 *   ],
 * });
 *
 * // Start a worker (stateless - can crash anytime)
 * const worker = runtime.worker({ concurrency: 5 });
 * worker.register(refactor);
 * await worker.start();
 *
 * // Run a workflow
 * const result = await refactor.run({
 *   code: 'function hello() { return "world"; }',
 *   files: ['src/index.ts'],
 * });
 * ```
 */

// Main client
export { AgentDB, AgentDB as x404r } from './client.js';

// Workflow builder
export { WorkflowBuilder } from './workflow.js';

// Worker
export { Worker } from './worker.js';

// Context
export { createStepContext, restoreFromCheckpoint } from './context.js';

// AI providers
export { createAIProvider, MockAIProvider } from './ai/index.js';

// Types
export type {
  // Core types
  Workflow,
  WorkflowStatus,
  Task,
  TaskStatus,
  Checkpoint,

  // Definition types
  WorkflowDefinition,
  StepDefinition,
  StepHandler,
  StepContext,

  // AI types
  AIProvider,
  AIConfig,
  GenerateOptions,
  JSONSchema,

  // Config types
  AgentDBConfig,
  WorkerConfig,

  // Event types
  WorkflowEvent,
  EventHandler,

  // Run types
  RunOptions,
  RunResult,
} from './types.js';
