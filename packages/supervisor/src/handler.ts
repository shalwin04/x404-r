import type { Handler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  createDatabase,
  Database,
  Job,
  TenantContext,
  TenantDatabase,
  extractTenantContext,
  isDemoMode,
  DEFAULT_TENANT_CONTEXT,
  checkUsageLimits,
  recordUsageEvent,
  UsageLimitExceededError,
} from '@crash-proof/shared';
import {
  decompose,
  createTasksFromDecomposition,
  getDemoRefactoringTasks,
} from './decompose.js';

/**
 * Supervisor Lambda Handler
 *
 * This Lambda function:
 * 1. Receives task requests (via API Gateway or direct invocation)
 * 2. Authenticates requests using API keys
 * 3. Checks usage limits before allowing job creation
 * 4. Uses Gemini to decompose tasks into a DAG
 * 5. Inserts task nodes with proper dependencies
 * 6. Returns the job ID for tracking
 */

interface SupervisorEvent {
  action: 'create_job' | 'create_demo_job' | 'get_job' | 'list_jobs' | 'kill_worker' | 'get_usage';
  name?: string;
  description?: string;
  taskDescription?: string;
  context?: Record<string, unknown>;
  jobId?: string;
  taskId?: string;
  priority?: number;
}

interface SupervisorResult {
  statusCode: number;
  body: string;
  headers?: Record<string, string>;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

export const handler: Handler<
  SupervisorEvent | APIGatewayProxyEvent,
  SupervisorResult
> = async (event): Promise<SupervisorResult> => {
  const db = createDatabase();

  try {
    // Handle API Gateway events
    if (isApiGatewayEvent(event)) {
      return await handleApiGateway(db, event);
    }

    // Handle direct invocation
    return await handleDirect(db, event);
  } catch (error) {
    if (error instanceof UsageLimitExceededError) {
      return {
        statusCode: 429,
        body: JSON.stringify({
          error: error.message,
          retryAfter: error.retryAfter,
        }),
        headers: {
          ...corsHeaders,
          'Retry-After': String(error.retryAfter),
        },
      };
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Supervisor error:', errorMessage);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: errorMessage }),
      headers: corsHeaders,
    };
  } finally {
    await db.close();
  }
};

/**
 * Handle API Gateway events
 */
async function handleApiGateway(
  db: Database,
  event: APIGatewayProxyEvent
): Promise<SupervisorResult> {
  const path = event.path;
  const method = event.httpMethod;

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    return { statusCode: 200, body: '', headers: corsHeaders };
  }

  // Health check (no auth required)
  if (method === 'GET' && path === '/ready') {
    return {
      statusCode: 200,
      body: JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }),
      headers: corsHeaders,
    };
  }

  // Extract tenant context from Authorization header
  const tenantContext = await extractTenantContext(db, {
    headers: event.headers as Record<string, string>,
  });

  if (!tenantContext) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: 'Authentication required. Provide a valid API key.' }),
      headers: corsHeaders,
    };
  }

  // Record API call usage
  await recordUsageEvent(db, tenantContext, 'api_call');

  const tenantDb = new TenantDatabase(db, tenantContext);
  const body = event.body ? JSON.parse(event.body) : {};

  // Route handling
  if (method === 'POST' && path === '/jobs') {
    return await createJob(db, tenantDb, tenantContext, body);
  }

  if (method === 'POST' && path === '/jobs/demo') {
    return await createDemoJob(db, tenantDb, tenantContext);
  }

  if (method === 'GET' && path.startsWith('/jobs/')) {
    const jobId = path.split('/')[2];
    return await getJob(tenantDb, jobId);
  }

  if (method === 'GET' && path === '/jobs') {
    return await listJobs(tenantDb);
  }

  if (method === 'GET' && path === '/usage') {
    return await getUsage(db, tenantContext);
  }

  if (method === 'POST' && path === '/chaos/kill-worker') {
    return await killWorker(db, body.taskId);
  }

  return {
    statusCode: 404,
    body: JSON.stringify({ error: 'Not found' }),
    headers: corsHeaders,
  };
}

/**
 * Handle direct Lambda invocation
 */
async function handleDirect(
  db: Database,
  event: SupervisorEvent
): Promise<SupervisorResult> {
  // For direct invocation, use demo tenant context
  const tenantContext = DEFAULT_TENANT_CONTEXT;
  const tenantDb = new TenantDatabase(db, tenantContext);

  switch (event.action) {
    case 'create_job':
      return await createJob(db, tenantDb, tenantContext, event);

    case 'create_demo_job':
      return await createDemoJob(db, tenantDb, tenantContext);

    case 'get_job':
      if (!event.jobId) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: 'jobId required' }),
          headers: corsHeaders,
        };
      }
      return await getJob(tenantDb, event.jobId);

    case 'list_jobs':
      return await listJobs(tenantDb);

    case 'get_usage':
      return await getUsage(db, tenantContext);

    case 'kill_worker':
      if (!event.taskId) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: 'taskId required' }),
          headers: corsHeaders,
        };
      }
      return await killWorker(db, event.taskId);

    default:
      return {
        statusCode: 400,
        body: JSON.stringify({ error: `Unknown action: ${event.action}` }),
        headers: corsHeaders,
      };
  }
}

/**
 * Create a new job with AI-decomposed tasks
 */
