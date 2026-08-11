import { Database } from './db.js';
import type {
  TenantContext,
  Job,
  TaskNode,
  MemoryVector,
  CreateJobInput,
  CreateTaskInput,
  JobProgress,
  TaskStatus,
  Tenant,
  TenantPlan,
} from './types.js';

/**
 * Default tenant ID for unauthenticated/demo access
 */
export const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Default tenant context for demo mode
 */
export const DEFAULT_TENANT_CONTEXT: TenantContext = {
  tenantId: DEFAULT_TENANT_ID,
  plan: 'free',
  scopes: ['jobs:read', 'jobs:write', 'tasks:read', 'tasks:write'],
};

/**
 * TenantDatabase wraps Database with tenant context
 * Auto-injects tenant_id into all queries
 */
export class TenantDatabase {
  constructor(
    private db: Database,
    private context: TenantContext
  ) {}

  get tenantId(): string {
    return this.context.tenantId;
  }

  get tenantContext(): TenantContext {
    return this.context;
  }

  /**
   * Get the underlying database for raw queries
   */
  get rawDb(): Database {
    return this.db;
  }

  // ============ Tenant Operations ============

  async getTenant(): Promise<Tenant | null> {
    const result = await this.db.query<Tenant>(
      'SELECT * FROM tenants WHERE id = $1',
      [this.context.tenantId]
    );
    return result.rows[0] ?? null;
  }

  // ============ Jobs ============

