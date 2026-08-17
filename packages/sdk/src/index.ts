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
export { createAIProvider, MockAIProvider, estimateCost } from './ai/index.js';

// One-line durable API
export { durable, createDurable, closeDurable } from './durable.js';
export type { DurableContext, DurableOptions } from './durable.js';

// Chaos engineering
export {
  ChaosEngine,
  ChaosError,
  createChaosCheckpoint,
  withChaos,
  isChaosEnabled,
  DEFAULT_CHAOS_CONFIG,
  STRESS_CHAOS_CONFIG,
} from './chaos.js';
export type { ChaosConfig, ChaosFailureType } from './chaos.js';

// Metrics & Observability
export {
  MetricsCollector,
  Histogram,
  RateCalculator,
  metrics,
  observe,
  withMetrics,
} from './metrics.js';
export type {
  MetricEvent,
  MetricsSummary,
  MetricsDatabaseConfig,
  ExecutionMetrics,
  CostMetrics,
  PerformanceMetrics,
  ReliabilityMetrics,
  AIMetrics,
  MemoryMetrics,
} from './metrics.js';

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

  // Cost tracking types
  TokenUsage,
  CostEstimate,
  GenerateResult,

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
