/**
 * AgentDB SDK Types
 */

// ============ Core Types ============

export type WorkflowStatus = 'pending' | 'running' | 'completed' | 'failed' | 'paused';
export type TaskStatus = 'pending' | 'claimed' | 'running' | 'done' | 'failed' | 'waiting';

export interface Workflow {
  id: string;
  name: string;
  version: string;
  status: WorkflowStatus;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  tenantId: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

export interface Task {
  id: string;
  workflowId: string;
  name: string;
  type: string;
  status: TaskStatus;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  dependsOn: string[];
  claimedBy?: string;
  claimedAt?: Date;
  heartbeatAt?: Date;
  attemptCount: number;
  maxAttempts: number;
  tenantId: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

export interface Checkpoint {
  id: string;
  taskId: string;
  stepIndex: number;
  state: Record<string, unknown>;
  createdAt: Date;
}

// ============ Workflow Definition ============

export interface StepDefinition<TInput = unknown, TOutput = unknown> {
  name: string;
  handler: StepHandler<TInput, TOutput>;
  dependsOn?: string[];
  maxAttempts?: number;
  timeout?: number; // ms
}

export type StepHandler<TInput = unknown, TOutput = unknown> = (
  ctx: StepContext<TInput>
) => Promise<TOutput>;

export interface WorkflowDefinition<TInput = unknown, TOutput = unknown> {
  name: string;
  version?: string;
  steps: StepDefinition[];
  onComplete?: (result: TOutput) => void | Promise<void>;
  onError?: (error: Error) => void | Promise<void>;
}

// ============ Execution Context ============

export interface StepContext<TInput = unknown> {
  /** Step input data */
  input: TInput;

  /** Mutable state that persists across checkpoints */
  state: Record<string, unknown>;

  /** Current workflow info */
  workflow: {
    id: string;
    name: string;
    input: Record<string, unknown>;
  };

  /** Current task info */
  task: {
    id: string;
    name: string;
    attemptCount: number;
  };

  /** AI provider for LLM calls */
  ai: AIProvider;

  /** Create a checkpoint (saves state to DB) */
  checkpoint: (state?: Record<string, unknown>) => Promise<void>;

  /** Log a message */
  log: (message: string, data?: Record<string, unknown>) => void;

  /** Sleep for specified milliseconds */
  sleep: (ms: number) => Promise<void>;
}

// ============ AI Provider ============

export interface AIProvider {
  /** Generate text completion */
  generate: (prompt: string, options?: GenerateOptions) => Promise<string>;

  /** Generate with structured output */
  generateJSON: <T>(prompt: string, schema?: JSONSchema) => Promise<T>;

  /** Generate embeddings */
  embed: (text: string) => Promise<number[]>;
}

export interface GenerateOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
}

export interface JSONSchema {
  type: string;
  properties?: Record<string, JSONSchema>;
  items?: JSONSchema;
  required?: string[];
}

// ============ Client Configuration ============

/**
 * Embedded mode configuration
 * Direct connection to CockroachDB, run workers locally
 */
export interface EmbeddedConfig {
  /** Mode identifier */
  mode?: 'embedded';

  /** CockroachDB connection string */
  connectionString: string;

  /** Tenant ID for multi-tenancy */
  tenantId?: string;

  /** AI provider configuration */
  ai?: AIConfig;

  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Cloud mode configuration
 * Connect to hosted x404-r API, workers run on Lambda
 */
export interface CloudConfig {
  /** Mode identifier */
  mode: 'cloud';

  /** x404-r API key (get from dashboard) */
  apiKey: string;

  /** API base URL (defaults to https://api.x404r.io) */
  baseUrl?: string;

  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Combined configuration type
 */
export type X404rConfig = EmbeddedConfig | CloudConfig;

/**
 * Legacy config type for backwards compatibility
 * @deprecated Use X404rConfig instead
 */
export type AgentDBConfig = EmbeddedConfig;

/**
 * Type guard for embedded mode
 */
export function isEmbeddedConfig(config: X404rConfig): config is EmbeddedConfig {
  return config.mode !== 'cloud';
}

/**
 * Type guard for cloud mode
 */
export function isCloudConfig(config: X404rConfig): config is CloudConfig {
  return config.mode === 'cloud';
}

export interface AIConfig {
  provider: 'gemini' | 'openai' | 'anthropic' | 'bedrock';
  apiKey?: string;
  defaultModel?: string;
  /** AWS region for Bedrock */
  region?: string;
}

// ============ Cost Tracking ============

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  embeddingTokens: number;
}

export interface CostEstimate {
  tokens: TokenUsage;
  estimatedCostUsd: number;
  savedByRecoveryUsd?: number;
}

export interface GenerateResult {
  content: string;
  usage?: TokenUsage;
}

// ============ Worker Configuration ============

export interface WorkerConfig {
  /** Number of concurrent tasks */
  concurrency?: number;

  /** Worker region (for geo-distributed execution) */
  region?: string;

  /** Heartbeat interval in ms */
  heartbeatInterval?: number;

  /** Poll interval for new tasks in ms */
  pollInterval?: number;

  /** Task types this worker handles (empty = all) */
  taskTypes?: string[];
}

// ============ Events ============

export type WorkflowEvent =
  | { type: 'workflow:created'; workflow: Workflow }
  | { type: 'workflow:started'; workflow: Workflow }
  | { type: 'workflow:completed'; workflow: Workflow }
  | { type: 'workflow:failed'; workflow: Workflow; error: Error }
  | { type: 'task:claimed'; task: Task; workerId: string }
  | { type: 'task:started'; task: Task }
  | { type: 'task:checkpoint'; task: Task; checkpoint: Checkpoint }
  | { type: 'task:completed'; task: Task }
  | { type: 'task:failed'; task: Task; error: Error }
  | { type: 'task:retrying'; task: Task; attempt: number };

export type EventHandler = (event: WorkflowEvent) => void | Promise<void>;

// ============ Run Options ============

export interface RunOptions {
  /** Priority (higher = processed first) */
  priority?: number;

  /** Custom metadata */
  metadata?: Record<string, unknown>;

  /** Timeout for entire workflow in ms */
  timeout?: number;

  /** Wait for completion before returning */
  wait?: boolean;
}

export interface RunResult<T = unknown> {
  workflowId: string;
  status: WorkflowStatus;
  output?: T;
  error?: string;
}
