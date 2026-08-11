/**
 * Worker
 * Claims and executes tasks from the database
 */

import { randomUUID } from 'crypto';
import type { AgentDB } from './client.js';
import type { WorkerConfig, Task, StepDefinition } from './types.js';
import { createStepContext, restoreFromCheckpoint } from './context.js';
import { WorkflowBuilder } from './workflow.js';

/**
 * Worker - Processes tasks from the queue
 *
 * @example
 * ```typescript
 * const worker = agent.worker({
 *   concurrency: 5,
 *   pollInterval: 1000,
 * });
 *
 * await worker.start();
 * ```
 */
export class Worker {
  private client: AgentDB;
  private config: Required<WorkerConfig>;
  private workerId: string;
  private running: boolean = false;
  private activeTasks: Map<string, { task: Task; heartbeatInterval: NodeJS.Timeout }> = new Map();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private workflows: Map<string, WorkflowBuilder<any, any>> = new Map();

  constructor(client: AgentDB, config: WorkerConfig = {}) {
    this.client = client;
    this.workerId = `worker-${randomUUID().slice(0, 8)}`;

    this.config = {
      concurrency: config.concurrency ?? 5,
      region: config.region ?? 'default',
      heartbeatInterval: config.heartbeatInterval ?? 10000,
      pollInterval: config.pollInterval ?? 1000,
      taskTypes: config.taskTypes ?? [],
    };
  }

  /**
   * Register a workflow with this worker
   */
  register<TInput, TOutput>(workflow: WorkflowBuilder<TInput, TOutput>): this {
    this.workflows.set(workflow.name, workflow);
    return this;
  }

  /**
   * Start the worker
   */
  async start(): Promise<void> {
    if (this.running) {
      throw new Error('Worker is already running');
    }

    this.running = true;
    this.client.log(`Worker ${this.workerId} starting...`, {
      concurrency: this.config.concurrency,
      region: this.config.region,
    });

    // Start the main loop
    this.poll();
  }

  /**
   * Stop the worker gracefully
   */
  async stop(): Promise<void> {
    this.running = false;

    // Wait for active tasks to complete
    this.client.log(`Worker ${this.workerId} stopping, waiting for ${this.activeTasks.size} tasks...`);

    // Clear all heartbeat intervals
    for (const [, { heartbeatInterval }] of this.activeTasks) {
      clearInterval(heartbeatInterval);
    }

    // Wait a bit for tasks to finish
    await new Promise(resolve => setTimeout(resolve, 1000));

    this.client.log(`Worker ${this.workerId} stopped`);
  }

  /**
   * Poll for tasks
   */
  private async poll(): Promise<void> {
    while (this.running) {
      try {
        // Check if we have capacity
        if (this.activeTasks.size >= this.config.concurrency) {
          await this.sleep(this.config.pollInterval);
          continue;
        }

        // Try to claim a task
        const task = await this.client.claimTask(
          this.workerId,
          this.config.taskTypes.length > 0 ? this.config.taskTypes : undefined
        );

        if (task) {
          // Process task in background
          this.processTask(task).catch(error => {
            console.error(`Error processing task ${task.id}:`, error);
          });
        } else {
          // No tasks available, wait before polling again
          await this.sleep(this.config.pollInterval);
        }
      } catch (error) {
        console.error('Poll error:', error);
        await this.sleep(this.config.pollInterval);
      }
    }
  }

