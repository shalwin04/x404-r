/**
 * Local development server that simulates the Lambda functions
 * Run with: npx tsx scripts/local-server.ts
 */

import 'dotenv/config';
import http from 'http';
import {
  createDatabase,
  Database,
  TenantDatabase,
  TenantContext,
  extractTenantContext,
  isDemoMode,
  DEFAULT_TENANT_CONTEXT,
  DEFAULT_TENANT_ID,
  checkUsageLimits,
  recordUsageEvent,
  UsageLimitExceededError,
  createTenant,
  createApiKey,
  getTenant,
  listApiKeys,
  getCurrentUsage,
  // Session management
  createSession,
  getSession,
  deleteSession,
  getUserFromSession,
  findOrCreateGitHubUser,
  getUserMemberships,
  createPersonalTenant,
  getTenantContextForUser,
} from '../packages/shared/src/index';
import {
  decompose,
  createTasksFromDecomposition,
  getDemoRefactoringTasks,
} from '../packages/supervisor/src/decompose';
import { claimTask, startTask, completeTask, failTask } from '../packages/worker/src/claim';
import { reclaimStaleTasks } from '../packages/worker/src/heartbeat';
import { executeTask, storeMemory, queryMemories } from '../packages/worker/src/executor';
import { randomUUID } from 'crypto';

const PORT = process.env.PORT || 3001;
const db = createDatabase();
const workerId = `local-worker-${randomUUID().slice(0, 8)}`;

// GitHub OAuth config
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || '';
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || '';
const GITHUB_REDIRECT_URI = process.env.GITHUB_REDIRECT_URI || `http://localhost:${PORT}/auth/github/callback`;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

// CORS headers
const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Content-Type': 'application/json',
};

// Parse JSON body
async function parseBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

// Extract tenant context from request (supports both API key and session)
async function getTenantContext(req: http.IncomingMessage): Promise<TenantContext> {
  // First try API key auth
  const context = await extractTenantContext(db, req);
  if (context) return context;

  // Try session auth
  const authHeader = req.headers['authorization'];
  if (authHeader?.startsWith('Session ')) {
    const token = authHeader.slice(8);
    const session = getSession(token);
    if (session) {
      const tenantContext = await getTenantContextForUser(db, session.userId);
      if (tenantContext) return tenantContext;
    }
  }

  // Check for session cookie
  const cookies = parseCookies(req.headers['cookie'] || '');
  if (cookies['session']) {
    const session = getSession(cookies['session']);
    if (session) {
      const tenantContext = await getTenantContextForUser(db, session.userId);
      if (tenantContext) return tenantContext;
    }
  }

  throw new AuthError('Authentication required. Provide a valid API key or login.');
}

// Parse cookies helper
function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  cookieHeader.split(';').forEach(cookie => {
    const [name, ...rest] = cookie.trim().split('=');
    if (name) {
      cookies[name] = rest.join('=');
    }
  });
  return cookies;
}

// Error classes
class AuthError extends Error {
  statusCode = 401;
}

class NotFoundError extends Error {
  statusCode = 404;
}

// Route handlers
async function handleJobs(
  req: http.IncomingMessage,
  context: TenantContext
): Promise<unknown> {
  const tenantDb = new TenantDatabase(db, context);

  if (req.method === 'GET') {
    const jobs = await tenantDb.listJobs();
    return { jobs };
  }

  if (req.method === 'POST') {
    // Check usage limits
    const limits = await checkUsageLimits(db, context);
    if (!limits.allowed) {
      throw new UsageLimitExceededError(
        `Monthly task limit exceeded. Used: ${limits.used}/${limits.limit}`,
        Math.ceil((limits.resetAt.getTime() - Date.now()) / 1000)
      );
    }

    const body = await parseBody(req);
    const { name, taskDescription, context: taskContext, priority } = body as {
      name: string;
      taskDescription: string;
      context?: Record<string, unknown>;
      priority?: number;
    };

    if (!name || !taskDescription) {
      throw new Error('name and taskDescription required');
    }

    const job = await tenantDb.createJob({
      name,
      description: String(body.description || ''),
      input_payload: { taskDescription, context: taskContext },
      priority: priority ?? 0,
    });

    // Record job creation
    await recordUsageEvent(db, context, 'job_created', 1, {}, job.id);

    const decomposition = await decompose({
      jobId: job.id,
      taskDescription,
      context: taskContext,
    });

    const taskIds = await createTasksFromDecomposition(tenantDb, job.id, decomposition);

    // Record task creation
    await recordUsageEvent(db, context, 'task_created', taskIds.length, {}, job.id);

    await tenantDb.updateJobStatus(job.id, 'running');

    const updatedLimits = await checkUsageLimits(db, context);

    return {
      jobId: job.id,
      taskCount: taskIds.length,
      tasks: decomposition.tasks.map((t, i) => ({
        id: taskIds[i],
        name: t.name,
        type: t.task_type,
      })),
      usage: {
        used: updatedLimits.used,
        limit: updatedLimits.limit,
        remaining: updatedLimits.remaining,
      },
    };
  }

  throw new Error('Method not allowed');
}

