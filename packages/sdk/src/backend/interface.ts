/**
 * Backend Interface
 * Abstracts database operations for embedded vs cloud mode
 */

import type { Workflow, Task, WorkflowStatus } from '../types.js';

/**
 * Backend interface that both embedded (direct DB) and cloud (HTTP API) implement
 */
export interface Backend {
  /** Initialize the backend */
  ready(): Promise<void>;

  /** Close connections */
  close(): Promise<void>;

  // ============ Workflow Operations ============

  /** Create a new workflow/job */
  createWorkflow(
    name: string,
    version: string,
    input: Record<string, unknown>,
    priority?: number
  ): Promise<Workflow>;

  /** Get workflow by ID */
  getWorkflow(id: string): Promise<Workflow | null>;

  /** Update workflow status */
  updateWorkflowStatus(
    id: string,
    status: WorkflowStatus,
    output?: Record<string, unknown>,
    error?: string
  ): Promise<void>;

  /** List workflows */
  listWorkflows(options?: {
    status?: WorkflowStatus;
    limit?: number;
    offset?: number;
  }): Promise<Workflow[]>;

  // ============ Task Operations ============

  /** Create tasks for a workflow */
  createTasks(
    workflowId: string,
    tasks: Array<{
      name: string;
      type: string;
      input: Record<string, unknown>;
      dependsOn: string[];
      maxAttempts?: number;
    }>
  ): Promise<Task[]>;

  /** Get tasks for a workflow */
  getWorkflowTasks(workflowId: string): Promise<Task[]>;

  /** Claim a task atomically (embedded mode only) */
  claimTask?(workerId: string, taskTypes?: string[]): Promise<Task | null>;

  /** Update task heartbeat (embedded mode only) */
  heartbeat?(taskId: string): Promise<void>;

  /** Complete a task */
  completeTask(taskId: string, output: Record<string, unknown>): Promise<void>;

  /** Fail a task */
  failTask(taskId: string, error: string): Promise<void>;

  // ============ Checkpoint Operations ============

  /** Create a checkpoint */
  createCheckpoint(
    taskId: string,
    stepIndex: number,
    state: Record<string, unknown>
  ): Promise<void>;

  /** Get latest checkpoint for a task */
  getCheckpoint(
    taskId: string
  ): Promise<{ stepIndex: number; state: Record<string, unknown> } | null>;

  /** Get all checkpoints for a workflow (for time travel) */
  getWorkflowCheckpoints(workflowId: string): Promise<
    Array<{
      taskId: string;
      taskName: string;
      stepIndex: number;
      state: Record<string, unknown>;
      createdAt: Date;
    }>
  >;

  // ============ Memory Operations ============

  /** Store memory for learning */
  storeMemory(
    taskId: string,
    eventType: string,
    summary: string,
    embedding: number[],
    taskType?: string,
    errorCategory?: string,
    resolution?: string
  ): Promise<void>;

  /** Query similar memories */
  queryMemories(
    embedding: number[],
    taskType?: string,
    limit?: number
  ): Promise<
    Array<{
      summary: string;
      eventType: string;
      resolution?: string;
      similarity: number;
    }>
  >;

  // ============ Workflow Status ============

  /** Check if workflow is complete */
  isWorkflowComplete(workflowId: string): Promise<{
    complete: boolean;
    failed: number;
    done: number;
    pending: number;
  }>;

  // ============ Time Travel ============

  /** Replay workflow from checkpoint */
  replayFromCheckpoint?(
    workflowId: string,
    checkpointId: string,
    newInput?: Record<string, unknown>
  ): Promise<Workflow>;

  // ============ Cost Tracking ============

  /** Get cost summary for a workflow */
  getWorkflowCost?(workflowId: string): Promise<{
    totalTokens: number;
    estimatedCostUsd: number;
    savedByRecoveryUsd: number;
  }>;
}

/**
 * Type guard for embedded backend (has worker-related methods)
 */
export function isEmbeddedBackend(
  backend: Backend
): backend is Backend & Required<Pick<Backend, 'claimTask' | 'heartbeat'>> {
  return 'claimTask' in backend && typeof backend.claimTask === 'function';
}
