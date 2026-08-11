import { Pool, PoolConfig, QueryResult } from 'pg';
import type {
  Job,
  TaskNode,
  MemoryVector,
  CreateJobInput,
  CreateTaskInput,
  ClaimResult,
  JobProgress,
  TaskStatus,
  Tenant,
} from './types.js';

/**
 * Default tenant ID for unauthenticated/demo access
 * Duplicated here to avoid circular import with tenant-db.ts
 */
const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000000';

export class Database {
  private pool: Pool;

  constructor(config?: PoolConfig) {
    this.pool = new Pool(
      config ?? {
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
      }
    );
  }

  async query<T = unknown>(text: string, params?: unknown[]): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, params);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  // ============ Jobs ============

  async createJob(input: CreateJobInput, tenantId: string = DEFAULT_TENANT_ID): Promise<Job> {
    const result = await this.query<Job>(
      `INSERT INTO jobs (tenant_id, name, description, input_payload, priority)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [tenantId, input.name, input.description ?? null, JSON.stringify(input.input_payload), input.priority ?? 0]
    );
    return result.rows[0];
  }

  async getJob(id: string): Promise<Job | null> {
    const result = await this.query<Job>('SELECT * FROM jobs WHERE id = $1', [id]);
    return result.rows[0] ?? null;
  }

  async updateJobStatus(id: string, status: string): Promise<void> {
    const completedAt = status === 'completed' || status === 'failed' ? 'now()' : 'NULL';
    await this.query(
      `UPDATE jobs SET status = $2, completed_at = ${completedAt}, updated_at = now() WHERE id = $1`,
      [id, status]
    );
  }

  async getJobProgress(id: string): Promise<JobProgress | null> {
    const result = await this.query<JobProgress>(
      'SELECT * FROM job_progress WHERE id = $1',
      [id]
    );
    return result.rows[0] ?? null;
  }

  async listJobs(limit = 50): Promise<Job[]> {
    const result = await this.query<Job>(
      'SELECT * FROM jobs ORDER BY created_at DESC LIMIT $1',
      [limit]
    );
    return result.rows;
  }

  // ============ Tasks ============

  async createTask(input: CreateTaskInput, tenantId: string = DEFAULT_TENANT_ID): Promise<TaskNode> {
    const result = await this.query<TaskNode>(
      `INSERT INTO task_nodes (tenant_id, job_id, task_type, name, input_payload, depends_on, max_attempts)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        tenantId,
        input.job_id,
        input.task_type,
        input.name,
        JSON.stringify(input.input_payload),
        input.depends_on ?? [],
        input.max_attempts ?? 3,
      ]
    );
    return result.rows[0];
  }

  async createTasks(inputs: CreateTaskInput[], tenantId: string = DEFAULT_TENANT_ID): Promise<TaskNode[]> {
    if (inputs.length === 0) return [];

    const values: unknown[] = [];
    const placeholders: string[] = [];
    let paramIndex = 1;

    for (const input of inputs) {
      placeholders.push(
        `($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`
      );
      values.push(
        tenantId,
        input.job_id,
        input.task_type,
        input.name,
        JSON.stringify(input.input_payload),
        input.depends_on ?? [],
        input.max_attempts ?? 3
      );
    }

    const result = await this.query<TaskNode>(
      `INSERT INTO task_nodes (tenant_id, job_id, task_type, name, input_payload, depends_on, max_attempts)
       VALUES ${placeholders.join(', ')}
       RETURNING *`,
      values
    );
    return result.rows;
  }

  async getTask(id: string): Promise<TaskNode | null> {
    const result = await this.query<TaskNode>('SELECT * FROM task_nodes WHERE id = $1', [id]);
    return result.rows[0] ?? null;
  }

  async getTasksByJob(jobId: string): Promise<TaskNode[]> {
    const result = await this.query<TaskNode>(
      'SELECT * FROM task_nodes WHERE job_id = $1 ORDER BY created_at',
      [jobId]
    );
    return result.rows;
  }

  /**
   * Atomic task claim using FOR UPDATE SKIP LOCKED
   * Returns the claimed task or null if none available
   * Tasks are prioritized by: tenant plan > job priority > creation time
   */
  async claimTask(workerId: string): Promise<ClaimResult> {
    const result = await this.query<TaskNode>(
      `WITH ready_tasks AS (
        SELECT t.id FROM task_nodes t
        JOIN jobs j ON t.job_id = j.id
        JOIN tenants ten ON t.tenant_id = ten.id
        WHERE t.status = 'pending'
          AND NOT EXISTS (
            SELECT 1 FROM task_nodes dep
            WHERE dep.id = ANY(t.depends_on) AND dep.status != 'done'
          )
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
          claimed_by = $1,
          claimed_at = now(),
          heartbeat_at = now(),
          attempt_count = attempt_count + 1,
          updated_at = now()
      FROM ready_tasks
      WHERE task_nodes.id = ready_tasks.id
      RETURNING task_nodes.*`
      , [workerId]
    );

    if (result.rows.length === 0) {
      return { task: null, claimed: false };
    }

    return { task: result.rows[0], claimed: true };
  }

  async updateTaskStatus(
    id: string,
    status: TaskStatus,
    output?: Record<string, unknown>,
    errorMessage?: string
  ): Promise<void> {
    const completedAt = status === 'done' || status === 'failed' ? 'now()' : null;
    await this.query(
      `UPDATE task_nodes
       SET status = $2,
           output_payload = COALESCE($3, output_payload),
           error_message = $4,
           completed_at = $5,
           updated_at = now()
       WHERE id = $1`,
      [
        id,
        status,
        output ? JSON.stringify(output) : null,
        errorMessage ?? null,
        completedAt,
      ]
    );
  }

  async updateHeartbeat(id: string): Promise<void> {
    await this.query(
      `UPDATE task_nodes SET heartbeat_at = now() WHERE id = $1`,
      [id]
    );
  }

  /**
   * Reclaim stale tasks (workers that died without completing)
   * Returns the number of tasks reclaimed
   */
  async reclaimStaleTasks(staleThresholdSeconds = 60): Promise<number> {
    const result = await this.query(
      `UPDATE task_nodes
       SET status = 'pending', claimed_by = NULL, claimed_at = NULL
       WHERE status = 'running'
         AND heartbeat_at < now() - INTERVAL '${staleThresholdSeconds} seconds'
         AND attempt_count < max_attempts
       RETURNING id`
    );
    return result.rowCount ?? 0;
  }

  /**
   * Mark tasks as failed if they've exceeded max attempts
   */
  async failExhaustedTasks(): Promise<number> {
    const result = await this.query(
      `UPDATE task_nodes
       SET status = 'failed',
           error_message = COALESCE(error_message, 'Max attempts exceeded'),
           completed_at = now()
       WHERE status IN ('running', 'pending')
         AND attempt_count >= max_attempts
       RETURNING id`
    );
    return result.rowCount ?? 0;
  }

  // ============ Memory Vectors ============

  async storeMemory(
    taskId: string | null,
    eventType: string,
    contextSummary: string,
    embedding: number[],
    taskType?: string,
    errorCategory?: string,
    resolution?: string,
    tenantId: string = DEFAULT_TENANT_ID
  ): Promise<MemoryVector> {
    const result = await this.query<MemoryVector>(
      `INSERT INTO memory_vectors
       (tenant_id, task_id, event_type, context_summary, embedding, task_type, error_category, resolution)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [tenantId, taskId, eventType, contextSummary, embedding, taskType, errorCategory, resolution]
    );
    return result.rows[0];
  }

  /**
   * Query similar memories using cosine similarity
   * Note: CockroachDB doesn't have native vector ops, so we compute in SQL
   */
  async querySimilarMemories(
    embedding: number[],
    taskType?: string,
    limit = 5,
    tenantId?: string
  ): Promise<MemoryVector[]> {
    // Cosine similarity computation in SQL
    // For better performance in production, consider using CockroachDB's vector indexing
    const embeddingStr = `ARRAY[${embedding.join(',')}]::FLOAT8[]`;

    let query = `
      SELECT *,
        (SELECT SUM(a * b) FROM UNNEST(embedding, ${embeddingStr}) AS t(a, b)) /
        (SQRT((SELECT SUM(a * a) FROM UNNEST(embedding) AS t(a))) *
         SQRT((SELECT SUM(b * b) FROM UNNEST(${embeddingStr}) AS t(b)))) AS similarity
      FROM memory_vectors
    `;

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (tenantId) {
      params.push(tenantId);
      conditions.push(`tenant_id = $${params.length}`);
    }

    if (taskType) {
      params.push(taskType);
      conditions.push(`task_type = $${params.length}`);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query += ` ORDER BY similarity DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await this.query<MemoryVector & { similarity: number }>(query, params);
    return result.rows;
  }

  async getMemoriesForTask(taskId: string): Promise<MemoryVector[]> {
    const result = await this.query<MemoryVector>(
      'SELECT * FROM memory_vectors WHERE task_id = $1 ORDER BY created_at DESC',
      [taskId]
    );
    return result.rows;
  }

  // ============ Utilities ============

  /**
   * Check if all tasks for a job are complete
   */
  async isJobComplete(jobId: string): Promise<boolean> {
    const result = await this.query<{ incomplete: number }>(
      `SELECT COUNT(*) as incomplete FROM task_nodes
       WHERE job_id = $1 AND status NOT IN ('done', 'failed')`,
      [jobId]
    );
    return result.rows[0].incomplete === 0;
  }

  /**
   * Get job completion stats
   */
  async getJobStats(jobId: string): Promise<{
    total: number;
    done: number;
    failed: number;
    pending: number;
    running: number;
  }> {
    const result = await this.query<{
      total: string;
      done: string;
      failed: string;
      pending: string;
      running: string;
    }>(
      `SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'done') as done,
        COUNT(*) FILTER (WHERE status = 'failed') as failed,
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status IN ('claimed', 'running')) as running
       FROM task_nodes WHERE job_id = $1`,
      [jobId]
    );
    const row = result.rows[0];
    return {
      total: parseInt(row.total),
      done: parseInt(row.done),
      failed: parseInt(row.failed),
      pending: parseInt(row.pending),
      running: parseInt(row.running),
    };
  }
}

// Singleton instance
let db: Database | null = null;

export function getDatabase(): Database {
  if (!db) {
    db = new Database();
  }
  return db;
}

export function createDatabase(config?: PoolConfig): Database {
  return new Database(config);
}
