/**
 * AgentDB Client
 * Main entry point for the SDK
 */

import { Pool, PoolConfig } from 'pg';
import { createAIProvider, MockAIProvider } from './ai/index.js';
import { WorkflowBuilder } from './workflow.js';
import { Worker } from './worker.js';
import type {
  AgentDBConfig,
  AIProvider,
  WorkflowDefinition,
  WorkerConfig,
  Workflow,
  Task,
  EventHandler,
  WorkflowEvent,
} from './types.js';

/**
 * Default tenant ID for single-tenant mode
 */
const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000000';

/**
 * AgentDB Client
 *
 * @example
 * ```typescript
 * const agent = new AgentDB({
 *   connectionString: process.env.DATABASE_URL,
 *   ai: {
 *     provider: 'gemini',
 *     apiKey: process.env.GEMINI_API_KEY,
 *   },
 * });
 *
 * const workflow = agent.workflow('my-workflow', {
 *   steps: [
 *     { name: 'step1', handler: async (ctx) => { ... } },
 *   ],
 * });
 *
 * await workflow.run({ input: 'data' });
 * ```
 */
export class AgentDB {
  private pool: Pool;
  private aiProvider!: AIProvider;
  private tenantId: string;
  private debug: boolean;
  private eventHandlers: EventHandler[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private workflows: Map<string, WorkflowBuilder<any, any>> = new Map();
  private aiInitPromise: Promise<void>;

  constructor(config: AgentDBConfig) {
    this.pool = new Pool({
      connectionString: config.connectionString,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : { rejectUnauthorized: false },
    });

    this.tenantId = config.tenantId || DEFAULT_TENANT_ID;
    this.debug = config.debug || false;

    // Initialize AI provider asynchronously
    if (config.ai) {
      this.aiInitPromise = createAIProvider(config.ai).then(provider => {
        this.aiProvider = provider;
      });
    } else {
      this.aiProvider = new MockAIProvider();
      this.aiInitPromise = Promise.resolve();
    }
  }

  /**
   * Wait for AI provider to be initialized
   */
  async ready(): Promise<this> {
    await this.aiInitPromise;
    return this;
  }

  /**
   * Define a new workflow
   */
  workflow<TInput = unknown, TOutput = unknown>(
    name: string,
    definition: Omit<WorkflowDefinition<TInput, TOutput>, 'name'>
  ): WorkflowBuilder<TInput, TOutput> {
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
   * Create a worker to process tasks
   */
  worker(config: WorkerConfig = {}): Worker {
    return new Worker(this, config);
  }

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

  /**
   * Get the database pool
   */
  get db(): Pool {
    return this.pool;
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

  // ============ Database Operations ============

  /**
   * Create a workflow record
   */
  async createWorkflow(
    name: string,
    version: string,
    input: Record<string, unknown>,
    priority: number = 0
  ): Promise<Workflow> {
    const result = await this.pool.query<any>(
      `INSERT INTO jobs (tenant_id, name, description, input_payload, priority, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')
       RETURNING *`,
      [this.tenantId, name, version, JSON.stringify(input), priority]
    );
    return this.mapWorkflow(result.rows[0]);
  }

  /**
   * Get a workflow by ID
   */
  async getWorkflow(id: string): Promise<Workflow | null> {
    const result = await this.pool.query<any>(
      'SELECT * FROM jobs WHERE id = $1 AND tenant_id = $2',
      [id, this.tenantId]
    );
    return result.rows[0] ? this.mapWorkflow(result.rows[0]) : null;
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
    const completedAt = status === 'completed' || status === 'failed' ? 'now()' : null;
    await this.pool.query(
      `UPDATE jobs SET
        status = $2,
        result_payload = COALESCE($3, result_payload),
        completed_at = $4,
        updated_at = now()
       WHERE id = $1 AND tenant_id = $5`,
      [id, status, output ? JSON.stringify(output) : null, completedAt, this.tenantId]
    );
  }

  /**
   * Create tasks for a workflow
   */
  async createTasks(workflowId: string, tasks: Array<{
    name: string;
    type: string;
    input: Record<string, unknown>;
    dependsOn: string[];
    maxAttempts?: number;
  }>): Promise<Task[]> {
    if (tasks.length === 0) return [];

    const values: unknown[] = [];
    const placeholders: string[] = [];
    let paramIndex = 1;

    for (const task of tasks) {
      placeholders.push(
        `($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`
      );
      values.push(
        this.tenantId,
        workflowId,
        task.type,
        task.name,
        JSON.stringify(task.input),
        task.dependsOn,
        task.maxAttempts || 3
      );
    }

    const result = await this.pool.query<any>(
      `INSERT INTO task_nodes (tenant_id, job_id, task_type, name, input_payload, depends_on, max_attempts)
       VALUES ${placeholders.join(', ')}
       RETURNING *`,
      values
    );

    return result.rows.map(this.mapTask);
  }

  /**
   * Claim a task atomically
   */
  async claimTask(workerId: string, taskTypes?: string[]): Promise<Task | null> {
    let query = `
      WITH ready_tasks AS (
        SELECT t.id FROM task_nodes t
        JOIN jobs j ON t.job_id = j.id
        JOIN tenants ten ON t.tenant_id = ten.id
        WHERE t.status = 'pending'
          AND t.tenant_id = $1
          AND NOT EXISTS (
            SELECT 1 FROM task_nodes dep
            WHERE dep.id = ANY(t.depends_on) AND dep.status != 'done'
          )
    `;

    const params: unknown[] = [this.tenantId, workerId];

    if (taskTypes && taskTypes.length > 0) {
      params.push(taskTypes);
      query += ` AND t.task_type = ANY($${params.length})`;
    }

    query += `
        ORDER BY
          CASE ten.plan
            WHEN 'enterprise' THEN 0
            WHEN 'team' THEN 1
            WHEN 'pro' THEN 2
            ELSE 3
          END,
          j.priority DESC,
          t.created_at ASC
        LIMIT 1
        FOR UPDATE OF t SKIP LOCKED
      )
      UPDATE task_nodes
      SET status = 'claimed',
          claimed_by = $2,
          claimed_at = now(),
          heartbeat_at = now(),
          attempt_count = attempt_count + 1,
          updated_at = now()
      FROM ready_tasks
      WHERE task_nodes.id = ready_tasks.id
      RETURNING task_nodes.*
    `;

    const result = await this.pool.query<any>(query, params);
    return result.rows[0] ? this.mapTask(result.rows[0]) : null;
  }

  /**
   * Update task heartbeat
   */
  async heartbeat(taskId: string): Promise<void> {
    await this.pool.query(
      'UPDATE task_nodes SET heartbeat_at = now() WHERE id = $1',
      [taskId]
    );
  }

  /**
   * Complete a task
   */
  async completeTask(taskId: string, output: Record<string, unknown>): Promise<void> {
    await this.pool.query(
      `UPDATE task_nodes SET
        status = 'done',
        output_payload = $2,
        completed_at = now(),
        updated_at = now()
       WHERE id = $1`,
      [taskId, JSON.stringify(output)]
    );
  }

  /**
   * Fail a task
   */
  async failTask(taskId: string, error: string): Promise<void> {
    await this.pool.query(
      `UPDATE task_nodes SET
        status = 'failed',
        error_message = $2,
        completed_at = now(),
        updated_at = now()
       WHERE id = $1`,
      [taskId, error]
    );
  }

  /**
   * Get tasks for a workflow
   */
  async getWorkflowTasks(workflowId: string): Promise<Task[]> {
    const result = await this.pool.query<any>(
      'SELECT * FROM task_nodes WHERE job_id = $1 ORDER BY created_at',
      [workflowId]
    );
    return result.rows.map(this.mapTask);
  }

  /**
   * Create a checkpoint
   */
  async createCheckpoint(
    taskId: string,
    stepIndex: number,
    state: Record<string, unknown>
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO checkpoints (task_id, step_number, state)
       VALUES ($1, $2, $3)
       ON CONFLICT (task_id, step_number)
       DO UPDATE SET state = $3, created_at = now()`,
      [taskId, stepIndex, JSON.stringify(state)]
    );
  }

  /**
   * Get latest checkpoint for a task
   */
  async getCheckpoint(taskId: string): Promise<{ stepIndex: number; state: Record<string, unknown> } | null> {
    const result = await this.pool.query<any>(
      `SELECT step_number, state FROM checkpoints
       WHERE task_id = $1
       ORDER BY step_number DESC
       LIMIT 1`,
      [taskId]
    );

    if (result.rows.length === 0) return null;

    return {
      stepIndex: result.rows[0].step_number,
      state: result.rows[0].state,
    };
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
    await this.pool.query(
      `INSERT INTO memory_vectors
       (tenant_id, task_id, event_type, context_summary, embedding, task_type, error_category, resolution)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [this.tenantId, taskId, eventType, summary, embedding, taskType, errorCategory, resolution]
    );
  }

  /**
   * Query similar memories
   */
  async queryMemories(embedding: number[], taskType?: string, limit = 5): Promise<Array<{
    summary: string;
    eventType: string;
    resolution?: string;
    similarity: number;
  }>> {
    const embeddingStr = `ARRAY[${embedding.join(',')}]::FLOAT8[]`;

    let query = `
      SELECT
        context_summary as summary,
        event_type,
        resolution,
        (SELECT SUM(a * b) FROM UNNEST(embedding, ${embeddingStr}) AS t(a, b)) /
        (SQRT((SELECT SUM(a * a) FROM UNNEST(embedding) AS t(a))) *
         SQRT((SELECT SUM(b * b) FROM UNNEST(${embeddingStr}) AS t(b)))) AS similarity
      FROM memory_vectors
      WHERE tenant_id = $1
    `;

    const params: unknown[] = [this.tenantId];

    if (taskType) {
      params.push(taskType);
      query += ` AND task_type = $${params.length}`;
    }

    query += ` ORDER BY similarity DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await this.pool.query<any>(query, params);
    return result.rows;
  }

  /**
   * Check if workflow is complete
   */
  async isWorkflowComplete(workflowId: string): Promise<{ complete: boolean; failed: number; done: number; pending: number }> {
    const result = await this.pool.query<any>(
      `SELECT
        COUNT(*) FILTER (WHERE status = 'done') as done,
        COUNT(*) FILTER (WHERE status = 'failed') as failed,
        COUNT(*) FILTER (WHERE status NOT IN ('done', 'failed')) as pending
       FROM task_nodes WHERE job_id = $1`,
      [workflowId]
    );

    const row = result.rows[0];
    return {
      complete: parseInt(row.pending) === 0,
      done: parseInt(row.done),
      failed: parseInt(row.failed),
      pending: parseInt(row.pending),
    };
  }

  /**
   * Close the database connection
   */
  async close(): Promise<void> {
    await this.pool.end();
  }

  // ============ Mappers ============

  private mapWorkflow(row: any): Workflow {
    return {
      id: row.id,
      name: row.name,
      version: row.description || '1.0.0',
      status: row.status,
      input: row.input_payload,
      output: row.result_payload,
      tenantId: row.tenant_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at,
    };
  }

  private mapTask(row: any): Task {
    return {
      id: row.id,
      workflowId: row.job_id,
      name: row.name,
      type: row.task_type,
      status: row.status,
      input: row.input_payload,
      output: row.output_payload,
      error: row.error_message,
      dependsOn: row.depends_on || [],
      claimedBy: row.claimed_by,
      claimedAt: row.claimed_at,
      heartbeatAt: row.heartbeat_at,
      attemptCount: row.attempt_count,
      maxAttempts: row.max_attempts,
      tenantId: row.tenant_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at,
    };
  }
}
