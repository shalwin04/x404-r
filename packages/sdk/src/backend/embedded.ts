/**
 * Embedded Backend
 * Direct CockroachDB connection for self-hosted mode
 */

import { Pool } from 'pg';
import type { Backend } from './interface.js';
import type { Workflow, Task, WorkflowStatus } from '../types.js';

export interface EmbeddedBackendConfig {
  connectionString: string;
  tenantId: string;
  ssl?: boolean;
}

/**
 * Embedded backend - connects directly to CockroachDB
 * Used when running workers locally or self-hosting
 */
export class EmbeddedBackend implements Backend {
  private pool: Pool;
  private tenantId: string;

  constructor(config: EmbeddedBackendConfig) {
    this.pool = new Pool({
      connectionString: config.connectionString,
      ssl: config.ssl !== false ? { rejectUnauthorized: false } : undefined,
    });
    this.tenantId = config.tenantId;
  }

  async ready(): Promise<void> {
    // Test connection
    await this.pool.query('SELECT 1');
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  /** Get the raw database pool (for advanced use cases) */
  get db(): Pool {
    return this.pool;
  }

  // ============ Workflow Operations ============

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

  async getWorkflow(id: string): Promise<Workflow | null> {
    const result = await this.pool.query<any>(
      'SELECT * FROM jobs WHERE id = $1 AND tenant_id = $2',
      [id, this.tenantId]
    );
    return result.rows[0] ? this.mapWorkflow(result.rows[0]) : null;
  }

  async updateWorkflowStatus(
    id: string,
    status: WorkflowStatus,
    output?: Record<string, unknown>,
    error?: string
  ): Promise<void> {
    const completedAt =
      status === 'completed' || status === 'failed' ? 'now()' : null;
    await this.pool.query(
      `UPDATE jobs SET
        status = $2,
        result_payload = COALESCE($3, result_payload),
        completed_at = $4,
        updated_at = now()
       WHERE id = $1 AND tenant_id = $5`,
      [
        id,
        status,
        output ? JSON.stringify(output) : null,
        completedAt,
        this.tenantId,
      ]
    );
  }

  async listWorkflows(
    options: { status?: WorkflowStatus; limit?: number; offset?: number } = {}
  ): Promise<Workflow[]> {
    const { status, limit = 50, offset = 0 } = options;
    let query = 'SELECT * FROM jobs WHERE tenant_id = $1';
    const params: unknown[] = [this.tenantId];

    if (status) {
      params.push(status);
      query += ` AND status = $${params.length}`;
    }

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await this.pool.query<any>(query, params);
    return result.rows.map((row) => this.mapWorkflow(row));
  }

  // ============ Task Operations ============

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

    return result.rows.map((row) => this.mapTask(row));
  }

  async getWorkflowTasks(workflowId: string): Promise<Task[]> {
    const result = await this.pool.query<any>(
      'SELECT * FROM task_nodes WHERE job_id = $1 ORDER BY created_at',
      [workflowId]
    );
    return result.rows.map((row) => this.mapTask(row));
  }

  async claimTask(
    workerId: string,
    taskTypes?: string[]
  ): Promise<Task | null> {
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

  async heartbeat(taskId: string): Promise<void> {
    await this.pool.query(
      'UPDATE task_nodes SET heartbeat_at = now() WHERE id = $1',
      [taskId]
    );
  }

  async completeTask(
    taskId: string,
    output: Record<string, unknown>
  ): Promise<void> {
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

  // ============ Checkpoint Operations ============

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

  async getCheckpoint(
    taskId: string
  ): Promise<{ stepIndex: number; state: Record<string, unknown> } | null> {
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

  async getWorkflowCheckpoints(workflowId: string): Promise<
    Array<{
      taskId: string;
      taskName: string;
      stepIndex: number;
      state: Record<string, unknown>;
      createdAt: Date;
    }>
  > {
    const result = await this.pool.query<any>(
      `SELECT c.task_id, t.name as task_name, c.step_number, c.state, c.created_at
       FROM checkpoints c
       JOIN task_nodes t ON c.task_id = t.id
       WHERE t.job_id = $1
       ORDER BY c.created_at DESC`,
      [workflowId]
    );

    return result.rows.map((row) => ({
      taskId: row.task_id,
      taskName: row.task_name,
      stepIndex: row.step_number,
      state: row.state,
      createdAt: row.created_at,
    }));
  }

  // ============ Memory Operations ============

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
      [
        this.tenantId,
        taskId,
        eventType,
        summary,
        embedding,
        taskType,
        errorCategory,
        resolution,
      ]
    );
  }

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
    const embeddingStr = `ARRAY[${embedding.join(',')}]::FLOAT8[]`;

    let query = `
      SELECT
        context_summary as summary,
        event_type,
        resolution,
        COALESCE(
          (SELECT SUM(a * b) FROM UNNEST(embedding, ${embeddingStr}) AS t(a, b)) /
          NULLIF(
            SQRT((SELECT SUM(a * a) FROM UNNEST(embedding) AS t(a))) *
            SQRT((SELECT SUM(b * b) FROM UNNEST(${embeddingStr}) AS t(b))),
            0
          ),
          0
        ) AS similarity
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

  // ============ Workflow Status ============

  async isWorkflowComplete(workflowId: string): Promise<{
    complete: boolean;
    failed: number;
    done: number;
    pending: number;
  }> {
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

  // ============ Time Travel ============

  async replayFromCheckpoint(
    workflowId: string,
    checkpointId: string,
    newInput?: Record<string, unknown>
  ): Promise<Workflow> {
    // Get the original workflow
    const workflow = await this.getWorkflow(workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    // Create a new workflow with the same config
    const newWorkflow = await this.createWorkflow(
      workflow.name,
      workflow.version,
      newInput || workflow.input,
      0
    );

    // TODO: Copy state from checkpoint to new workflow
    // This is a simplified implementation

    return newWorkflow;
  }

  // ============ Cost Tracking ============

  async getWorkflowCost(workflowId: string): Promise<{
    totalTokens: number;
    estimatedCostUsd: number;
    savedByRecoveryUsd: number;
  }> {
    // This would query metrics if available
    // For now, return placeholder
    return {
      totalTokens: 0,
      estimatedCostUsd: 0,
      savedByRecoveryUsd: 0,
    };
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