  /**
   * Process a claimed task
   */
  private async processTask(task: Task): Promise<void> {
    this.client.log(`Processing task: ${task.name}`, { taskId: task.id });

    // Start heartbeat
    const heartbeatInterval = setInterval(async () => {
      try {
        await this.client.heartbeat(task.id);
      } catch (error) {
        console.error(`Heartbeat failed for task ${task.id}:`, error);
      }
    }, this.config.heartbeatInterval);

    this.activeTasks.set(task.id, { task, heartbeatInterval });

    try {
      // Get workflow
      const workflow = await this.client.getWorkflow(task.workflowId);
      if (!workflow) {
        throw new Error(`Workflow ${task.workflowId} not found`);
      }

      // Find the step handler
      const workflowBuilder = this.workflows.get(workflow.name);
      if (!workflowBuilder) {
        throw new Error(`No handler registered for workflow: ${workflow.name}`);
      }

      const stepDef = workflowBuilder.getStepHandler(task.type);
      if (!stepDef) {
        throw new Error(`No handler for step: ${task.type}`);
      }

      // Try to restore from checkpoint
      const restored = await restoreFromCheckpoint(this.client, workflow, task);

      // Create or restore context
      const context = restored?.context || createStepContext(this.client, workflow, task);

      // Query similar memories for learning
      try {
        const embedding = await this.client.ai.embed(
          `${task.type}: ${task.name} ${JSON.stringify(task.input)}`
        );
        const memories = await this.client.queryMemories(embedding, task.type, 3);

        if (memories.length > 0) {
          this.client.log(`Found ${memories.length} relevant memories`);
          // Add memories to context state
          context.state._memories = memories;
        }
      } catch (error) {
        // Embedding failed, continue without memories
        this.client.log('Could not query memories:', { error: String(error) });
      }

      // Execute the step
      await this.client.emit({ type: 'task:started', task });

      const result = await stepDef.handler(context);

      // Store success memory
      try {
        const summary = `Task "${task.name}" completed successfully. Output: ${JSON.stringify(result)}`;
        const embedding = await this.client.ai.embed(summary);
        await this.client.storeMemory(
          task.id,
          'success',
          summary,
          embedding,
          task.type,
          undefined,
          'Completed without issues'
        );
      } catch {
        // Ignore memory storage errors
      }

      // Complete the task
      await this.client.completeTask(task.id, result as Record<string, unknown>);

      await this.client.emit({
        type: 'task:completed',
        task: { ...task, status: 'done', output: result as Record<string, unknown> },
      });

      this.client.log(`Task completed: ${task.name}`, { taskId: task.id });

      // Check if workflow is complete
      await this.checkWorkflowCompletion(task.workflowId);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.client.log(`Task failed: ${task.name}`, { taskId: task.id, error: errorMessage });

      // Store failure memory
      try {
        const summary = `Task "${task.name}" failed: ${errorMessage}`;
        const embedding = await this.client.ai.embed(summary);
        await this.client.storeMemory(
          task.id,
          'failure',
          summary,
          embedding,
          task.type,
          this.categorizeError(errorMessage),
          undefined
        );
      } catch {
        // Ignore memory storage errors
      }

      // Fail the task
      await this.client.failTask(task.id, errorMessage);

      await this.client.emit({
        type: 'task:failed',
        task: { ...task, status: 'failed', error: errorMessage },
        error: error instanceof Error ? error : new Error(errorMessage),
      });

      // Check if workflow should fail
      await this.checkWorkflowCompletion(task.workflowId);

    } finally {
      // Clean up
      clearInterval(heartbeatInterval);
      this.activeTasks.delete(task.id);
    }
  }

  /**
   * Check if workflow is complete and update status
   */
  private async checkWorkflowCompletion(workflowId: string): Promise<void> {
    const status = await this.client.isWorkflowComplete(workflowId);

    if (status.complete) {
      const finalStatus = status.failed > 0 ? 'failed' : 'completed';
      await this.client.updateWorkflowStatus(workflowId, finalStatus);

      const workflow = await this.client.getWorkflow(workflowId);
      if (workflow) {
        if (finalStatus === 'completed') {
          await this.client.emit({ type: 'workflow:completed', workflow });
        } else {
          await this.client.emit({
            type: 'workflow:failed',
            workflow,
            error: new Error(`${status.failed} tasks failed`),
          });
        }
      }

      this.client.log(`Workflow ${workflowId} ${finalStatus}`);
    }
  }

  /**
   * Categorize error for memory storage
   */
  private categorizeError(error: string): string {
    if (/syntax/i.test(error)) return 'syntax_error';
    if (/timeout/i.test(error)) return 'timeout';
    if (/network|connection/i.test(error)) return 'network_error';
    if (/permission|auth/i.test(error)) return 'auth_error';
    if (/rate limit|quota/i.test(error)) return 'rate_limit';
    return 'unknown';
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get worker ID
   */
  get id(): string {
    return this.workerId;
  }

  /**
   * Check if worker is running
   */
  get isRunning(): boolean {
    return this.running;
  }

  /**
   * Get number of active tasks
   */
  get activeTaskCount(): number {
    return this.activeTasks.size;
  }
}
