import { createHash, randomBytes } from 'crypto';
import type { Database } from './db.js';
import type { User, TenantContext, Membership, Tenant } from './types.js';

/**
 * Session token prefix
 */
export const SESSION_PREFIX = 'sess_';

/**
 * Session data stored in memory (for local dev) or could be Redis in production
 */
interface Session {
  userId: string;
  email: string;
  githubId?: string;
  createdAt: Date;
  expiresAt: Date;
}

// In-memory session store (replace with Redis in production)
const sessions = new Map<string, Session>();

/**
 * Generate a session token
 */
export function generateSessionToken(): string {
  return `${SESSION_PREFIX}${randomBytes(32).toString('base64url')}`;
}

/**
 * Create a session for a user
 */
export function createSession(user: User, expiresInHours = 24 * 7): string {
  const token = generateSessionToken();
  const session: Session = {
    userId: user.id,
    email: user.email,
    githubId: user.github_id,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + expiresInHours * 60 * 60 * 1000),
  };
  sessions.set(token, session);
  return token;
}

/**
 * Get session by token
 */
export function getSession(token: string): Session | null {
  const session = sessions.get(token);
  if (!session) return null;

  // Check expiration
  if (session.expiresAt < new Date()) {
    sessions.delete(token);
    return null;
  }

  return session;
}

/**
 * Delete session
 */
export function deleteSession(token: string): boolean {
  return sessions.delete(token);
}

/**
 * Get user from session token
 */
export async function getUserFromSession(
  db: Database,
  token: string
): Promise<User | null> {
  const session = getSession(token);
  if (!session) return null;

  const result = await db.query<User>(
    'SELECT * FROM users WHERE id = $1',
    [session.userId]
  );
  return result.rows[0] ?? null;
}

/**
 * Get user's memberships
 */
export async function getUserMemberships(
  db: Database,
  userId: string
): Promise<Array<Membership & { tenant: Tenant }>> {
  const result = await db.query<Membership & { tenant_name: string; tenant_slug: string; tenant_plan: string }>(
    `SELECT m.*, t.name as tenant_name, t.slug as tenant_slug, t.plan as tenant_plan
     FROM memberships m
     JOIN tenants t ON m.tenant_id = t.id
     WHERE m.user_id = $1
     ORDER BY m.created_at DESC`,
    [userId]
  );

  return result.rows.map(row => ({
    ...row,
    tenant: {
      id: row.tenant_id,
      name: row.tenant_name,
      slug: row.tenant_slug,
      plan: row.tenant_plan,
    } as unknown as Tenant,
  }));
}

/**
 * Find or create user by GitHub profile
 */
