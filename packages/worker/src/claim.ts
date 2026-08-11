import { Database, TaskNode, ClaimResult } from '@crash-proof/shared';

/**
 * Task claim module using CockroachDB's FOR UPDATE SKIP LOCKED pattern
 * Ensures exactly-once task processing across distributed workers
 */

export interface ClaimConfig {
  workerId: string;
  maxRetries?: number;
  retryDelayMs?: number;
}

/**
 * Claim a task atomically using FOR UPDATE SKIP LOCKED
 * This ensures no two workers can claim the same task
 */
export async function claimTask(
  db: Database,
  config: ClaimConfig
): Promise<ClaimResult> {
  const { workerId, maxRetries = 3, retryDelayMs = 100 } = config;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await db.claimTask(workerId);
      return result;
    } catch (error) {
      // Retry on serialization errors (common in high-contention scenarios)
      if (
        error instanceof Error &&
        error.message.includes('could not serialize') &&
        attempt < maxRetries - 1
      ) {
        await sleep(retryDelayMs * (attempt + 1));
        continue;
      }
      throw error;
    }
  }

  return { task: null, claimed: false };
}

/**
 * Mark task as running after successful claim
 */
export async function startTask(db: Database, taskId: string): Promise<void> {
  await db.updateTaskStatus(taskId, 'running');
}

/**
 * Complete a task successfully
 */
export async function completeTask(
  db: Database,
  taskId: string,
  output: Record<string, unknown>
): Promise<void> {
  await db.updateTaskStatus(taskId, 'done', output);
}

/**
 * Fail a task with an error message
 */
export async function failTask(
  db: Database,
  taskId: string,
  errorMessage: string
): Promise<void> {
  await db.updateTaskStatus(taskId, 'failed', undefined, errorMessage);
}

/**
 * Mark task as needing human intervention
 */
export async function requestHumanHelp(
  db: Database,
  taskId: string,
  reason: string
): Promise<void> {
  await db.updateTaskStatus(taskId, 'needs_human', undefined, reason);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