  async createJob(input: CreateJobInput): Promise<Job> {
    const result = await this.db.query<Job>(
      `INSERT INTO jobs (tenant_id, name, description, input_payload, priority)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        this.context.tenantId,
        input.name,
        input.description ?? null,
        JSON.stringify(input.input_payload),
        input.priority ?? 0,
      ]
    );
    return result.rows[0];
  }

  async getJob(id: string): Promise<Job | null> {
    const result = await this.db.query<Job>(
      'SELECT * FROM jobs WHERE id = $1 AND tenant_id = $2',
      [id, this.context.tenantId]
    );
    return result.rows[0] ?? null;
  }

  async updateJobStatus(id: string, status: string): Promise<void> {
    const completedAt = status === 'completed' || status === 'failed' ? 'now()' : 'NULL';
    await this.db.query(
      `UPDATE jobs SET status = $2, completed_at = ${completedAt}, updated_at = now()
       WHERE id = $1 AND tenant_id = $3`,
      [id, status, this.context.tenantId]
    );
  }

  async getJobProgress(id: string): Promise<JobProgress | null> {
    const result = await this.db.query<JobProgress>(
      'SELECT * FROM job_progress WHERE id = $1 AND tenant_id = $2',
      [id, this.context.tenantId]
    );
    return result.rows[0] ?? null;
  }

  async listJobs(limit = 50): Promise<Job[]> {
    const result = await this.db.query<Job>(
      'SELECT * FROM jobs WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2',
      [this.context.tenantId, limit]
    );
    return result.rows;
  }

  // ============ Tasks ============

  async createTask(input: CreateTaskInput): Promise<TaskNode> {
    const result = await this.db.query<TaskNode>(
      `INSERT INTO task_nodes (tenant_id, job_id, task_type, name, input_payload, depends_on, max_attempts)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        this.context.tenantId,
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

  async createTasks(inputs: CreateTaskInput[]): Promise<TaskNode[]> {
    if (inputs.length === 0) return [];

    const values: unknown[] = [];
    const placeholders: string[] = [];
    let paramIndex = 1;

    for (const input of inputs) {
      placeholders.push(
        `($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`
      );
      values.push(
        this.context.tenantId,
        input.job_id,
        input.task_type,
        input.name,
        JSON.stringify(input.input_payload),
        input.depends_on ?? [],
        input.max_attempts ?? 3
      );
    }

    const result = await this.db.query<TaskNode>(
      `INSERT INTO task_nodes (tenant_id, job_id, task_type, name, input_payload, depends_on, max_attempts)
       VALUES ${placeholders.join(', ')}
       RETURNING *`,
      values
    );
    return result.rows;
  }

  async getTask(id: string): Promise<TaskNode | null> {
    const result = await this.db.query<TaskNode>(
      'SELECT * FROM task_nodes WHERE id = $1 AND tenant_id = $2',
      [id, this.context.tenantId]
    );
    return result.rows[0] ?? null;
  }

  async getTasksByJob(jobId: string): Promise<TaskNode[]> {
    const result = await this.db.query<TaskNode>(
      'SELECT * FROM task_nodes WHERE job_id = $1 AND tenant_id = $2 ORDER BY created_at',
      [jobId, this.context.tenantId]
    );
    return result.rows;
  }

  async updateTaskStatus(
    id: string,
    status: TaskStatus,
    output?: Record<string, unknown>,
    errorMessage?: string
  ): Promise<void> {
    const completedAt = status === 'done' || status === 'failed' ? 'now()' : null;
    await this.db.query(
      `UPDATE task_nodes
       SET status = $2,
           output_payload = COALESCE($3, output_payload),
           error_message = $4,
           completed_at = $5,
           updated_at = now()
       WHERE id = $1 AND tenant_id = $6`,
      [
        id,
        status,
        output ? JSON.stringify(output) : null,
        errorMessage ?? null,
        completedAt,
        this.context.tenantId,
      ]
    );
  }

  async updateHeartbeat(id: string): Promise<void> {
    await this.db.query(
      `UPDATE task_nodes SET heartbeat_at = now() WHERE id = $1 AND tenant_id = $2`,
      [id, this.context.tenantId]
    );
  }

  // ============ Memory Vectors ============

  async storeMemory(
    taskId: string | null,
    eventType: string,
    contextSummary: string,
    embedding: number[],
    taskType?: string,
    errorCategory?: string,
    resolution?: string
  ): Promise<MemoryVector> {
    const result = await this.db.query<MemoryVector>(
      `INSERT INTO memory_vectors
       (tenant_id, task_id, event_type, context_summary, embedding, task_type, error_category, resolution)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        this.context.tenantId,
        taskId,
        eventType,
        contextSummary,
        embedding,
        taskType,
        errorCategory,
        resolution,
      ]
    );
    return result.rows[0];
  }

  /**
   * Query similar memories using cosine similarity (scoped to tenant)
   */
  async querySimilarMemories(
    embedding: number[],
    taskType?: string,
    limit = 5
  ): Promise<MemoryVector[]> {
    const embeddingStr = `ARRAY[${embedding.join(',')}]::FLOAT8[]`;

    let query = `
      SELECT *,
        (SELECT SUM(a * b) FROM UNNEST(embedding, ${embeddingStr}) AS t(a, b)) /
        (SQRT((SELECT SUM(a * a) FROM UNNEST(embedding) AS t(a))) *
         SQRT((SELECT SUM(b * b) FROM UNNEST(${embeddingStr}) AS t(b)))) AS similarity
      FROM memory_vectors
      WHERE tenant_id = $1
    `;

    const params: unknown[] = [this.context.tenantId];

    if (taskType) {
      params.push(taskType);
      query += ` AND task_type = $${params.length}`;
    }

    query += ` ORDER BY similarity DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await this.db.query<MemoryVector & { similarity: number }>(query, params);
    return result.rows;
  }

  async getMemoriesForTask(taskId: string): Promise<MemoryVector[]> {
    const result = await this.db.query<MemoryVector>(
      'SELECT * FROM memory_vectors WHERE task_id = $1 AND tenant_id = $2 ORDER BY created_at DESC',
      [taskId, this.context.tenantId]
    );
    return result.rows;
  }

  // ============ Utilities ============

  async isJobComplete(jobId: string): Promise<boolean> {
    const result = await this.db.query<{ incomplete: number }>(
      `SELECT COUNT(*) as incomplete FROM task_nodes
       WHERE job_id = $1 AND tenant_id = $2 AND status NOT IN ('done', 'failed')`,
      [jobId, this.context.tenantId]
    );
    return result.rows[0].incomplete === 0;
  }

  async getJobStats(jobId: string): Promise<{
    total: number;
    done: number;
    failed: number;
    pending: number;
    running: number;
  }> {
    const result = await this.db.query<{
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
       FROM task_nodes WHERE job_id = $1 AND tenant_id = $2`,
      [jobId, this.context.tenantId]
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

/**
 * Create a TenantDatabase with the default demo tenant
 */
export function createDemoTenantDatabase(db: Database): TenantDatabase {
  return new TenantDatabase(db, DEFAULT_TENANT_CONTEXT);
}

/**
 * Get plan priority for scheduling (lower = higher priority)
 */
export function getPlanPriority(plan: TenantPlan): number {
  const priorities: Record<TenantPlan, number> = {
    enterprise: 0,
    team: 1,
    pro: 2,
    free: 3,
  };
  return priorities[plan] ?? 3;
}