async function handleDemoJob(context: TenantContext): Promise<unknown> {
  const tenantDb = new TenantDatabase(db, context);

  // Check usage limits
  const limits = await checkUsageLimits(db, context);
  if (!limits.allowed) {
    throw new UsageLimitExceededError(
      `Monthly task limit exceeded. Used: ${limits.used}/${limits.limit}`,
      Math.ceil((limits.resetAt.getTime() - Date.now()) / 1000)
    );
  }

  const job = await tenantDb.createJob({
    name: 'Demo: Callback to Async/Await',
    description: 'Convert callback-based code to async/await syntax',
    input_payload: { type: 'demo', transformation: 'callback_to_async' },
  });

  // Record job creation
  await recordUsageEvent(db, context, 'job_created', 1, {}, job.id);

  const decomposition = getDemoRefactoringTasks();
  const taskIds = await createTasksFromDecomposition(tenantDb, job.id, decomposition);

  // Record task creation
  await recordUsageEvent(db, context, 'task_created', taskIds.length, {}, job.id);

  await tenantDb.updateJobStatus(job.id, 'running');

  return {
    jobId: job.id,
    taskCount: taskIds.length,
    tasks: decomposition.tasks.map((t, i) => ({
      id: taskIds[i],
      name: t.name,
      type: t.task_type,
    })),
  };
}

async function handleGetJob(jobId: string, context: TenantContext): Promise<unknown> {
  const tenantDb = new TenantDatabase(db, context);
  const job = await tenantDb.getJob(jobId);
  if (!job) throw new NotFoundError('Job not found');

  const tasks = await tenantDb.getTasksByJob(jobId);
  const stats = await tenantDb.getJobStats(jobId);

  return { job, tasks, stats };
}

async function handleKillWorker(body: Record<string, unknown>): Promise<unknown> {
  const { taskId } = body as { taskId: string };
  if (!taskId) throw new Error('taskId required');

  await db.query(
    `UPDATE task_nodes
     SET heartbeat_at = now() - INTERVAL '5 minutes'
     WHERE id = $1 AND status = 'running'`,
    [taskId]
  );

  return { success: true, message: `Simulated crash for task ${taskId}` };
}

