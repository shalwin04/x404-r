import { Database } from '@crash-proof/shared';

/**
 * Heartbeat module for worker liveness detection
 * Workers send periodic heartbeats to indicate they're still alive
 * Tasks from dead workers (missing heartbeats) get reclaimed
 */

export interface HeartbeatConfig {
  taskId: string;
  intervalMs?: number;
}

export class HeartbeatManager {
  private db: Database;
  private taskId: string;
  private intervalMs: number;
  private intervalHandle: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(db: Database, config: HeartbeatConfig) {
    this.db = db;
    this.taskId = config.taskId;
    this.intervalMs = config.intervalMs ?? 10000; // 10 seconds default
  }

  /**
   * Start sending heartbeats
   */
  start(): void {
    if (this.isRunning) return;

    this.isRunning = true;
    this.sendHeartbeat(); // Send immediately

    this.intervalHandle = setInterval(() => {
      this.sendHeartbeat();
    }, this.intervalMs);
  }

  /**
   * Stop sending heartbeats
   */
  stop(): void {
    this.isRunning = false;
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  /**
   * Send a single heartbeat
   */
  private async sendHeartbeat(): Promise<void> {
    if (!this.isRunning) return;

    try {
      await this.db.updateHeartbeat(this.taskId);
    } catch (error) {
      console.error(`Failed to send heartbeat for task ${this.taskId}:`, error);
      // Don't stop on heartbeat failure - the task might still complete
    }
  }
}

/**
 * Create and start a heartbeat manager
 * Returns a cleanup function to stop heartbeats
 */
export function startHeartbeat(
  db: Database,
  taskId: string,
  intervalMs = 10000
): () => void {
  const manager = new HeartbeatManager(db, { taskId, intervalMs });
  manager.start();
  return () => manager.stop();
}

/**
 * Reclaim tasks from dead workers
 * Should be called periodically by a supervisor
 */
export async function reclaimStaleTasks(
  db: Database,
  staleThresholdSeconds = 60
): Promise<{ reclaimed: number; failed: number }> {
  const reclaimed = await db.reclaimStaleTasks(staleThresholdSeconds);
  const failed = await db.failExhaustedTasks();

  if (reclaimed > 0 || failed > 0) {
    console.log(`Stale task cleanup: ${reclaimed} reclaimed, ${failed} failed`);
  }

  return { reclaimed, failed };
}
