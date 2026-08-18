/**
 * x404r Client
 * Main entry point for the SDK - supports both embedded and cloud modes
 */

import { createAIProvider, MockAIProvider } from './ai/index.js';
import { EmbeddedBackend, CloudBackend, isEmbeddedBackend } from './backend/index.js';
import type { Backend } from './backend/index.js';
import { WorkflowBuilder } from './workflow.js';
import { Worker } from './worker.js';
import type {
  X404rConfig,
  EmbeddedConfig,
  CloudConfig,
  AIProvider,
  WorkflowDefinition,
  WorkerConfig,
  Workflow,
  Task,
  EventHandler,
  WorkflowEvent,
  isEmbeddedConfig,
  isCloudConfig,
} from './types.js';

/**
 * Default tenant ID for single-tenant mode
 */
const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000000';

/**
 * x404r Client
 *
 * Supports two modes:
 *
 * **Embedded Mode** - Direct DB connection, run workers locally
 * ```typescript
 * const runtime = new x404r({
 *   mode: 'embedded', // optional, default
 *   connectionString: process.env.DATABASE_URL,
 *   ai: { provider: 'gemini', apiKey: '...' }
 * });
 * runtime.worker().start(); // Run workers locally
 * ```
 *
 * **Cloud Mode** - Connect to hosted API, workers run on Lambda
 * ```typescript
 * const runtime = new x404r({
 *   mode: 'cloud',
 *   apiKey: 'x404r_live_...'
 * });
 * // No workers needed - Lambda handles execution
 * const result = await runtime.submit('my-workflow', { input });
 * ```
 */
