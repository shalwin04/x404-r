import { createHash, randomBytes } from 'crypto';
import type { Database } from './db.js';
import type { TenantContext, ApiKey, Tenant, TenantPlan } from './types.js';

/**
 * API key prefix used for identification
 */
export const API_KEY_PREFIX = 'af_';

/**
 * Generate a new API key
 * @returns Object containing the full key (only shown once), hash, and prefix
 */
export function generateApiKey(): { key: string; hash: string; prefix: string } {
  // Generate 32 random bytes and encode as base64
  const randomPart = randomBytes(32).toString('base64url');
  const key = `${API_KEY_PREFIX}${randomPart}`;
  const hash = hashApiKey(key);
  const prefix = key.slice(0, 10);

  return { key, hash, prefix };
}

/**
 * Hash an API key using SHA-256
 */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/**
 * Validate an API key and return the tenant context
 * @returns TenantContext if valid, null if invalid
 */
export async function validateApiKey(
  db: Database,
  apiKey: string
): Promise<TenantContext | null> {
  if (!apiKey || !apiKey.startsWith(API_KEY_PREFIX)) {
    return null;
  }

  const keyHash = hashApiKey(apiKey);

  // Query for the API key and join with tenant to get plan info
  const result = await db.query<ApiKey & { tenant_plan: TenantPlan }>(
    `SELECT ak.*, t.plan as tenant_plan
     FROM api_keys ak
     JOIN tenants t ON ak.tenant_id = t.id
     WHERE ak.key_hash = $1
       AND (ak.expires_at IS NULL OR ak.expires_at > now())`,
    [keyHash]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const apiKeyRecord = result.rows[0];

  // Update last_used_at
  await db.query(
    'UPDATE api_keys SET last_used_at = now() WHERE id = $1',
    [apiKeyRecord.id]
  );

  return {
    tenantId: apiKeyRecord.tenant_id,
    userId: apiKeyRecord.created_by ?? undefined,
    plan: apiKeyRecord.tenant_plan,
    scopes: apiKeyRecord.scopes,
  };
}

/**
 * Create a new API key for a tenant
 */
export async function createApiKey(
  db: Database,
  tenantId: string,
  name: string,
  scopes: string[] = ['jobs:read', 'jobs:write', 'tasks:read'],
  createdBy?: string,
  expiresAt?: Date
): Promise<{ id: string; key: string; prefix: string }> {
  const { key, hash, prefix } = generateApiKey();

  const result = await db.query<{ id: string }>(
    `INSERT INTO api_keys (tenant_id, name, key_hash, key_prefix, scopes, created_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [tenantId, name, hash, prefix, scopes, createdBy ?? null, expiresAt ?? null]
  );

  return {
    id: result.rows[0].id,
    key,
    prefix,
  };
}

/**
 * Revoke an API key
 */
export async function revokeApiKey(
  db: Database,
  tenantId: string,
  keyId: string
): Promise<boolean> {
  const result = await db.query(
    'DELETE FROM api_keys WHERE id = $1 AND tenant_id = $2',
    [keyId, tenantId]
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * List API keys for a tenant (without exposing the key hash)
 */
export async function listApiKeys(
  db: Database,
  tenantId: string
): Promise<Omit<ApiKey, 'key_hash'>[]> {
  const result = await db.query<ApiKey>(
    `SELECT id, tenant_id, name, key_prefix, scopes, last_used_at, expires_at, created_by, created_at
     FROM api_keys
     WHERE tenant_id = $1
     ORDER BY created_at DESC`,
    [tenantId]
  );
  return result.rows;
}

/**
 * Check if a scope is included in the tenant context
 */
export function hasScope(context: TenantContext, scope: string): boolean {
  // Check for exact match or wildcard
  return context.scopes.includes(scope) || context.scopes.includes('*');
}

/**
 * Check if tenant has required scopes, throw if not
 */
export function requireScopes(context: TenantContext, ...scopes: string[]): void {
  for (const scope of scopes) {
    if (!hasScope(context, scope)) {
      throw new Error(`Missing required scope: ${scope}`);
    }
  }
}

/**
 * Create a new tenant
 */
export async function createTenant(
  db: Database,
  name: string,
  slug: string,
  plan: TenantPlan = 'free'
): Promise<Tenant> {
  const limits = getTenantLimits(plan);

  const result = await db.query<Tenant>(
    `INSERT INTO tenants (name, slug, plan, task_limit_monthly, concurrent_task_limit, memory_retention_days)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [name, slug, plan, limits.taskLimit, limits.concurrentLimit, limits.retentionDays]
  );

  // Create initial usage record
  const billingPeriod = getBillingPeriod();
  await db.query(
    `INSERT INTO usage_monthly (tenant_id, billing_period)
     VALUES ($1, $2)`,
    [result.rows[0].id, billingPeriod]
  );

  return result.rows[0];
}

/**
 * Get tenant by ID
 */
export async function getTenant(db: Database, tenantId: string): Promise<Tenant | null> {
  const result = await db.query<Tenant>(
    'SELECT * FROM tenants WHERE id = $1',
    [tenantId]
  );
  return result.rows[0] ?? null;
}

/**
 * Get tenant by slug
 */
export async function getTenantBySlug(db: Database, slug: string): Promise<Tenant | null> {
  const result = await db.query<Tenant>(
    'SELECT * FROM tenants WHERE slug = $1',
    [slug]
  );
  return result.rows[0] ?? null;
}

/**
 * Get default limits for a plan
 */
export function getTenantLimits(plan: TenantPlan): {
  taskLimit: number;
  concurrentLimit: number;
  retentionDays: number;
} {
  const limits: Record<TenantPlan, { taskLimit: number; concurrentLimit: number; retentionDays: number }> = {
    free: { taskLimit: 100, concurrentLimit: 2, retentionDays: 7 },
    pro: { taskLimit: 1000, concurrentLimit: 10, retentionDays: 30 },
    team: { taskLimit: 5000, concurrentLimit: 25, retentionDays: 90 },
    enterprise: { taskLimit: 50000, concurrentLimit: 100, retentionDays: 365 },
  };
  return limits[plan];
}

/**
 * Get current billing period in YYYY-MM format
 */
export function getBillingPeriod(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}