async function handleTriggerWorker(): Promise<unknown> {
  console.log(`[${workerId}] Processing task...`);

  const { task, claimed } = await claimTask(db, { workerId });
  if (!claimed || !task) {
    return { success: true, message: 'No tasks available' };
  }

  console.log(`[${workerId}] Claimed: ${task.name}`);
  await startTask(db, task.id);

  // Get tenant context from task
  const tenantResult = await db.query<{ plan: string }>(
    'SELECT plan FROM tenants WHERE id = $1',
    [task.tenant_id]
  );
  const tenantContext: TenantContext = {
    tenantId: task.tenant_id,
    plan: (tenantResult.rows[0]?.plan as TenantContext['plan']) ?? 'free',
    scopes: ['tasks:execute'],
  };

  try {
    const memories = await queryMemories(db, task, 5, task.tenant_id);
    const result = await executeTask({ task, memories, db, tenantContext });
    await storeMemory(db, task, result, tenantContext);

    if (result.success) {
      await completeTask(db, task.id, result.output || {});
      console.log(`[${workerId}] Completed: ${task.name}`);

      // Check job completion
      const stats = await db.getJobStats(task.job_id);
      if (stats.pending === 0 && stats.running === 0) {
        const status = stats.failed > 0 ? 'failed' : 'completed';
        await db.updateJobStatus(task.job_id, status);
      }

      return { success: true, taskId: task.id };
    } else {
      await failTask(db, task.id, result.error || 'Unknown error');
      return { success: false, taskId: task.id, error: result.error };
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await failTask(db, task.id, msg);
    return { success: false, taskId: task.id, error: msg };
  }
}

async function handleTriggerReclaim(): Promise<unknown> {
  const { reclaimed, failed } = await reclaimStaleTasks(db, 60);
  return { reclaimed, failed };
}

async function handleGetUsage(context: TenantContext): Promise<unknown> {
  const limits = await checkUsageLimits(db, context);
  const tenant = await getTenant(db, context.tenantId);
  const usage = await getCurrentUsage(db, context.tenantId);

  return {
    tenant: {
      id: context.tenantId,
      name: tenant?.name ?? 'Unknown',
      plan: tenant?.plan ?? context.plan,
    },
    usage: {
      used: limits.used,
      limit: limits.limit,
      remaining: limits.remaining,
      resetAt: limits.resetAt.toISOString(),
    },
    details: usage,
  };
}

// Tenant management endpoints
async function handleCreateTenant(body: Record<string, unknown>): Promise<unknown> {
  const { name, slug, plan } = body as { name: string; slug: string; plan?: string };

  if (!name || !slug) {
    throw new Error('name and slug required');
  }

  const tenant = await createTenant(db, name, slug, (plan as any) ?? 'free');

  return {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    plan: tenant.plan,
    limits: {
      task_limit_monthly: tenant.task_limit_monthly,
      concurrent_task_limit: tenant.concurrent_task_limit,
    },
  };
}

async function handleCreateApiKey(
  tenantId: string,
  body: Record<string, unknown>
): Promise<unknown> {
  const { name, scopes } = body as { name: string; scopes?: string[] };

  if (!name) {
    throw new Error('name required');
  }

  const tenant = await getTenant(db, tenantId);
  if (!tenant) {
    throw new NotFoundError('Tenant not found');
  }

  const { id, key, prefix } = await createApiKey(db, tenantId, name, scopes);

  return {
    id,
    key, // Only returned once!
    prefix,
    name,
    scopes: scopes ?? ['jobs:read', 'jobs:write', 'tasks:read'],
    warning: 'Save this key now. It will not be shown again.',
  };
}

async function handleListApiKeys(tenantId: string): Promise<unknown> {
  const tenant = await getTenant(db, tenantId);
  if (!tenant) {
    throw new NotFoundError('Tenant not found');
  }

  const keys = await listApiKeys(db, tenantId);

  return {
    keys: keys.map(k => ({
      id: k.id,
      name: k.name,
      prefix: k.key_prefix,
      scopes: k.scopes,
      last_used_at: k.last_used_at,
      created_at: k.created_at,
    })),
  };
}

// ============ GitHub OAuth Handlers ============

async function handleGitHubLogin(): Promise<{ redirect: string }> {
  if (!GITHUB_CLIENT_ID) {
    throw new Error('GitHub OAuth not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.');
  }

  const state = randomUUID();
  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: GITHUB_REDIRECT_URI,
    scope: 'user:email',
    state,
  });

  return {
    redirect: `https://github.com/login/oauth/authorize?${params}`,
  };
}

async function handleGitHubCallback(code: string): Promise<{ redirect: string }> {
  if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
    throw new Error('GitHub OAuth not configured');
  }

  // Exchange code for access token
  const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: GITHUB_CLIENT_ID,
      client_secret: GITHUB_CLIENT_SECRET,
      code,
    }),
  });

  const tokenData = await tokenResponse.json() as { access_token?: string; error?: string };
  if (tokenData.error || !tokenData.access_token) {
    throw new Error(`GitHub OAuth error: ${tokenData.error || 'No access token'}`);
  }

  const accessToken = tokenData.access_token;

  // Get user profile
  const userResponse = await fetch('https://api.github.com/user', {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
    },
  });

  const githubUser = await userResponse.json() as {
    id: number;
    login: string;
    name?: string;
    email?: string;
    avatar_url?: string;
  };

  // Get user email if not public
  let email = githubUser.email;
  if (!email) {
    const emailResponse = await fetch('https://api.github.com/user/emails', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
      },
    });
    const emails = await emailResponse.json() as Array<{ email: string; primary: boolean }>;
    const primaryEmail = emails.find(e => e.primary);
    email = primaryEmail?.email || emails[0]?.email;
  }

  if (!email) {
    throw new Error('Could not get email from GitHub');
  }

  // Find or create user
  const user = await findOrCreateGitHubUser(db, {
    id: String(githubUser.id),
    email,
    name: githubUser.name,
    avatar_url: githubUser.avatar_url,
    access_token: accessToken,
  });

  // Check if user has any memberships, if not create personal tenant
  const memberships = await getUserMemberships(db, user.id);
  if (memberships.length === 0) {
    await createPersonalTenant(db, user);
  }

  // Create session
  const sessionToken = createSession(user);

  // Redirect to frontend with session token
  return {
    redirect: `${FRONTEND_URL}/auth/callback?token=${sessionToken}`,
  };
}

