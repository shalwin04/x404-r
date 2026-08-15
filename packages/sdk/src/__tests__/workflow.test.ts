/**
 * Workflow Builder Tests
 * Tests for workflow definition, DAG validation, and step execution
 */

import { describe, it, expect, vi } from 'vitest';
import { WorkflowBuilder } from '../workflow.js';
import type { WorkflowDefinition, StepDefinition, AgentDBConfig } from '../types.js';

// Create a mock client
const createMockClient = () => ({
  createWorkflow: vi.fn().mockResolvedValue({ id: 'workflow-1', status: 'pending' }),
  createTasks: vi.fn().mockImplementation((workflowId: string, tasks: any[]) =>
    tasks.map((t, i) => ({ id: `task-${i}`, ...t }))
  ),
  updateWorkflowStatus: vi.fn().mockResolvedValue(undefined),
  getWorkflow: vi.fn().mockResolvedValue({ id: 'workflow-1', status: 'completed' }),
  emit: vi.fn().mockResolvedValue(undefined),
  log: vi.fn(),
  db: {
    query: vi.fn().mockResolvedValue({ rows: [] }),
  },
});

describe('WorkflowBuilder', () => {
  describe('constructor and basic properties', () => {
    it('creates workflow with required properties', () => {
      const client = createMockClient();
      const definition: WorkflowDefinition = {
        name: 'test-workflow',
        version: '1.0.0',
        steps: [
          {
            name: 'step1',
            handler: async () => ({ result: 'done' }),
          },
        ],
      };

      const builder = new WorkflowBuilder(client as any, definition, 'tenant-1');

      expect(builder.name).toBe('test-workflow');
      expect(builder.version).toBe('1.0.0');
    });

    it('uses default version when not specified', () => {
      const client = createMockClient();
      const definition: WorkflowDefinition = {
        name: 'default-version',
        steps: [
          {
            name: 'step1',
            handler: async () => ({}),
          },
        ],
      };

      const builder = new WorkflowBuilder(client as any, definition, 'tenant-1');

      expect(builder.version).toBe('1.0.0');
    });
  });

  describe('DAG validation', () => {
    it('validates linear dependencies', () => {
      const client = createMockClient();
      const definition: WorkflowDefinition = {
        name: 'linear',
        steps: [
          { name: 'a', handler: async () => ({}) },
          { name: 'b', dependsOn: ['a'], handler: async () => ({}) },
          { name: 'c', dependsOn: ['b'], handler: async () => ({}) },
        ],
      };

      // Should not throw
      expect(() => new WorkflowBuilder(client as any, definition, 'tenant-1')).not.toThrow();
    });

    it('validates parallel dependencies (diamond pattern)', () => {
      const client = createMockClient();
      const definition: WorkflowDefinition = {
        name: 'diamond',
        steps: [
          { name: 'start', handler: async () => ({}) },
          { name: 'left', dependsOn: ['start'], handler: async () => ({}) },
          { name: 'right', dependsOn: ['start'], handler: async () => ({}) },
          { name: 'end', dependsOn: ['left', 'right'], handler: async () => ({}) },
        ],
      };

      expect(() => new WorkflowBuilder(client as any, definition, 'tenant-1')).not.toThrow();
    });

    it('rejects circular dependencies', () => {
      const client = createMockClient();
      const definition: WorkflowDefinition = {
        name: 'circular',
        steps: [
          { name: 'a', dependsOn: ['c'], handler: async () => ({}) },
          { name: 'b', dependsOn: ['a'], handler: async () => ({}) },
          { name: 'c', dependsOn: ['b'], handler: async () => ({}) },
        ],
      };

      expect(() => new WorkflowBuilder(client as any, definition, 'tenant-1')).toThrow(/circular/i);
    });

    it('rejects missing dependencies', () => {
      const client = createMockClient();
      const definition: WorkflowDefinition = {
        name: 'missing-dep',
        steps: [
          { name: 'a', handler: async () => ({}) },
          { name: 'b', dependsOn: ['missing'], handler: async () => ({}) },
        ],
      };

      expect(() => new WorkflowBuilder(client as any, definition, 'tenant-1')).toThrow(/does not exist/i);
    });

    it('rejects self-referencing dependencies', () => {
      const client = createMockClient();
      const definition: WorkflowDefinition = {
        name: 'self-ref',
        steps: [
          { name: 'self', dependsOn: ['self'], handler: async () => ({}) },
        ],
      };

      expect(() => new WorkflowBuilder(client as any, definition, 'tenant-1')).toThrow();
    });
  });

  describe('getStepHandler', () => {
    it('returns step by name', () => {
      const client = createMockClient();
      const handler = async () => ({ data: 'test' });
      const definition: WorkflowDefinition = {
        name: 'get-step',
        steps: [
          { name: 'target', handler },
        ],
      };

      const builder = new WorkflowBuilder(client as any, definition, 'tenant-1');
      const step = builder.getStepHandler('target');

      expect(step).toBeDefined();
      expect(step?.name).toBe('target');
      expect(step?.handler).toBe(handler);
    });

    it('returns undefined for non-existent step', () => {
      const client = createMockClient();
      const definition: WorkflowDefinition = {
        name: 'no-step',
        steps: [
          { name: 'exists', handler: async () => ({}) },
        ],
      };

      const builder = new WorkflowBuilder(client as any, definition, 'tenant-1');
      expect(builder.getStepHandler('missing')).toBeUndefined();
    });
  });

  describe('steps accessor', () => {
    it('returns all step definitions', () => {
      const client = createMockClient();
      const definition: WorkflowDefinition = {
        name: 'steps-test',
        steps: [
          { name: 'step1', handler: async () => ({}) },
          { name: 'step2', handler: async () => ({}) },
          { name: 'step3', handler: async () => ({}) },
        ],
      };

      const builder = new WorkflowBuilder(client as any, definition, 'tenant-1');

      expect(builder.steps).toHaveLength(3);
      expect(builder.steps.map(s => s.name)).toEqual(['step1', 'step2', 'step3']);
    });
  });

  describe('step configuration', () => {
    it('preserves custom maxAttempts', () => {
      const client = createMockClient();
      const definition: WorkflowDefinition = {
        name: 'custom-config',
        steps: [
          { name: 'custom-attempts', maxAttempts: 5, handler: async () => ({}) },
        ],
      };

      const builder = new WorkflowBuilder(client as any, definition, 'tenant-1');
      const step = builder.getStepHandler('custom-attempts');

      expect(step?.maxAttempts).toBe(5);
    });

    it('preserves timeout configuration', () => {
      const client = createMockClient();
      const definition: WorkflowDefinition = {
        name: 'timeout-config',
        steps: [
          { name: 'timed', timeout: 30000, handler: async () => ({}) },
        ],
      };

      const builder = new WorkflowBuilder(client as any, definition, 'tenant-1');
      const step = builder.getStepHandler('timed');

      expect(step?.timeout).toBe(30000);
    });
  });

  describe('run', () => {
    it('creates workflow and tasks', async () => {
      const client = createMockClient();
      const definition: WorkflowDefinition = {
        name: 'run-test',
        steps: [
          { name: 'step1', handler: async () => ({}) },
          { name: 'step2', dependsOn: ['step1'], handler: async () => ({}) },
        ],
      };

      const builder = new WorkflowBuilder(client as any, definition, 'tenant-1');
      const result = await builder.run({ input: 'test' });

      expect(client.createWorkflow).toHaveBeenCalledWith(
        'run-test',
        '1.0.0',
        { input: 'test' },
        0
      );
      expect(client.createTasks).toHaveBeenCalled();
      expect(result.workflowId).toBe('workflow-1');
      expect(result.status).toBe('running');
    });

    it('waits for completion when wait option is true', async () => {
      const client = createMockClient();
      const definition: WorkflowDefinition = {
        name: 'wait-test',
        steps: [
          { name: 'step1', handler: async () => ({}) },
        ],
      };

      const builder = new WorkflowBuilder(client as any, definition, 'tenant-1');
      const result = await builder.run({ input: 'test' }, { wait: true });

      expect(client.getWorkflow).toHaveBeenCalled();
      expect(result.status).toBe('completed');
    });
  });
});
