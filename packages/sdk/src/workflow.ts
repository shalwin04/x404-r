/**
 * Workflow Builder
 * Defines and runs workflows
 */

import type { AgentDB } from './client.js';
import type {
  WorkflowDefinition,
  StepDefinition,
  RunOptions,
  RunResult,
  Workflow,
  Task,
} from './types.js';

/**
 * Workflow Builder - Fluent API for defining and running workflows
 */
export class WorkflowBuilder<TInput = unknown, TOutput = unknown> {
  private client: AgentDB;
  private definition: WorkflowDefinition<TInput, TOutput>;
  private tenantId: string;

  constructor(
    client: AgentDB,
    definition: WorkflowDefinition<TInput, TOutput>,
    tenantId: string
  ) {
    this.client = client;
    this.definition = definition;
    this.tenantId = tenantId;

    // Validate dependencies
    this.validateDependencies();
  }

  /**
   * Get workflow name
   */
  get name(): string {
    return this.definition.name;
  }

  /**
   * Get workflow version
   */
  get version(): string {
    return this.definition.version || '1.0.0';
  }

  /**
   * Get step definitions
   */
  get steps(): StepDefinition[] {
    return this.definition.steps;
  }

  /**
   * Run the workflow with input
   */
  async run(input: TInput, options: RunOptions = {}): Promise<RunResult<TOutput>> {
    // Create workflow record
    const workflow = await this.client.createWorkflow(
      this.definition.name,
      this.definition.version || '1.0.0',
      input as Record<string, unknown>,
      options.priority || 0
    );

    this.client.log(`Created workflow: ${workflow.id}`);
    await this.client.emit({ type: 'workflow:created', workflow });

    // Create tasks for each step
    const stepNameToId = new Map<string, string>();
    const tasks: Array<{
      name: string;
      type: string;
      input: Record<string, unknown>;
      dependsOn: string[];
      maxAttempts?: number;
    }> = [];

    for (const step of this.definition.steps) {
      const dependsOnIds = (step.dependsOn || [])
        .map(name => stepNameToId.get(name))
        .filter((id): id is string => id !== undefined);

      tasks.push({
        name: step.name,
        type: step.name, // Use step name as type
        input: input as Record<string, unknown>,
        dependsOn: [], // Will be resolved after creation
        maxAttempts: step.maxAttempts || 3,
      });
    }

    // Create all tasks first to get IDs
    const createdTasks = await this.client.createTasks(workflow.id, tasks);

    // Build name to ID mapping
    createdTasks.forEach((task, index) => {
      stepNameToId.set(this.definition.steps[index].name, task.id);
    });

    // Update dependencies with actual IDs
    for (let i = 0; i < this.definition.steps.length; i++) {
      const step = this.definition.steps[i];
      const task = createdTasks[i];

      if (step.dependsOn && step.dependsOn.length > 0) {
        const dependsOnIds = step.dependsOn
          .map(name => stepNameToId.get(name))
          .filter((id): id is string => id !== undefined);

        if (dependsOnIds.length > 0) {
          await this.client.db.query(
            'UPDATE task_nodes SET depends_on = $1 WHERE id = $2',
            [dependsOnIds, task.id]
          );
        }
      }
    }

    // Update workflow status to running
    await this.client.updateWorkflowStatus(workflow.id, 'running');
    await this.client.emit({
      type: 'workflow:started',
      workflow: { ...workflow, status: 'running' },
    });

    this.client.log(`Workflow started with ${createdTasks.length} tasks`);

    // If wait option, poll for completion
    if (options.wait) {
      return await this.waitForCompletion(workflow.id, options.timeout);
    }

    return {
      workflowId: workflow.id,
      status: 'running',
    };
  }

  /**
   * Wait for workflow completion
   */
  private async waitForCompletion(
    workflowId: string,
    timeout?: number
  ): Promise<RunResult<TOutput>> {
    const startTime = Date.now();
    const pollInterval = 1000; // 1 second

    while (true) {
      // Check timeout
      if (timeout && Date.now() - startTime > timeout) {
        return {
          workflowId,
          status: 'failed',
          error: 'Workflow timed out',
        };
      }

      // Get workflow status
      const workflow = await this.client.getWorkflow(workflowId);
      if (!workflow) {
        return {
          workflowId,
          status: 'failed',
          error: 'Workflow not found',
        };
      }

      if (workflow.status === 'completed') {
        return {
          workflowId,
          status: 'completed',
          output: workflow.output as TOutput,
        };
      }

      if (workflow.status === 'failed') {
        return {
          workflowId,
          status: 'failed',
          error: workflow.error || 'Workflow failed',
        };
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
  }

  /**
   * Get a step handler by name
   */
  getStepHandler(name: string): StepDefinition | undefined {
    return this.definition.steps.find(s => s.name === name);
  }

  /**
   * Validate that all dependencies reference existing steps
   */
  private validateDependencies(): void {
    const stepNames = new Set(this.definition.steps.map(s => s.name));

    for (const step of this.definition.steps) {
      if (step.dependsOn) {
        for (const dep of step.dependsOn) {
          if (!stepNames.has(dep)) {
            throw new Error(
              `Step "${step.name}" depends on "${dep}" which does not exist`
            );
          }
        }
      }
    }

    // Check for cycles
    this.detectCycles();
  }

  /**
   * Detect circular dependencies
   */
  private detectCycles(): void {
    const visited = new Set<string>();
    const recStack = new Set<string>();

    const dfs = (stepName: string): boolean => {
      visited.add(stepName);
      recStack.add(stepName);

      const step = this.definition.steps.find(s => s.name === stepName);
      if (step?.dependsOn) {
        for (const dep of step.dependsOn) {
          if (!visited.has(dep) && dfs(dep)) {
            return true;
          } else if (recStack.has(dep)) {
            throw new Error(
              `Circular dependency detected: ${stepName} -> ${dep}`
            );
          }
        }
      }

      recStack.delete(stepName);
      return false;
    };

    for (const step of this.definition.steps) {
      if (!visited.has(step.name)) {
        dfs(step.name);
      }
    }
  }
}