async function handleGetMe(req: http.IncomingMessage): Promise<unknown> {
  // Get session from header or cookie
  const authHeader = req.headers['authorization'];
  let token: string | undefined;

  if (authHeader?.startsWith('Session ')) {
    token = authHeader.slice(8);
  } else {
    const cookies = parseCookies(req.headers['cookie'] || '');
    token = cookies['session'];
  }

  if (!token) {
    throw new AuthError('Not logged in');
  }

  const user = await getUserFromSession(db, token);
  if (!user) {
    throw new AuthError('Invalid session');
  }

  const memberships = await getUserMemberships(db, user.id);

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      avatar_url: user.avatar_url,
      github_id: user.github_id,
    },
    memberships: memberships.map(m => ({
      tenant_id: m.tenant_id,
      role: m.role,
      tenant: {
        id: m.tenant.id,
        name: m.tenant.name,
        slug: m.tenant.slug,
        plan: m.tenant.plan,
      },
    })),
  };
}

async function handleLogout(req: http.IncomingMessage): Promise<unknown> {
  const authHeader = req.headers['authorization'];
  let token: string | undefined;

  if (authHeader?.startsWith('Session ')) {
    token = authHeader.slice(8);
  } else {
    const cookies = parseCookies(req.headers['cookie'] || '');
    token = cookies['session'];
  }

  if (token) {
    deleteSession(token);
  }

  return { success: true };
}

// Main server
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const path = url.pathname;

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200, corsHeaders);
    res.end();
    return;
  }

  try {
    let result: unknown;
    let statusCode = 200;
    let headers = { ...corsHeaders };

    // ============ Auth Routes (no auth required) ============
    if (path === '/auth/github' && req.method === 'GET') {
      const { redirect } = await handleGitHubLogin();
      res.writeHead(302, { ...corsHeaders, Location: redirect });
      res.end();
      return;
    }

    if (path === '/auth/github/callback' && req.method === 'GET') {
      const code = url.searchParams.get('code');
      if (!code) {
        res.writeHead(400, corsHeaders);
        res.end(JSON.stringify({ error: 'Missing code parameter' }));
        return;
      }
      const { redirect } = await handleGitHubCallback(code);
      res.writeHead(302, { ...corsHeaders, Location: redirect });
      res.end();
      return;
    }

    if (path === '/auth/me' && req.method === 'GET') {
      result = await handleGetMe(req);
    } else if (path === '/auth/logout' && req.method === 'POST') {
      result = await handleLogout(req);
    }
    // ============ Tenant Management (no auth required for creating) ============
    else if (path === '/tenants' && req.method === 'POST') {
      const body = await parseBody(req);
      result = await handleCreateTenant(body);
      statusCode = 201;
    } else if (path.match(/^\/tenants\/[\w-]+\/api-keys$/) && req.method === 'POST') {
      const tenantId = path.split('/')[2];
      const body = await parseBody(req);
      result = await handleCreateApiKey(tenantId, body);
      statusCode = 201;
    } else if (path.match(/^\/tenants\/[\w-]+\/api-keys$/) && req.method === 'GET') {
      const tenantId = path.split('/')[2];
      result = await handleListApiKeys(tenantId);
    }
    // ============ Protected Routes ============
    else if (path === '/jobs' && (req.method === 'GET' || req.method === 'POST')) {
      const context = await getTenantContext(req);
      await recordUsageEvent(db, context, 'api_call');
      result = await handleJobs(req, context);
      if (req.method === 'POST') statusCode = 201;
    } else if (path === '/jobs/demo' && req.method === 'POST') {
      const context = await getTenantContext(req);
      await recordUsageEvent(db, context, 'api_call');
      result = await handleDemoJob(context);
      statusCode = 201;
    } else if (path.match(/^\/jobs\/[\w-]+$/) && req.method === 'GET') {
      const context = await getTenantContext(req);
      await recordUsageEvent(db, context, 'api_call');
      const jobId = path.split('/')[2];
      result = await handleGetJob(jobId, context);
    } else if (path === '/usage' && req.method === 'GET') {
      const context = await getTenantContext(req);
      result = await handleGetUsage(context);
    }
    // ============ Chaos/Debug Routes ============
    else if (path === '/chaos/kill-worker' && req.method === 'POST') {
      const body = await parseBody(req);
      result = await handleKillWorker(body);
    } else if (path === '/trigger-worker' && req.method === 'POST') {
      result = await handleTriggerWorker();
    } else if (path === '/trigger-reclaim' && req.method === 'POST') {
      result = await handleTriggerReclaim();
    } else {
      res.writeHead(404, corsHeaders);
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    res.writeHead(statusCode, headers);
    res.end(JSON.stringify(result));
  } catch (error) {
    if (error instanceof AuthError) {
      res.writeHead(401, corsHeaders);
      res.end(JSON.stringify({ error: error.message }));
      return;
    }

    if (error instanceof NotFoundError) {
      res.writeHead(404, corsHeaders);
      res.end(JSON.stringify({ error: error.message }));
      return;
    }

    if (error instanceof UsageLimitExceededError) {
      res.writeHead(429, {
        ...corsHeaders,
        'Retry-After': String(error.retryAfter),
      });
      res.end(JSON.stringify({ error: error.message, retryAfter: error.retryAfter }));
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    console.error('Error:', message);
    res.writeHead(500, corsHeaders);
    res.end(JSON.stringify({ error: message }));
  }
});

