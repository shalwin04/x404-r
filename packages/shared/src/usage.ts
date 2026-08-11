import type { Database } from './db.js';
import type { TenantContext, UsageLimits, UsageMonthly, Tenant } from './types.js';
import { getBillingPeriod } from './auth.js';

/**
 * Usage event types
 */
export type UsageEventType =
  | 'task_created'
  | 'task_completed'
  | 'task_failed'
  | 'job_created'
  | 'api_call'
  | 'ai_tokens';

/**
 * Record a usage event
 */
export async function recordUsageEvent(
  db: Database,
  context: TenantContext,
  eventType: UsageEventType,
  quantity: number = 1,
  metadata: Record<string, unknown> = {},
  jobId?: string,
  taskId?: string
): Promise<void> {
  const billingPeriod = getBillingPeriod();

  // Insert the usage event
  await db.query(
    `INSERT INTO usage_events (tenant_id, event_type, quantity, billing_period, job_id, task_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      context.tenantId,
      eventType,
      quantity,
      billingPeriod,
      jobId ?? null,
      taskId ?? null,
      JSON.stringify(metadata),
    ]
  );

  // Update the monthly aggregate
  await updateMonthlyUsage(db, context.tenantId, billingPeriod, eventType, quantity);
}

/**
 * Update monthly usage aggregate
 */
async function updateMonthlyUsage(
  db: Database,
  tenantId: string,
  billingPeriod: string,
  eventType: UsageEventType,
  quantity: number
): Promise<void> {
  // Map event type to column name
  const columnMap: Record<UsageEventType, string> = {
    task_created: 'tasks_created',
    task_completed: 'tasks_completed',
    task_failed: 'tasks_failed',
    job_created: 'jobs_created',
    api_call: 'api_calls',
    ai_tokens: 'ai_tokens_used',
  };

  const column = columnMap[eventType];
  if (!column) return;

  // Upsert the monthly usage record
  await db.query(
    `INSERT INTO usage_monthly (tenant_id, billing_period, ${column})
     VALUES ($1, $2, $3)
     ON CONFLICT (tenant_id, billing_period)
     DO UPDATE SET ${column} = usage_monthly.${column} + $3, updated_at = now()`,
    [tenantId, billingPeriod, quantity]
  );
}

/**
 * Get current month usage for a tenant
 */
export async function getCurrentUsage(
  db: Database,
  tenantId: string
): Promise<UsageMonthly | null> {
  const billingPeriod = getBillingPeriod();

  const result = await db.query<UsageMonthly>(
    `SELECT * FROM usage_monthly
     WHERE tenant_id = $1 AND billing_period = $2`,
    [tenantId, billingPeriod]
  );

  if (result.rows.length === 0) {
    // Create initial record if not exists
    await db.query(
      `INSERT INTO usage_monthly (tenant_id, billing_period)
       VALUES ($1, $2)
       ON CONFLICT (tenant_id, billing_period) DO NOTHING`,
      [tenantId, billingPeriod]
    );

    return {
      id: '',
      tenant_id: tenantId,
      billing_period: billingPeriod,
      tasks_created: 0,
      tasks_completed: 0,
      tasks_failed: 0,
      jobs_created: 0,
      api_calls: 0,
      ai_tokens_used: 0,
      created_at: new Date(),
      updated_at: new Date(),
    };
  }

  return result.rows[0];
}

/**
 * Check usage limits for a tenant
 */
export async function checkUsageLimits(
  db: Database,
  context: TenantContext
): Promise<UsageLimits> {
  // Get tenant limits
  const tenantResult = await db.query<Tenant>(
    'SELECT * FROM tenants WHERE id = $1',
    [context.tenantId]
  );

  if (tenantResult.rows.length === 0) {
    throw new Error('Tenant not found');
  }

  const tenant = tenantResult.rows[0];
  const usage = await getCurrentUsage(db, context.tenantId);

  const used = usage?.tasks_created ?? 0;
  const limit = tenant.task_limit_monthly;
  const remaining = Math.max(0, limit - used);
  const allowed = remaining > 0;

  // Calculate reset date (first day of next month)
  const now = new Date();
  const resetAt = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  return {
    allowed,
    remaining,
    limit,
    used,
    resetAt,
  };
}

/**
 * Check if tenant can create more tasks
 * Returns true if under limit, throws RateLimitError if exceeded
 */
export async function enforceUsageLimits(
  db: Database,
  context: TenantContext
): Promise<UsageLimits> {
  const limits = await checkUsageLimits(db, context);

  if (!limits.allowed) {
    const resetIn = Math.ceil((limits.resetAt.getTime() - Date.now()) / 1000);
    throw new UsageLimitExceededError(
      `Monthly task limit exceeded. Limit: ${limits.limit}, Used: ${limits.used}. Resets in ${Math.ceil(resetIn / 86400)} days.`,
      resetIn
    );
  }

  return limits;
}

/**
 * Custom error for usage limit exceeded
 */
export class UsageLimitExceededError extends Error {
  public readonly statusCode = 429;
  public readonly retryAfter: number;

  constructor(message: string, retryAfterSeconds: number) {
    super(message);
    this.name = 'UsageLimitExceededError';
    this.retryAfter = retryAfterSeconds;
  }
}

/**
 * Get usage history for a tenant
 */
export async function getUsageHistory(
  db: Database,
  tenantId: string,
  months: number = 6
): Promise<UsageMonthly[]> {
  const result = await db.query<UsageMonthly>(
    `SELECT * FROM usage_monthly
     WHERE tenant_id = $1
     ORDER BY billing_period DESC
     LIMIT $2`,
    [tenantId, months]
  );

  return result.rows;
}

/**
 * Get detailed usage events for a billing period
 */
export async function getUsageEvents(
  db: Database,
  tenantId: string,
  billingPeriod?: string,
  limit: number = 100
): Promise<Array<{
  event_type: string;
  quantity: number;
  created_at: Date;
  metadata: Record<string, unknown>;
}>> {
  const period = billingPeriod ?? getBillingPeriod();

  const result = await db.query<{
    event_type: string;
    quantity: number;
    created_at: Date;
    metadata: Record<string, unknown>;
  }>(
    `SELECT event_type, quantity, created_at, metadata
     FROM usage_events
     WHERE tenant_id = $1 AND billing_period = $2
     ORDER BY created_at DESC
     LIMIT $3`,
    [tenantId, period, limit]
  );

  return result.rows;
}

/**
 * Check concurrent task limit
 */
export async function checkConcurrentLimit(
  db: Database,
  context: TenantContext
): Promise<{ allowed: boolean; current: number; limit: number }> {
  // Get tenant concurrent limit
  const tenantResult = await db.query<Tenant>(
    'SELECT concurrent_task_limit FROM tenants WHERE id = $1',
    [context.tenantId]
  );

  if (tenantResult.rows.length === 0) {
    throw new Error('Tenant not found');
  }

  const limit = tenantResult.rows[0].concurrent_task_limit;

  // Count currently running tasks
  const countResult = await db.query<{ count: string }>(
    `SELECT COUNT(*) as count FROM task_nodes
     WHERE tenant_id = $1 AND status IN ('claimed', 'running')`,
    [context.tenantId]
  );

  const current = parseInt(countResult.rows[0].count);
  const allowed = current < limit;

  return { allowed, current, limit };
}
