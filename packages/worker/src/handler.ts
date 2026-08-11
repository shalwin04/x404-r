import type { Handler, ScheduledEvent, Context } from 'aws-lambda';
import {
  createDatabase,
  Database,
  TaskNode,
  TenantContext,
  DEFAULT_TENANT_CONTEXT,
  recordUsageEvent,
} from '@crash-proof/shared';
import { claimTask, startTask, completeTask, failTask, requestHumanHelp } from './claim.js';
import { startHeartbeat, reclaimStaleTasks } from './heartbeat.js';
import { executeTask, storeMemory, queryMemories } from './executor.js';
import { randomUUID } from 'crypto';

/**
 * Worker Lambda Handler
 *
 * This Lambda function:
 * 1. Claims an available task atomically
 * 2. Starts a heartbeat to indicate liveness
 * 3. Queries vector memory for past failures
 * 4. Executes the task with Gemini
 * 5. Commits the result atomically
 */

interface WorkerEvent {
  action?: 'process' | 'reclaim' | 'process_specific';
  taskId?: string;
}

interface WorkerResult {
  success: boolean;
  taskId?: string;
  action: string;
  error?: string;
  details?: Record<string, unknown>;
}

// Generate a unique worker ID for this Lambda instance
const workerId = `worker-${randomUUID().slice(0, 8)}`;

export const handler: Handler<WorkerEvent | ScheduledEvent, WorkerResult> = async (
  event,
  context: Context
): Promise<WorkerResult> => {
  const db = createDatabase();

  try {
    // Determine action type
    const action = isScheduledEvent(event) ? 'reclaim' : (event.action || 'process');

    switch (action) {
      case 'reclaim':
        return await handleReclaim(db);

      case 'process_specific':
        if (!('taskId' in event) || !event.taskId) {
          return { success: false, action, error: 'taskId required for process_specific' };
        }
        return await handleProcessSpecific(db, event.taskId, context);

      case 'process':
      default:
        return await handleProcess(db, context);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Worker error:', errorMessage);
    return { success: false, action: 'unknown', error: errorMessage };
  } finally {
    await db.close();
  }
};

/**
 * Extract tenant context from a task
 */
async function getTenantContextFromTask(db: Database, task: TaskNode): Promise<TenantContext> {
  // Query the tenant to get plan info
  const result = await db.query<{ plan: string }>(
    'SELECT plan FROM tenants WHERE id = $1',
    [task.tenant_id]
  );

  if (result.rows.length === 0) {
    return DEFAULT_TENANT_CONTEXT;
  }

  return {
    tenantId: task.tenant_id,
    plan: result.rows[0].plan as TenantContext['plan'],
    scopes: ['tasks:execute'], // Worker has limited scopes
  };
}

/**
 * Process: Claim and execute the next available task
 */
async function handleProcess(db: Database, context: Context): Promise<WorkerResult> {
  console.log(`[${workerId}] Looking for tasks to claim...`);

  // Claim a task atomically
  const { task, claimed } = await claimTask(db, { workerId });

  if (!claimed || !task) {
    console.log(`[${workerId}] No tasks available`);
    return { success: true, action: 'process', details: { message: 'No tasks available' } };
  }

  console.log(`[${workerId}] Claimed task: ${task.id} (${task.name})`);

  // Extract tenant context from the claimed task
  const tenantContext = await getTenantContextFromTask(db, task);

  return await processTask(db, task, context, tenantContext);
}

/**
 * Process a specific task by ID
 */
async function handleProcessSpecific(
  db: Database,
  taskId: string,
  context: Context
): Promise<WorkerResult> {
  const task = await db.getTask(taskId);

  if (!task) {
    return { success: false, action: 'process_specific', error: `Task ${taskId} not found` };
  }

  if (task.status !== 'pending') {
    return {
      success: false,
      action: 'process_specific',
      error: `Task ${taskId} is not pending (status: ${task.status})`,
    };
  }

  // Extract tenant context from the task
  const tenantContext = await getTenantContextFromTask(db, task);

  return await processTask(db, task, context, tenantContext);
}

/**
 * Core task processing logic
 */
async function processTask(
  db: Database,
  task: TaskNode,
  context: Context,
  tenantContext: TenantContext
): Promise<WorkerResult> {
  // Start heartbeat
  const stopHeartbeat = startHeartbeat(db, task.id, 10000);

  try {
    // Mark as running
    await startTask(db, task.id);
    console.log(`[${workerId}] Starting task: ${task.name}`);

    // Query relevant memories (scoped to tenant)
    const memories = await queryMemories(db, task, 5, tenantContext.tenantId);
    if (memories.length > 0) {
      console.log(`[${workerId}] Found ${memories.length} relevant memories`);
    }

    // Execute the task with tenant context
    const result = await executeTask({ task, memories, db, tenantContext });

    // Store memory for future reference (scoped to tenant)
    await storeMemory(db, task, result, tenantContext);

    if (result.success) {
      // Commit success
      await completeTask(db, task.id, result.output || {});
      console.log(`[${workerId}] Task completed: ${task.id}`);

      // Check if job is complete
      await checkJobCompletion(db, task.job_id);

      return {
        success: true,
        taskId: task.id,
        action: 'process',
        details: { output: result.output },
      };
    } else if (result.needsHuman) {
      // Escalate to human
      await requestHumanHelp(db, task.id, result.error || 'Unknown error');
      console.log(`[${workerId}] Task needs human help: ${task.id}`);

      return {
        success: false,
        taskId: task.id,
        action: 'process',
        error: result.error,
        details: { needsHuman: true },
      };
    } else {
      // Task failed - will be retried if attempts remain
      await failTask(db, task.id, result.error || 'Unknown error');
      console.log(`[${workerId}] Task failed: ${task.id} - ${result.error}`);

      return {
        success: false,
        taskId: task.id,
        action: 'process',
        error: result.error,
      };
    }
  } finally {
    // Always stop heartbeat
    stopHeartbeat();
  }
}

/**
 * Reclaim: Clean up stale tasks from dead workers
 */
async function handleReclaim(db: Database): Promise<WorkerResult> {
  console.log(`[${workerId}] Running stale task reclaim...`);

  const { reclaimed, failed } = await reclaimStaleTasks(db, 60);

  return {
    success: true,
    action: 'reclaim',
    details: { reclaimed, failed },
  };
}

/**
 * Check if a job is complete and update its status
 */
async function checkJobCompletion(db: Database, jobId: string): Promise<void> {
  const stats = await db.getJobStats(jobId);

  if (stats.pending === 0 && stats.running === 0) {
    // Job is complete
    const status = stats.failed > 0 ? 'failed' : 'completed';
    await db.updateJobStatus(jobId, status);
    console.log(`[${workerId}] Job ${jobId} marked as ${status}`);
  } else if (stats.running > 0 || stats.pending > 0) {
    // Job is still running
    await db.updateJobStatus(jobId, 'running');
  }
}

/**
 * Type guard for scheduled events
 */
function isScheduledEvent(event: unknown): event is ScheduledEvent {
  return (
    typeof event === 'object' &&
    event !== null &&
    'source' in event &&
    (event as ScheduledEvent).source === 'aws.events'
  );
}

// Export for local testing
export { workerId };