async function createJob(
  db: Database,
  tenantDb: TenantDatabase,
  context: TenantContext,
  input: {
    name?: string;
    description?: string;
    taskDescription?: string;
    context?: Record<string, unknown>;
    priority?: number;
  }
): Promise<SupervisorResult> {
  const { name, description, taskDescription, context: taskContext, priority } = input;

  if (!name || !taskDescription) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'name and taskDescription required' }),
      headers: corsHeaders,
    };
  }

  // Check usage limits before creating job
  const limits = await checkUsageLimits(db, context);
  if (!limits.allowed) {
    throw new UsageLimitExceededError(
      `Monthly task limit exceeded. Used: ${limits.used}/${limits.limit}`,
      Math.ceil((limits.resetAt.getTime() - Date.now()) / 1000)
    );
  }

  // Create job using tenant-scoped database
  const job = await tenantDb.createJob({
    name,
    description,
    input_payload: { taskDescription, context: taskContext },
    priority: priority ?? 0,
  });

  // Record job creation
  await recordUsageEvent(db, context, 'job_created', 1, {}, job.id);

  // Decompose task using Gemini
  const decomposition = await decompose({
    jobId: job.id,
    taskDescription,
    context: taskContext,
  });

  // Create tasks in database (using tenant-scoped database)
  const taskIds = await createTasksFromDecomposition(tenantDb, job.id, decomposition);

  // Record task creation
  await recordUsageEvent(db, context, 'task_created', taskIds.length, {}, job.id);

  // Update job status to running
  await tenantDb.updateJobStatus(job.id, 'running');

  // Get updated usage info
  const updatedLimits = await checkUsageLimits(db, context);

  return {
    statusCode: 201,
    body: JSON.stringify({
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
    }),
    headers: corsHeaders,
  };
}

/**
 * Create the demo refactoring job
 */
async function createDemoJob(
  db: Database,
  tenantDb: TenantDatabase,
  context: TenantContext
): Promise<SupervisorResult> {
  // Check usage limits
  const limits = await checkUsageLimits(db, context);
  if (!limits.allowed) {
    throw new UsageLimitExceededError(
      `Monthly task limit exceeded. Used: ${limits.used}/${limits.limit}`,
      Math.ceil((limits.resetAt.getTime() - Date.now()) / 1000)
    );
  }

  // Create job using tenant-scoped database
  const job = await tenantDb.createJob({
    name: 'Demo: Callback to Async/Await',
    description: 'Convert callback-based code to async/await syntax',
    input_payload: { type: 'demo', transformation: 'callback_to_async' },
  });

  // Record job creation
  await recordUsageEvent(db, context, 'job_created', 1, {}, job.id);

  // Use pre-built decomposition
  const decomposition = getDemoRefactoringTasks();

  // Create tasks
  const taskIds = await createTasksFromDecomposition(tenantDb, job.id, decomposition);

  // Record task creation
  await recordUsageEvent(db, context, 'task_created', taskIds.length, {}, job.id);

  // Update job status
  await tenantDb.updateJobStatus(job.id, 'running');

  return {
    statusCode: 201,
    body: JSON.stringify({
      jobId: job.id,
      taskCount: taskIds.length,
      tasks: decomposition.tasks.map((t, i) => ({
        id: taskIds[i],
        name: t.name,
        type: t.task_type,
      })),
    }),
    headers: corsHeaders,
  };
}

/**
 * Get job details with tasks
 */
async function getJob(tenantDb: TenantDatabase, jobId: string): Promise<SupervisorResult> {
  const job = await tenantDb.getJob(jobId);

  if (!job) {
    return {
      statusCode: 404,
      body: JSON.stringify({ error: 'Job not found' }),
      headers: corsHeaders,
    };
  }

  const tasks = await tenantDb.getTasksByJob(jobId);
  const stats = await tenantDb.getJobStats(jobId);

  return {
    statusCode: 200,
    body: JSON.stringify({ job, tasks, stats }),
    headers: corsHeaders,
  };
}

/**
 * List all jobs for the tenant
 */
async function listJobs(tenantDb: TenantDatabase): Promise<SupervisorResult> {
  const jobs = await tenantDb.listJobs();

  return {
    statusCode: 200,
    body: JSON.stringify({ jobs }),
    headers: corsHeaders,
  };
}

/**
 * Get current usage for the tenant
 */
async function getUsage(
  db: Database,
  context: TenantContext
): Promise<SupervisorResult> {
  const limits = await checkUsageLimits(db, context);

  // Get tenant info
  const tenantResult = await db.query<{ name: string; plan: string }>(
    'SELECT name, plan FROM tenants WHERE id = $1',
    [context.tenantId]
  );

  const tenant = tenantResult.rows[0];

  return {
    statusCode: 200,
    body: JSON.stringify({
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
    }),
    headers: corsHeaders,
  };
}

/**
 * Simulate worker crash by clearing heartbeat
 * This triggers the stale task reclaim process
 */
async function killWorker(db: Database, taskId: string): Promise<SupervisorResult> {
  // Set heartbeat to a very old time to simulate crash
  await db.query(
    `UPDATE task_nodes
     SET heartbeat_at = now() - INTERVAL '5 minutes'
     WHERE id = $1 AND status = 'running'`,
    [taskId]
  );

  return {
    statusCode: 200,
    body: JSON.stringify({
      success: true,
      message: `Simulated crash for task ${taskId}. Worker will be reclaimed.`,
    }),
    headers: corsHeaders,
  };
}

/**
 * Type guard for API Gateway events
 */
function isApiGatewayEvent(event: unknown): event is APIGatewayProxyEvent {
  return (
    typeof event === 'object' &&
    event !== null &&
    'httpMethod' in event &&
    'path' in event
  );
}