export async function findOrCreateGitHubUser(
  db: Database,
  githubProfile: {
    id: string;
    email: string;
    name?: string;
    avatar_url?: string;
    access_token: string;
  }
): Promise<User> {
  // Try to find existing user by GitHub ID
  let result = await db.query<User>(
    'SELECT * FROM users WHERE github_id = $1',
    [githubProfile.id]
  );

  if (result.rows.length > 0) {
    // Update access token and return
    await db.query(
      `UPDATE users SET
        github_access_token = $2,
        avatar_url = COALESCE($3, avatar_url),
        name = COALESCE($4, name),
        updated_at = now()
       WHERE id = $1`,
      [result.rows[0].id, githubProfile.access_token, githubProfile.avatar_url, githubProfile.name]
    );
    return result.rows[0];
  }

  // Try to find by email
  result = await db.query<User>(
    'SELECT * FROM users WHERE email = $1',
    [githubProfile.email]
  );

  if (result.rows.length > 0) {
    // Link GitHub to existing user
    await db.query(
      `UPDATE users SET
        github_id = $2,
        github_access_token = $3,
        avatar_url = COALESCE($4, avatar_url),
        updated_at = now()
       WHERE id = $1`,
      [result.rows[0].id, githubProfile.id, githubProfile.access_token, githubProfile.avatar_url]
    );
    return { ...result.rows[0], github_id: githubProfile.id };
  }

  // Create new user
  const insertResult = await db.query<User>(
    `INSERT INTO users (email, name, github_id, github_access_token, avatar_url)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      githubProfile.email,
      githubProfile.name ?? null,
      githubProfile.id,
      githubProfile.access_token,
      githubProfile.avatar_url ?? null,
    ]
  );

  return insertResult.rows[0];
}

/**
 * Add user to tenant
 */
export async function addUserToTenant(
  db: Database,
  userId: string,
  tenantId: string,
  role: 'owner' | 'admin' | 'member' | 'viewer' = 'member'
): Promise<Membership> {
  const result = await db.query<Membership>(
    `INSERT INTO memberships (user_id, tenant_id, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = $3, updated_at = now()
     RETURNING *`,
    [userId, tenantId, role]
  );
  return result.rows[0];
}

/**
 * Create a personal tenant for a new user
 */
export async function createPersonalTenant(
  db: Database,
  user: User
): Promise<Tenant> {
  // Generate a slug from email
  const baseSlug = user.email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '-');
  let slug = baseSlug;
  let counter = 1;

  // Ensure unique slug
  while (true) {
    const existing = await db.query('SELECT id FROM tenants WHERE slug = $1', [slug]);
    if (existing.rows.length === 0) break;
    slug = `${baseSlug}-${counter++}`;
  }

  // Create tenant
  const tenantResult = await db.query<Tenant>(
    `INSERT INTO tenants (name, slug, plan, task_limit_monthly, concurrent_task_limit, memory_retention_days)
     VALUES ($1, $2, 'free', 100, 2, 7)
     RETURNING *`,
    [`${user.name || user.email}'s Workspace`, slug]
  );

  const tenant = tenantResult.rows[0];

  // Add user as owner
  await addUserToTenant(db, user.id, tenant.id, 'owner');

  // Create initial usage record
  const billingPeriod = new Date().toISOString().slice(0, 7);
  await db.query(
    `INSERT INTO usage_monthly (tenant_id, billing_period)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [tenant.id, billingPeriod]
  );

  return tenant;
}

/**
 * Get tenant context for a user session
 */
export async function getTenantContextForUser(
  db: Database,
  userId: string,
  tenantId?: string
): Promise<TenantContext | null> {
  // If tenant ID provided, verify membership
  if (tenantId) {
    const result = await db.query<Membership & { plan: string }>(
      `SELECT m.*, t.plan
       FROM memberships m
       JOIN tenants t ON m.tenant_id = t.id
       WHERE m.user_id = $1 AND m.tenant_id = $2`,
      [userId, tenantId]
    );

    if (result.rows.length === 0) return null;

    return {
      tenantId,
      userId,
      plan: result.rows[0].plan as TenantContext['plan'],
      scopes: getScopesForRole(result.rows[0].role),
    };
  }

  // Get user's first tenant
  const memberships = await getUserMemberships(db, userId);
  if (memberships.length === 0) return null;

  const membership = memberships[0];
  return {
    tenantId: membership.tenant_id,
    userId,
    plan: membership.tenant.plan as TenantContext['plan'],
    scopes: getScopesForRole(membership.role),
  };
}

/**
 * Get scopes based on membership role
 */
function getScopesForRole(role: string): string[] {
  switch (role) {
    case 'owner':
      return ['*'];
    case 'admin':
      return ['jobs:read', 'jobs:write', 'jobs:delete', 'tasks:read', 'tasks:write', 'api-keys:read', 'api-keys:write'];
    case 'member':
      return ['jobs:read', 'jobs:write', 'tasks:read', 'tasks:write'];
    case 'viewer':
      return ['jobs:read', 'tasks:read'];
    default:
      return ['jobs:read', 'tasks:read'];
  }
}