// Auto-process tasks every 5 seconds
setInterval(async () => {
  try {
    await handleTriggerWorker();
  } catch (error) {
    // Ignore errors in auto-processing
  }
}, 5000);

// Reclaim stale tasks every minute
setInterval(async () => {
  try {
    await handleTriggerReclaim();
  } catch (error) {
    // Ignore errors
  }
}, 60000);

server.listen(PORT, () => {
  console.log(`Local server running at http://localhost:${PORT}`);
  console.log(`Demo mode: ${isDemoMode()}`);
  console.log('');
  console.log('Auth Endpoints:');
  console.log('  GET  /auth/github              - Start GitHub OAuth flow');
  console.log('  GET  /auth/github/callback     - GitHub OAuth callback');
  console.log('  GET  /auth/me                  - Get current user info');
  console.log('  POST /auth/logout              - Logout');
  console.log('');
  console.log('Tenant Endpoints:');
  console.log('  POST /tenants                  - Create a tenant');
  console.log('  POST /tenants/:id/api-keys     - Create API key');
  console.log('  GET  /tenants/:id/api-keys     - List API keys');
  console.log('');
  console.log('Job Endpoints (auth required):');
  console.log('  GET  /jobs                     - List jobs');
  console.log('  POST /jobs                     - Create a job');
  console.log('  POST /jobs/demo                - Create demo job');
  console.log('  GET  /jobs/:id                 - Get job details');
  console.log('  GET  /usage                    - Get usage info');
  console.log('');
  console.log('Debug Endpoints:');
  console.log('  POST /chaos/kill-worker        - Simulate worker crash');
  console.log('  POST /trigger-worker           - Manually trigger worker');
  console.log('  POST /trigger-reclaim          - Manually reclaim stale tasks');
  console.log('');

  if (GITHUB_CLIENT_ID) {
    console.log(`GitHub OAuth enabled. Login at: http://localhost:${PORT}/auth/github`);
  } else {
    console.log('GitHub OAuth not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET to enable.');
  }

  if (isDemoMode()) {
    console.log('\nRunning in DEMO mode - unauthenticated requests use demo tenant');
  } else {
    console.log('\nRunning in PRODUCTION mode - all requests require API key or session');
  }
  console.log('\nAuto-processing tasks every 5 seconds...');
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  server.close();
  await db.close();
  process.exit(0);
});
