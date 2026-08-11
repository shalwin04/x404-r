/**
 * Step Execution Context
 * Provides checkpoint, logging, and AI access to step handlers
 */

import type { AgentDB } from './client.js';
import type { Task, Workflow, StepContext, AIProvider } from './types.js';

/**
 * Create a step context for task execution
 */
export function createStepContext<TInput = unknown>(
  client: AgentDB,
  workflow: Workflow,
  task: Task,
  initialState: Record<string, unknown> = {}
): StepContext<TInput> {
  let stepIndex = 0;
  const state = { ...initialState };

  const context: StepContext<TInput> = {
    input: task.input as TInput,
    state,

    workflow: {
      id: workflow.id,
      name: workflow.name,
      input: workflow.input,
    },

    task: {
      id: task.id,
      name: task.name,
      attemptCount: task.attemptCount,
    },

    ai: client.ai,

    checkpoint: async (newState?: Record<string, unknown>) => {
      if (newState) {
        Object.assign(state, newState);
      }
      stepIndex++;
      await client.createCheckpoint(task.id, stepIndex, state);
      client.log(`Checkpoint created at step ${stepIndex}`, { taskId: task.id });
    },

    log: (message: string, data?: Record<string, unknown>) => {
      const prefix = `[${workflow.name}/${task.name}]`;
      if (data) {
        console.log(`${prefix} ${message}`, data);
      } else {
        console.log(`${prefix} ${message}`);
      }
    },

    sleep: async (ms: number) => {
      await new Promise(resolve => setTimeout(resolve, ms));
    },
  };

  return context;
}

/**
 * Restore context from checkpoint
 */
export async function restoreFromCheckpoint<TInput = unknown>(
  client: AgentDB,
  workflow: Workflow,
  task: Task
): Promise<{ context: StepContext<TInput>; resumeFromStep: number } | null> {
  const checkpoint = await client.getCheckpoint(task.id);

  if (!checkpoint) {
    return null;
  }

  client.log(`Resuming from checkpoint at step ${checkpoint.stepIndex}`, {
    taskId: task.id,
  });

  const context = createStepContext<TInput>(
    client,
    workflow,
    task,
    checkpoint.state
  );

  return {
    context,
    resumeFromStep: checkpoint.stepIndex,
  };
}