export class AgentDB {
  private backend: Backend;
  private aiProvider!: AIProvider;
  private mode: 'embedded' | 'cloud';
  private debug: boolean;
  private eventHandlers: EventHandler[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private workflows: Map<string, WorkflowBuilder<any, any>> = new Map();
  private initPromise: Promise<void>;
  private tenantId: string;

  constructor(config: X404rConfig) {
    this.debug = config.debug || false;
    this.mode = config.mode === 'cloud' ? 'cloud' : 'embedded';

    if (this.mode === 'cloud') {
      // Cloud mode - HTTP API client
      const cloudConfig = config as CloudConfig;
      this.backend = new CloudBackend({
        apiKey: cloudConfig.apiKey,
        baseUrl: cloudConfig.baseUrl,
      });
      this.tenantId = ''; // Managed by API
      this.aiProvider = new MockAIProvider(); // AI calls handled by Lambda
      // Don't call ready() automatically - let user call .ready() explicitly
      this.initPromise = Promise.resolve();
    } else {
      // Embedded mode - direct DB connection
      const embeddedConfig = config as EmbeddedConfig;
      this.tenantId = embeddedConfig.tenantId || DEFAULT_TENANT_ID;
      this.backend = new EmbeddedBackend({
        connectionString: embeddedConfig.connectionString,
        tenantId: this.tenantId,
      });

      // Initialize AI provider asynchronously
      if (embeddedConfig.ai) {
        this.initPromise = Promise.all([
          this.backend.ready(),
          createAIProvider(embeddedConfig.ai).then((provider) => {
            this.aiProvider = provider;
          }),
        ]).then(() => {});
      } else {
        this.aiProvider = new MockAIProvider();
        this.initPromise = this.backend.ready();
      }
    }
  }

  /**
   * Wait for client to be ready
   */
  async ready(): Promise<this> {
    await this.initPromise;
    return this;
  }

  /**
   * Get current mode
   */
  get currentMode(): 'embedded' | 'cloud' {
    return this.mode;
  }

  /**
   * Check if running in embedded mode
   */
  get isEmbedded(): boolean {
    return this.mode === 'embedded';
  }

  /**
   * Check if running in cloud mode
   */
  get isCloud(): boolean {
    return this.mode === 'cloud';
  }

  // ============ Workflow Definition ============

  /**
   * Define a new workflow
   *
   * In embedded mode, the workflow definition includes step handlers.
   * In cloud mode, workflows must be pre-registered on the platform.
   */
  workflow<TInput = unknown, TOutput = unknown>(
    name: string,
    definition: Omit<WorkflowDefinition<TInput, TOutput>, 'name'>
  ): WorkflowBuilder<TInput, TOutput> {
    if (this.mode === 'cloud') {
      this.log(
        'Warning: Workflow definitions in cloud mode are for reference only. ' +
          'Actual workflow logic runs on Lambda workers.'
      );
    }

    const fullDefinition: WorkflowDefinition<TInput, TOutput> = {
      name,
      ...definition,
    };

    const builder = new WorkflowBuilder<TInput, TOutput>(
      this,
      fullDefinition,
      this.tenantId
    );

    this.workflows.set(name, builder);
    return builder;
  }

  /**
   * Get a registered workflow builder by name
   */
  getWorkflowBuilder(name: string): WorkflowBuilder<any, any> | undefined {
    return this.workflows.get(name);
  }

  // ============ Worker (Embedded Mode Only) ============

  /**
   * Create a worker to process tasks
   *
   * @throws Error if called in cloud mode
   */
  worker(config: WorkerConfig = {}): Worker {
    if (this.mode === 'cloud') {
      throw new Error(
        'Workers are not available in cloud mode. ' +
          'Tasks are executed by Lambda workers automatically.'
      );
    }

    return new Worker(this, config);
  }

  // ============ Cloud Mode: Submit & Status ============

  /**
   * Submit a workflow for execution (cloud mode)
   *
   * In cloud mode, this submits to the API and Lambda workers execute it.
   * In embedded mode, this creates the workflow and you need to run workers.
   */
  async submit(
    workflowName: string,
    input: Record<string, unknown>,
    options: { priority?: number; wait?: boolean; timeout?: number } = {}
  ): Promise<{ workflowId: string; status: string; output?: unknown }> {
    if (this.mode === 'cloud') {
      const cloudBackend = this.backend as CloudBackend;
      const result = await cloudBackend.submit(workflowName, input, options);

      if (options.wait) {
        const workflow = await cloudBackend.waitForCompletion(result.workflowId, {
          timeout: options.timeout,
        });
        return {
          workflowId: workflow.id,
          status: workflow.status,
          output: workflow.output,
        };
      }

      return result;
    } else {
      // Embedded mode - create workflow directly
      const workflow = await this.backend.createWorkflow(
        workflowName,
        '1.0.0',
        input,
        options.priority
      );

      return {
        workflowId: workflow.id,
        status: workflow.status,
      };
    }
  }

  /**
   * Get workflow status
   */
  async status(workflowId: string): Promise<Workflow | null> {
    return this.backend.getWorkflow(workflowId);
  }

  /**
   * List workflows
   */
  async list(options?: {
    status?: 'pending' | 'running' | 'completed' | 'failed';
    limit?: number;
    offset?: number;
  }): Promise<Workflow[]> {
    return this.backend.listWorkflows(options);
  }

  /**
   * Wait for workflow completion
   */
  async wait(
    workflowId: string,
    options: { timeout?: number; pollInterval?: number } = {}
  ): Promise<Workflow> {
    if (this.mode === 'cloud') {
      return (this.backend as CloudBackend).waitForCompletion(
        workflowId,
        options
      );
    }

    // Embedded mode - poll for completion
    const { timeout = 300000, pollInterval = 1000 } = options;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const workflow = await this.backend.getWorkflow(workflowId);

      if (!workflow) {
        throw new Error(`Workflow ${workflowId} not found`);
      }

      if (workflow.status === 'completed' || workflow.status === 'failed') {
        return workflow;
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    throw new Error(`Workflow ${workflowId} timed out after ${timeout}ms`);
  }

  // ============ Time Travel ============

  /**
   * Replay a workflow from a checkpoint
   */
  async replay(
    workflowId: string,
    checkpointId: string,
    newInput?: Record<string, unknown>
  ): Promise<Workflow> {
    if (!this.backend.replayFromCheckpoint) {
      throw new Error('Replay not supported in this mode');
    }
    return this.backend.replayFromCheckpoint(workflowId, checkpointId, newInput);
  }

  /**
   * Get checkpoints for a workflow
   */
  async checkpoints(workflowId: string) {
    return this.backend.getWorkflowCheckpoints(workflowId);
  }

  // ============ Cost Tracking ============

  /**
   * Get cost summary for a workflow
   */
  async cost(workflowId: string) {
    if (!this.backend.getWorkflowCost) {
      return { totalTokens: 0, estimatedCostUsd: 0, savedByRecoveryUsd: 0 };
    }
    return this.backend.getWorkflowCost(workflowId);
  }

  // ============ Events ============

  /**
   * Register an event handler
   */
  on(handler: EventHandler): () => void {
    this.eventHandlers.push(handler);
    return () => {
      const index = this.eventHandlers.indexOf(handler);
      if (index > -1) this.eventHandlers.splice(index, 1);
    };
  }

  /**
   * Emit an event to all handlers
   */
  async emit(event: WorkflowEvent): Promise<void> {
    if (this.debug) {
      console.log(`[x404-r] Event: ${event.type}`, event);
    }
    for (const handler of this.eventHandlers) {
      await handler(event);
    }
  }

  // ============ Accessors ============

  /**
   * Get the backend instance
   */
  getBackend(): Backend {
    return this.backend;
  }

  /**
   * Get the database pool (embedded mode only)
   */
  get db() {
    if (this.mode === 'cloud') {
      throw new Error('Direct database access not available in cloud mode');
    }
    return (this.backend as EmbeddedBackend).db;
  }

  /**
   * Get the AI provider
   */
  get ai(): AIProvider {
    return this.aiProvider;
  }

  /**
   * Get the tenant ID
   */
  get tenant(): string {
    return this.tenantId;
  }

  /**
   * Log a debug message
   */
  log(message: string, data?: Record<string, unknown>): void {
    if (this.debug) {
      console.log(`[x404-r] ${message}`, data || '');
    }
  }

  // ============ Database Operations (for WorkflowBuilder compatibility) ============

  /**
   * Create a workflow record
   */
  async createWorkflow(
    name: string,
    version: string,
    input: Record<string, unknown>,
    priority: number = 0
  ): Promise<Workflow> {
    return this.backend.createWorkflow(name, version, input, priority);
  }

  /**
   * Get a workflow from database by ID
   */
  async getWorkflow(id: string): Promise<Workflow | null> {
    return this.backend.getWorkflow(id);
  }

  /**
   * Update workflow status
   */
  async updateWorkflowStatus(
    id: string,
    status: string,
    output?: Record<string, unknown>,
    error?: string
  ): Promise<void> {
    return this.backend.updateWorkflowStatus(
      id,
      status as any,
      output,
      error
    );
  }

  /**
   * Create tasks for a workflow
   */
  async createTasks(
    workflowId: string,
    tasks: Array<{
      name: string;
      type: string;
      input: Record<string, unknown>;
      dependsOn: string[];
      maxAttempts?: number;
    }>
  ): Promise<Task[]> {
    return this.backend.createTasks(workflowId, tasks);
  }

  /**
   * Claim a task atomically (embedded mode only)
   */
  async claimTask(workerId: string, taskTypes?: string[]): Promise<Task | null> {
    if (!isEmbeddedBackend(this.backend)) {
      throw new Error('Task claiming not available in cloud mode');
    }
    return this.backend.claimTask(workerId, taskTypes);
  }

  /**
   * Update task heartbeat (embedded mode only)
   */
  async heartbeat(taskId: string): Promise<void> {
    if (!isEmbeddedBackend(this.backend)) {
      throw new Error('Heartbeat not available in cloud mode');
    }
    return this.backend.heartbeat(taskId);
  }

  /**
   * Complete a task
   */
  async completeTask(taskId: string, output: Record<string, unknown>): Promise<void> {
    return this.backend.completeTask(taskId, output);
  }

  /**
   * Fail a task
   */
  async failTask(taskId: string, error: string): Promise<void> {
    return this.backend.failTask(taskId, error);
  }

  /**
   * Get tasks for a workflow
   */
  async getWorkflowTasks(workflowId: string): Promise<Task[]> {
    return this.backend.getWorkflowTasks(workflowId);
  }

  /**
   * Create a checkpoint
   */
  async createCheckpoint(
    taskId: string,
    stepIndex: number,
    state: Record<string, unknown>
  ): Promise<void> {
    return this.backend.createCheckpoint(taskId, stepIndex, state);
  }

  /**
   * Get latest checkpoint for a task
   */
  async getCheckpoint(
    taskId: string
  ): Promise<{ stepIndex: number; state: Record<string, unknown> } | null> {
    return this.backend.getCheckpoint(taskId);
  }

  /**
   * Store memory for learning
   */
  async storeMemory(
    taskId: string,
    eventType: string,
    summary: string,
    embedding: number[],
    taskType?: string,
    errorCategory?: string,
    resolution?: string
  ): Promise<void> {
    return this.backend.storeMemory(
      taskId,
      eventType,
      summary,
      embedding,
      taskType,
      errorCategory,
      resolution
    );
  }

  /**
   * Query similar memories
   */
  async queryMemories(
    embedding: number[],
    taskType?: string,
    limit = 5
  ): Promise<
    Array<{
      summary: string;
      eventType: string;
      resolution?: string;
      similarity: number;
    }>
  > {
    return this.backend.queryMemories(embedding, taskType, limit);
  }

  /**
   * Check if workflow is complete
   */
  async isWorkflowComplete(
    workflowId: string
  ): Promise<{ complete: boolean; failed: number; done: number; pending: number }> {
    return this.backend.isWorkflowComplete(workflowId);
  }

  /**
   * Close the client
   */
  async close(): Promise<void> {
    await this.backend.close();
  }
}

// Export as both AgentDB and x404r for flexibility
export { AgentDB as x404r };
