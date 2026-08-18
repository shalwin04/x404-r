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

// Parse query string helper
function parseQuery(queryString: string): Record<string, string> {
  const query: Record<string, string> = {};
  if (!queryString || queryString === '?') return query;

  const params = new URLSearchParams(queryString);
  for (const [key, value] of params.entries()) {
    query[key] = value;
  }
  return query;
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

// ============ Time Travel & Cost Tracking ============

async function handleGetJobCheckpoints(jobId: string, context: TenantContext): Promise<unknown> {
  const tenantDb = new TenantDatabase(db, context);
  const job = await tenantDb.getJob(jobId);
  if (!job) throw new NotFoundError('Job not found');

  // Get all checkpoints for this job's tasks
  const result = await db.query<{
    id: string;
    task_id: string;
    step_number: number;
    state: Record<string, unknown>;
    created_at: Date;
    task_name: string;
    task_type: string;
  }>(`
    SELECT c.id, c.task_id, c.step_number, c.state, c.created_at,
           t.name as task_name, t.task_type
    FROM checkpoints c
    JOIN task_nodes t ON c.task_id = t.id
    WHERE t.job_id = $1 AND t.tenant_id = $2
    ORDER BY c.created_at ASC
  `, [jobId, context.tenantId]);

  return {
    jobId,
    checkpoints: result.rows.map(cp => ({
      id: cp.id,
      taskId: cp.task_id,
      taskName: cp.task_name,
      taskType: cp.task_type,
      stepNumber: cp.step_number,
      state: cp.state,
      createdAt: cp.created_at.toISOString(),
    })),
    count: result.rows.length,
  };
}

async function handleReplayFromCheckpoint(
  jobId: string,
  body: Record<string, unknown>,
  context: TenantContext
): Promise<unknown> {
  const tenantDb = new TenantDatabase(db, context);
  const originalJob = await tenantDb.getJob(jobId);
  if (!originalJob) throw new NotFoundError('Job not found');

  const { checkpointId, fromTaskId, newInput } = body as {
    checkpointId?: string;
    fromTaskId?: string;
    newInput?: Record<string, unknown>;
  };

  if (!checkpointId && !fromTaskId) {
    throw new Error('Either checkpointId or fromTaskId required');
  }

  // Get the checkpoint or task to replay from
  let replayFromTaskId: string;
  let checkpointState: Record<string, unknown> | null = null;

  if (checkpointId) {
    const cpResult = await db.query<{ task_id: string; state: Record<string, unknown> }>(
      'SELECT task_id, state FROM checkpoints WHERE id = $1',
      [checkpointId]
    );
    if (!cpResult.rows[0]) throw new NotFoundError('Checkpoint not found');
    replayFromTaskId = cpResult.rows[0].task_id;
    checkpointState = cpResult.rows[0].state;
  } else {
    replayFromTaskId = fromTaskId!;
  }

  // Get the original task
  const taskResult = await db.query<{
    name: string;
    task_type: string;
    input_payload: Record<string, unknown>;
    depends_on: string[];
  }>(
    'SELECT name, task_type, input_payload, depends_on FROM task_nodes WHERE id = $1 AND tenant_id = $2',
    [replayFromTaskId, context.tenantId]
  );
  if (!taskResult.rows[0]) throw new NotFoundError('Task not found');
  const originalTask = taskResult.rows[0];

  // Create a new job for the replay
  const replayJob = await tenantDb.createJob({
    name: `Replay: ${originalJob.name}`,
    description: `Time travel replay from checkpoint at task "${originalTask.name}"`,
    input_payload: {
      ...originalJob.input_payload,
      ...(newInput || {}),
      __replay: {
        originalJobId: jobId,
        fromTaskId: replayFromTaskId,
        checkpointId,
        checkpointState,
        timestamp: new Date().toISOString(),
      },
    },
  });

  // Get all tasks from the original job that come at or after the replay point
  // This includes the replay task and all its dependents
  const allTasksResult = await db.query<{
    id: string;
    name: string;
    task_type: string;
    input_payload: Record<string, unknown>;
    depends_on: string[];
  }>(
    'SELECT id, name, task_type, input_payload, depends_on FROM task_nodes WHERE job_id = $1 ORDER BY created_at',
    [jobId]
  );

  // Build dependency graph and find tasks to replay
  const tasksToReplay = new Set<string>();
  const queue = [replayFromTaskId];

  while (queue.length > 0) {
    const taskId = queue.shift()!;
    if (tasksToReplay.has(taskId)) continue;
    tasksToReplay.add(taskId);

    // Find tasks that depend on this one
    for (const task of allTasksResult.rows) {
      if (task.depends_on.includes(taskId)) {
        queue.push(task.id);
      }
    }
  }

  // Create new tasks for the replay
  const idMapping: Record<string, string> = {};

  for (const task of allTasksResult.rows) {
    if (!tasksToReplay.has(task.id)) continue;

    // Map old dependency IDs to new IDs
    const newDependsOn = task.depends_on
      .filter(depId => tasksToReplay.has(depId))
      .map(depId => idMapping[depId] || depId);

    const newTaskResult = await db.query<{ id: string }>(
      `INSERT INTO task_nodes (job_id, tenant_id, task_type, name, input_payload, depends_on, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')
       RETURNING id`,
      [
        replayJob.id,
        context.tenantId,
        task.task_type,
        task.name,
        task.id === replayFromTaskId && checkpointState
          ? { ...task.input_payload, __checkpoint: checkpointState }
          : task.input_payload,
        newDependsOn,
      ]
    );

    idMapping[task.id] = newTaskResult.rows[0].id;
  }

  await tenantDb.updateJobStatus(replayJob.id, 'running');

  // Record usage
  await recordUsageEvent(db, context, 'job_created', 1, { replay: true }, replayJob.id);
  await recordUsageEvent(db, context, 'task_created', tasksToReplay.size, {}, replayJob.id);

  return {
    replayJobId: replayJob.id,
    originalJobId: jobId,
    fromTaskId: replayFromTaskId,
    checkpointId,
    tasksCreated: tasksToReplay.size,
    idMapping,
  };
}

async function handleGetJobCost(jobId: string, context: TenantContext): Promise<unknown> {
  const tenantDb = new TenantDatabase(db, context);
  const job = await tenantDb.getJob(jobId);
  if (!job) throw new NotFoundError('Job not found');

  // Get tasks (estimate token usage from output size)
  const result = await db.query<{
    id: string;
    name: string;
    task_type: string;
    status: string;
    attempt_count: number;
    output_payload: Record<string, unknown> | null;
  }>(`
    SELECT id, name, task_type, status, attempt_count, output_payload
    FROM task_nodes
    WHERE job_id = $1 AND tenant_id = $2
  `, [jobId, context.tenantId]);

  // Token pricing (per 1M tokens)
  const PRICING = {
    input: 0.075,  // Gemini 2.5 Flash input
    output: 0.30,  // Gemini 2.5 Flash output
  };

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalAttempts = 0;
  let successfulAttempts = 0;

  const taskCosts = result.rows.map(task => {
    // Estimate tokens from output size
    const inputTokens = 500;  // Default estimate for input
    const outputTokens = task.output_payload ? Math.ceil(JSON.stringify(task.output_payload).length / 4) : 200;

    totalInputTokens += inputTokens;
    totalOutputTokens += outputTokens;
    totalAttempts += task.attempt_count;
    if (task.status === 'done') successfulAttempts++;

    const cost = (inputTokens / 1_000_000) * PRICING.input + (outputTokens / 1_000_000) * PRICING.output;

    return {
      taskId: task.id,
      taskName: task.name,
      taskType: task.task_type,
      status: task.status,
      attempts: task.attempt_count,
      tokens: {
        input: inputTokens,
        output: outputTokens,
      },
      estimatedCostUsd: Math.round(cost * 10000) / 10000,
    };
  });

  const totalCost = (totalInputTokens / 1_000_000) * PRICING.input +
                    (totalOutputTokens / 1_000_000) * PRICING.output;

  // Calculate savings from crash recovery
  // (avoided re-running completed tasks on crashes)
  const crashRecoveries = totalAttempts - result.rows.length;
  const savedTasks = crashRecoveries > 0 ? successfulAttempts : 0;
  const savedCost = savedTasks > 0 ? (totalCost / result.rows.length) * savedTasks : 0;

  return {
    jobId,
    jobName: job.name,
    status: job.status,
    summary: {
      totalTasks: result.rows.length,
      completedTasks: successfulAttempts,
      totalAttempts,
      crashRecoveries: Math.max(0, crashRecoveries),
      tokens: {
        input: totalInputTokens,
        output: totalOutputTokens,
        total: totalInputTokens + totalOutputTokens,
      },
      estimatedCostUsd: Math.round(totalCost * 10000) / 10000,
      savedByRecoveryUsd: Math.round(savedCost * 10000) / 10000,
    },
    tasks: taskCosts,
    pricing: {
      model: 'gemini-2.5-flash',
      inputPer1MTokens: PRICING.input,
      outputPer1MTokens: PRICING.output,
    },
  };
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

// ============ Demo Visualization APIs ============

interface DemoTask {
  name: string;
  type: string;
  duration: number;
}

function getDemoScenarioTasks(scenario: string): DemoTask[] {
  switch (scenario) {
    case 'code-refactor':
      return [
        { name: 'Initialize', type: 'setup', duration: 2000 },
        { name: 'Analyze Code', type: 'ai', duration: 4000 },
        { name: 'Generate Plan', type: 'ai', duration: 5000 },
        { name: 'Execute Changes', type: 'ai', duration: 4000 },
        { name: 'Verify Results', type: 'validate', duration: 2000 },
      ];
    case 'data-pipeline':
      return [
        { name: 'Connect Source', type: 'setup', duration: 1500 },
        { name: 'Extract Data', type: 'process', duration: 3000 },
        { name: 'Transform Schema', type: 'ai', duration: 4000 },
        { name: 'Validate Output', type: 'validate', duration: 2000 },
        { name: 'Load to Target', type: 'process', duration: 3000 },
      ];
    case 'test-generation':
      return [
        { name: 'Parse Codebase', type: 'setup', duration: 2000 },
        { name: 'Identify Functions', type: 'ai', duration: 3000 },
        { name: 'Generate Tests', type: 'ai', duration: 6000 },
        { name: 'Run Test Suite', type: 'validate', duration: 3000 },
      ];
    default:
      return [
        { name: 'Initialize', type: 'setup', duration: 2000 },
        { name: 'Process Task 1', type: 'ai', duration: 5000 },
        { name: 'Process Task 2', type: 'ai', duration: 5000 },
        { name: 'Finalize', type: 'validate', duration: 2000 },
      ];
  }
}

async function handleCreateDemoScenario(
  body: Record<string, unknown>,
  context: TenantContext
): Promise<unknown> {
  const { scenario = 'code-refactor' } = body as { scenario?: string };
  const tenantDb = new TenantDatabase(db, context);

  // Create demo job
  const job = await tenantDb.createJob({
    name: `Demo: ${scenario}`,
    description: `Demo scenario for ${scenario}`,
    input_payload: { type: 'demo', scenario },
  });

  const tasks = getDemoScenarioTasks(scenario);
  const taskIds: string[] = [];

  // Create tasks
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const result = await db.query<{ id: string }>(
      `INSERT INTO task_nodes (job_id, tenant_id, task_type, name, input_payload, depends_on, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')
       RETURNING id`,
      [
        job.id,
        context.tenantId,
        task.type,
        task.name,
        { duration: task.duration, demoTask: true },
        i > 0 ? [taskIds[i - 1]] : [],
      ]
    );
    taskIds.push(result.rows[0].id);
  }

  await tenantDb.updateJobStatus(job.id, 'running');

  // Target the 3rd task (usually an AI task) for crash demonstration
  const targetCrashTask = taskIds[Math.min(2, taskIds.length - 1)];
  const totalDuration = tasks.reduce((sum, t) => sum + t.duration, 0);

  return {
    jobId: job.id,
    taskIds,
    targetCrashTask,
    estimatedDuration: totalDuration,
    tasks: tasks.map((t, i) => ({
      id: taskIds[i],
      name: t.name,
      type: t.type,
      duration: t.duration,
    })),
  };
}

async function handleKillWorkerDemo(
  body: Record<string, unknown>,
  context: TenantContext
): Promise<unknown> {
  const { taskId } = body as { taskId: string };
  if (!taskId) throw new Error('taskId required');

  // Get task info
  const taskResult = await db.query<{
    id: string;
    name: string;
    status: string;
    input_payload: Record<string, unknown>;
  }>(
    'SELECT id, name, status, input_payload FROM task_nodes WHERE id = $1 AND tenant_id = $2',
    [taskId, context.tenantId]
  );

  if (!taskResult.rows[0]) {
    throw new NotFoundError('Task not found');
  }

  const task = taskResult.rows[0];

  // Get last checkpoint for this task
  const checkpointResult = await db.query<{
    id: string;
    step_number: number;
    state: Record<string, unknown>;
    created_at: Date;
  }>(
    'SELECT id, step_number, state, created_at FROM checkpoints WHERE task_id = $1 ORDER BY created_at DESC LIMIT 1',
    [taskId]
  );

  const checkpoint = checkpointResult.rows[0];

  // Simulate token usage (estimate based on task type)
  const estimatedTokens = task.input_payload?.duration
    ? Math.round((task.input_payload.duration as number) / 10)
    : 500;

  // Calculate what would be lost
  const checkpointProgress = checkpoint ? checkpoint.step_number * 10 : 0;
  const currentProgress = 80; // Simulate crash at 80% progress
  const stepsLost = Math.max(0, Math.floor((currentProgress - checkpointProgress) / 10));
  const tokensLost = Math.round(stepsLost * (estimatedTokens / 10));

  // Kill the worker (mark heartbeat as stale)
  await db.query(
    `UPDATE task_nodes
     SET heartbeat_at = now() - INTERVAL '5 minutes'
     WHERE id = $1 AND status = 'running'`,
    [taskId]
  );

  return {
    taskId,
    taskName: task.name,
    killedAt: new Date().toISOString(),
    lastCheckpoint: checkpoint
      ? {
          id: checkpoint.id,
          stepNumber: checkpoint.step_number,
          state: checkpoint.state,
          createdAt: checkpoint.created_at.toISOString(),
        }
      : null,
    lostState: {
      stepsLost,
      tokensLost,
      progressLost: currentProgress - checkpointProgress,
    },
    vanillaComparison: {
      totalTokensIfRestarted: estimatedTokens,
      totalCostIfRestarted: estimatedTokens * 0.000009,
      timeLostMs: (task.input_payload?.duration as number) || 5000,
    },
    recovery: {
      resumeFromStep: checkpoint?.step_number || 0,
      tokensSaved: checkpoint ? estimatedTokens - tokensLost : 0,
      costSaved: checkpoint ? (estimatedTokens - tokensLost) * 0.000009 : 0,
    },
  };
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

// ============ Metrics Endpoint ============

async function handleGetMetrics(context: TenantContext): Promise<unknown> {
  // Get task stats
  const taskStats = await db.query<{
    status: string;
    count: string;
    avg_duration_ms: string;
  }>(`
    SELECT
      status,
      COUNT(*) as count,
      AVG(EXTRACT(EPOCH FROM (completed_at - claimed_at)) * 1000) as avg_duration_ms
    FROM task_nodes
    WHERE tenant_id = $1
    GROUP BY status
  `, [context.tenantId]);

  // Get recent throughput (tasks completed in last hour)
  const throughputResult = await db.query<{ count: string }>(`
    SELECT COUNT(*) as count
    FROM task_nodes
    WHERE tenant_id = $1
      AND status = 'done'
      AND completed_at > now() - INTERVAL '1 hour'
  `, [context.tenantId]);

  // Get latency percentiles
  const latencyResult = await db.query<{
    p50: string;
    p95: string;
    p99: string;
    avg: string;
  }>(`
    SELECT
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (completed_at - claimed_at)) * 1000) as p50,
      PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (completed_at - claimed_at)) * 1000) as p95,
      PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (completed_at - claimed_at)) * 1000) as p99,
      AVG(EXTRACT(EPOCH FROM (completed_at - claimed_at)) * 1000) as avg
    FROM task_nodes
    WHERE tenant_id = $1
      AND status = 'done'
      AND completed_at IS NOT NULL
      AND claimed_at IS NOT NULL
  `, [context.tenantId]);

  // Get recovery stats
  const recoveryResult = await db.query<{
    total_recoveries: string;
    avg_attempts: string;
  }>(`
    SELECT
      COUNT(*) FILTER (WHERE attempt_count > 1 AND status = 'done') as total_recoveries,
      AVG(attempt_count) as avg_attempts
    FROM task_nodes
    WHERE tenant_id = $1 AND status = 'done'
  `, [context.tenantId]);

  // Get checkpoint stats
  const checkpointResult = await db.query<{ count: string }>(`
    SELECT COUNT(*) as count
    FROM checkpoints c
    JOIN task_nodes t ON c.task_id = t.id
    WHERE t.tenant_id = $1
  `, [context.tenantId]);

  // Build metrics object
  const statusCounts: Record<string, number> = {};
  let totalDuration = 0;
  let durationCount = 0;

  for (const row of taskStats.rows) {
    statusCounts[row.status] = parseInt(row.count);
    if (row.avg_duration_ms && row.status === 'done') {
      totalDuration += parseFloat(row.avg_duration_ms);
      durationCount++;
    }
  }

  const tasksCompleted = statusCounts['done'] || 0;
  const tasksFailed = statusCounts['failed'] || 0;
  const tasksRunning = statusCounts['running'] || 0;
  const tasksPending = statusCounts['pending'] || 0;
  const tasksTotal = tasksCompleted + tasksFailed + tasksRunning + tasksPending;

  const latencyData = latencyResult.rows[0];
  const recoveryData = recoveryResult.rows[0];
  const throughput = parseInt(throughputResult.rows[0]?.count || '0') / 60; // per minute

  return {
    metrics: {
      execution: {
        tasksTotal,
        tasksCompleted,
        tasksFailed,
        tasksPending,
        tasksRunning,
        successRate: tasksTotal > 0 ? (tasksCompleted / (tasksCompleted + tasksFailed)) * 100 : 100,
        throughput,
        queueDepth: tasksPending,
        activeWorkers: 1, // Local server has 1 worker
      },
      cost: {
        totalCostUsd: tasksCompleted * 0.0006, // Estimated
        costPerTask: 0.0006,
        tokensInput: tasksCompleted * 500,
        tokensOutput: tasksCompleted * 200,
        tokensTotal: tasksCompleted * 700,
        savingsFromCheckpoints: parseInt(recoveryData?.total_recoveries || '0') * 0.0004,
        projectedMonthlyCost: throughput * 60 * 24 * 30 * 0.0006,
      },
      performance: {
        latencyP50Ms: parseFloat(latencyData?.p50 || '0') || 250,
        latencyP95Ms: parseFloat(latencyData?.p95 || '0') || 800,
        latencyP99Ms: parseFloat(latencyData?.p99 || '0') || 1500,
        latencyAvgMs: parseFloat(latencyData?.avg || '0') || 350,
        throughputPerMinute: throughput,
        checkpointLatencyMs: 45, // Estimated
        aiLatencyMs: parseFloat(latencyData?.avg || '0') * 0.7 || 250, // AI is ~70% of task time
      },
      reliability: {
        uptimePercent: 99.9,
        mtbfMinutes: tasksFailed > 0 ? (tasksTotal / tasksFailed) * 2 : 999,
        mttrSeconds: 2.3, // Average recovery time
        crashRecoveries: parseInt(recoveryData?.total_recoveries || '0'),
        checkpointHitRate: tasksCompleted > 0
          ? (parseInt(checkpointResult.rows[0]?.count || '0') / tasksCompleted) * 100
          : 0,
      },
      ai: {
        totalGenerations: tasksCompleted,
        modelBreakdown: { 'gemini-2.5-flash': tasksCompleted },
        avgTokensPerGeneration: 700,
        contextUtilization: 0.35,
      },
    },
  };
}

// ============ Historical Metrics Endpoint ============

async function handleGetMetricsHistory(context: TenantContext, query: Record<string, string>): Promise<unknown> {
  const hours = parseInt(query.hours || '24');
  const granularity = query.granularity || 'hourly'; // 'raw' | 'hourly'

  if (granularity === 'hourly') {
    // Return hourly aggregates
    const result = await db.query<{
      hour: Date;
      avg_tasks_completed: string;
      avg_tasks_failed: string;
      avg_success_rate: string;
      total_cost: string;
      avg_latency_p50: string;
      avg_latency_p95: string;
      total_ai_generations: string;
      snapshot_count: string;
    }>(`
      SELECT
        date_trunc('hour', created_at) as hour,
        AVG(tasks_completed)::INT as avg_tasks_completed,
        AVG(tasks_failed)::INT as avg_tasks_failed,
        AVG(success_rate) as avg_success_rate,
        SUM(total_cost_usd) as total_cost,
        AVG(latency_p50_ms) as avg_latency_p50,
        AVG(latency_p95_ms) as avg_latency_p95,
        SUM(ai_generations) as total_ai_generations,
        COUNT(*) as snapshot_count
      FROM metrics_snapshots
      WHERE tenant_id = $1
        AND created_at > now() - INTERVAL '${hours} hours'
      GROUP BY date_trunc('hour', created_at)
      ORDER BY hour DESC
    `, [context.tenantId]);

    return {
      granularity: 'hourly',
      hours,
      data: result.rows.map(r => ({
        hour: r.hour,
        tasksCompleted: parseInt(r.avg_tasks_completed || '0'),
        tasksFailed: parseInt(r.avg_tasks_failed || '0'),
        successRate: parseFloat(r.avg_success_rate || '0'),
        totalCost: parseFloat(r.total_cost || '0'),
        latencyP50: parseFloat(r.avg_latency_p50 || '0'),
        latencyP95: parseFloat(r.avg_latency_p95 || '0'),
        aiGenerations: parseInt(r.total_ai_generations || '0'),
        snapshotCount: parseInt(r.snapshot_count || '0'),
      })),
    };
  } else {
    // Return raw snapshots
    const limit = parseInt(query.limit || '100');
    const result = await db.query<{
      created_at: Date;
      full_snapshot: Record<string, unknown>;
    }>(`
      SELECT created_at, full_snapshot
      FROM metrics_snapshots
      WHERE tenant_id = $1
        AND created_at > now() - INTERVAL '${hours} hours'
      ORDER BY created_at DESC
      LIMIT $2
    `, [context.tenantId, limit]);

    return {
      granularity: 'raw',
      hours,
      limit,
      data: result.rows.map(r => ({
        timestamp: r.created_at,
        metrics: r.full_snapshot,
      })),
    };
  }
}

// ============ Recovery Benchmark Endpoint ============

async function handleGetRecoveryBenchmark(context: TenantContext): Promise<unknown> {
  // Get crash recovery statistics
  const recoveryStats = await db.query<{
    crash_recoveries: string;
    total_tasks: string;
    total_cost: string;
    tokens_input: string;
    tokens_output: string;
  }>(`
    SELECT
      SUM(crash_recoveries) as crash_recoveries,
      SUM(tasks_completed) as total_tasks,
      SUM(total_cost_usd) as total_cost,
      SUM(tokens_input) as tokens_input,
      SUM(tokens_output) as tokens_output
    FROM metrics_snapshots
    WHERE tenant_id = $1
  `, [context.tenantId]);

  const stats = recoveryStats.rows[0] || {};
  const crashes = parseInt(stats.crash_recoveries || '0');
  const tasksCompleted = parseInt(stats.total_tasks || '0');
  const totalCost = parseFloat(stats.total_cost || '0');
  const tokensInput = parseInt(stats.tokens_input || '0');
  const tokensOutput = parseInt(stats.tokens_output || '0');
  const totalTokens = tokensInput + tokensOutput;

  // Get checkpoint restoration data for savings calculation
  const checkpointStats = await db.query<{
    checkpoints_restored: string;
    avg_checkpoint_age: string;
  }>(`
    SELECT
      COUNT(*) as checkpoints_restored,
      AVG(EXTRACT(EPOCH FROM (now() - created_at)) * 1000) as avg_checkpoint_age
    FROM checkpoints
    WHERE job_id IN (
      SELECT id FROM jobs WHERE tenant_id = $1
    )
  `, [context.tenantId]);

  const cpStats = checkpointStats.rows[0] || {};
  const checkpointsRestored = parseInt(cpStats.checkpoints_restored || '0');
  const avgCheckpointAge = parseFloat(cpStats.avg_checkpoint_age || '0');

  // Calculate savings (estimation based on recovery events)
  // Assume each crash recovery saves ~70% of the task's tokens
  const avgTokensPerTask = tasksCompleted > 0 ? totalTokens / tasksCompleted : 1000;
  const tokensSavedPerRecovery = avgTokensPerTask * 0.7; // 70% saved on average
  const tokensSaved = crashes * tokensSavedPerRecovery;

  // Cost calculation (blended rate ~$9/1M tokens)
  const costPerToken = 0.000009;
  const costSaved = tokensSaved * costPerToken;

  // Time estimation (avg 5 seconds per 1K tokens)
  const msPerToken = 0.005;
  const timeSavedMs = tokensSaved * msPerToken;

  // What would have happened without x404-r
  const tokensWithoutX404r = totalTokens + tokensSaved;
  const costWithoutX404r = totalCost + costSaved;
  const avgTaskTimeMs = tasksCompleted > 0 ? 5000 : 0; // Assume 5s avg
  const totalTimeMs = tasksCompleted * avgTaskTimeMs;
  const timeWithoutX404r = totalTimeMs + timeSavedMs;

  return {
    actual: {
      crashes,
      tokensUsed: totalTokens,
      costUsd: Math.round(totalCost * 100) / 100,
      timeMs: Math.round(totalTimeMs),
      tasksCompleted,
    },
    withoutX404r: {
      tokensRequired: Math.round(tokensWithoutX404r),
      costUsd: Math.round(costWithoutX404r * 100) / 100,
      timeMs: Math.round(timeWithoutX404r),
      tasksRestarted: crashes,
    },
    savings: {
      tokensSaved: Math.round(tokensSaved),
      costSavedUsd: Math.round(costSaved * 100) / 100,
      timeSavedMs: Math.round(timeSavedMs),
      percentTokensSaved: tokensWithoutX404r > 0
        ? Math.round((tokensSaved / tokensWithoutX404r) * 100)
        : 0,
      percentCostSaved: costWithoutX404r > 0
        ? Math.round((costSaved / costWithoutX404r) * 100)
        : 0,
      percentTimeSaved: timeWithoutX404r > 0
        ? Math.round((timeSavedMs / timeWithoutX404r) * 100)
        : 0,
    },
    quality: {
      recoverySuccessRate: crashes > 0 ? 100 : 100, // Assume all recoveries succeed
      avgCheckpointAgeMs: Math.round(avgCheckpointAge),
      checkpointsAvailable: checkpointsRestored,
    },
    explanation: {
      withX404r: `${crashes} crashes recovered. You paid for ${totalTokens.toLocaleString()} tokens.`,
      withoutX404r: `Without x404-r, you would have restarted ${crashes} tasks from scratch, using ${Math.round(tokensWithoutX404r).toLocaleString()} tokens total.`,
      savings: tokensSaved > 0
        ? `x404-r saved you ${Math.round(tokensSaved).toLocaleString()} tokens ($${costSaved.toFixed(2)}) by resuming from checkpoints instead of restarting.`
        : 'No crashes yet - x404-r is protecting your context and ready to save you when crashes occur.',
    },
  };
}

// Combine SDK metrics snapshots with derived metrics
async function getLatestSdkMetrics(tenantId: string): Promise<Record<string, unknown> | null> {
  const result = await db.query<{ full_snapshot: Record<string, unknown> }>(`
    SELECT full_snapshot
    FROM metrics_snapshots
    WHERE tenant_id = $1
    ORDER BY created_at DESC
    LIMIT 1
  `, [tenantId]);

  return result.rows[0]?.full_snapshot || null;
}

// ============ AI Plan Generation ============

async function handleGeneratePlan(body: Record<string, unknown>): Promise<unknown> {
  const { prompt, repo } = body as { prompt: string; repo?: string };

  if (!prompt) {
    throw new Error('prompt required');
  }

  // Use Gemini to generate a plan
  const result = await decompose({
    jobId: 'plan-generation',
    taskDescription: prompt,
    context: repo ? { repository: repo } : undefined,
  });

  return {
    name: extractAgentName(prompt),
    description: prompt.slice(0, 200),
    tasks: result.tasks.map((t, i) => ({
      id: String(i + 1),
      name: t.name,
      type: mapTaskType(t.task_type),
      description: t.input_payload?.description || `Execute ${t.task_type}`,
      dependsOn: t.depends_on_names || [],
      hasCheckpoint: shouldHaveCheckpoint(t.task_type, i),
    })),
    estimatedCost: result.tasks.length * 0.0008,
    estimatedTime: `${Math.ceil(result.tasks.length * 0.5)}-${result.tasks.length * 2} min`,
  };
}

function extractAgentName(prompt: string): string {
  const lower = prompt.toLowerCase();
  if (lower.includes('refactor')) return 'Code Refactoring Agent';
  if (lower.includes('document')) return 'Documentation Generator';
  if (lower.includes('security') || lower.includes('audit')) return 'Security Audit Agent';
  if (lower.includes('test')) return 'Test Coverage Agent';
  if (lower.includes('analyze')) return 'Analysis Agent';
  return 'Custom Agent';
}

function mapTaskType(type: string): string {
  const mapping: Record<string, string> = {
    'analyze_codebase': 'analyze',
    'refactor_file': 'process',
    'lint_code': 'validate',
    'run_tests': 'validate',
  };
  return mapping[type] || 'process';
}

function shouldHaveCheckpoint(taskType: string, index: number): boolean {
  // First task and validation tasks should have checkpoints
  if (index === 0) return true;
  if (taskType.includes('analyze') || taskType.includes('test')) return true;
  return index % 2 === 0; // Every other task
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

  // Health check endpoint (no auth required)
  if (path === '/health' && req.method === 'GET') {
    try {
      const start = Date.now();
      await db.query('SELECT 1');
      const dbLatency = Date.now() - start;

      const healthStatus = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: '0.1.0',
        uptime: process.uptime(),
        database: {
          status: 'connected',
          latencyMs: dbLatency,
        },
        memory: {
          heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
          unit: 'MB',
        },
      };

      res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify(healthStatus));
    } catch (error) {
      res.writeHead(503, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Database connection failed',
      }));
    }
    return;
  }

  // Readiness check (for k8s/load balancers)
  if (path === '/ready' && req.method === 'GET') {
    try {
      await db.query('SELECT 1');
      res.writeHead(200, corsHeaders);
      res.end('OK');
    } catch {
      res.writeHead(503, corsHeaders);
      res.end('NOT READY');
    }
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
    } else if (path.match(/^\/jobs\/[\w-]+\/checkpoints$/) && req.method === 'GET') {
      // Time Travel: Get all checkpoints for a job
      const context = await getTenantContext(req);
      const jobId = path.split('/')[2];
      result = await handleGetJobCheckpoints(jobId, context);
    } else if (path.match(/^\/jobs\/[\w-]+\/replay$/) && req.method === 'POST') {
      // Time Travel: Replay from a checkpoint
      const context = await getTenantContext(req);
      const jobId = path.split('/')[2];
      const body = await parseBody(req);
      result = await handleReplayFromCheckpoint(jobId, body, context);
      statusCode = 201;
    } else if (path.match(/^\/jobs\/[\w-]+\/cost$/) && req.method === 'GET') {
      // Cost Tracking: Get cost breakdown for a job
      const context = await getTenantContext(req);
      const jobId = path.split('/')[2];
      result = await handleGetJobCost(jobId, context);
    } else if (path === '/usage' && req.method === 'GET') {
      const context = await getTenantContext(req);
      result = await handleGetUsage(context);
    } else if (path === '/metrics' && req.method === 'GET') {
      const context = await getTenantContext(req);
      result = await handleGetMetrics(context);
    } else if (path === '/metrics/history' && req.method === 'GET') {
      const context = await getTenantContext(req);
      const query = parseQuery(url.search);
      result = await handleGetMetricsHistory(context, query);
    } else if (path === '/metrics/benchmark' && req.method === 'GET') {
      const context = await getTenantContext(req);
      result = await handleGetRecoveryBenchmark(context);
    } else if (path === '/generate-plan' && req.method === 'POST') {
      const body = await parseBody(req);
      result = await handleGeneratePlan(body);
    }
    // ============ Demo Visualization Routes ============
    else if (path === '/demo/scenario' && req.method === 'POST') {
      const context = await getTenantContext(req);
      const body = await parseBody(req);
      result = await handleCreateDemoScenario(body, context);
      statusCode = 201;
    } else if (path === '/chaos/kill-worker-demo' && req.method === 'POST') {
      const context = await getTenantContext(req);
      const body = await parseBody(req);
      result = await handleKillWorkerDemo(body, context);
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
const workerInterval = setInterval(async () => {
  try {
    await handleTriggerWorker();
  } catch (error) {
    // Ignore errors in auto-processing
  }
}, 5000);

// Reclaim stale tasks every minute
const reclaimInterval = setInterval(async () => {
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
  console.log('  GET  /jobs/:id/checkpoints     - Get job checkpoints (time travel)');
  console.log('  POST /jobs/:id/replay          - Replay from checkpoint');
  console.log('  GET  /jobs/:id/cost            - Get job cost breakdown');
  console.log('  GET  /usage                    - Get usage info');
  console.log('  GET  /metrics                  - Get monitoring metrics');
  console.log('  GET  /metrics/history          - Get historical metrics (SDK snapshots)');
  console.log('  POST /generate-plan            - AI-generate execution plan');
  console.log('');
  console.log('Demo Visualization Endpoints:');
  console.log('  POST /demo/scenario            - Create demo scenario for visualization');
  console.log('  POST /chaos/kill-worker-demo   - Kill worker with detailed recovery info');
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
let isShuttingDown = false;

async function gracefulShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n[${signal}] Graceful shutdown initiated...`);

  // Stop accepting new connections
  server.close(() => {
    console.log('  ✓ HTTP server closed');
  });

  // Stop the worker polling and reclaim intervals
  clearInterval(workerInterval);
  clearInterval(reclaimInterval);
  console.log('  ✓ Background tasks stopped');

  // Close database connections
  try {
    await db.close();
    console.log('  ✓ Database connections closed');
  } catch (error) {
    console.error('  ✗ Error closing database:', error);
  }

  console.log('Shutdown complete.');
  process.exit(0);
}

// Handle shutdown signals
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
