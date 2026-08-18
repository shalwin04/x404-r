/**
 * Backend abstraction tests
 */

import { describe, it, expect, vi } from 'vitest';
import { x404r } from '../client.js';
import { CloudBackend } from '../backend/cloud.js';
import { isEmbeddedConfig, isCloudConfig } from '../types.js';

describe('Dual Mode Configuration', () => {
  describe('Type Guards', () => {
    it('should identify embedded config', () => {
      const config = {
        connectionString: 'postgresql://localhost:26257/test',
      };
      expect(isEmbeddedConfig(config)).toBe(true);
      expect(isCloudConfig(config)).toBe(false);
    });

    it('should identify embedded config with explicit mode', () => {
      const config = {
        mode: 'embedded' as const,
        connectionString: 'postgresql://localhost:26257/test',
      };
      expect(isEmbeddedConfig(config)).toBe(true);
      expect(isCloudConfig(config)).toBe(false);
    });

    it('should identify cloud config', () => {
      const config = {
        mode: 'cloud' as const,
        apiKey: 'x404r_test_key',
      };
      expect(isEmbeddedConfig(config)).toBe(false);
      expect(isCloudConfig(config)).toBe(true);
    });
  });

  describe('Cloud Mode Client', () => {
    it('should create client in cloud mode', () => {
      const runtime = new x404r({
        mode: 'cloud',
        apiKey: 'x404r_test_key',
        baseUrl: 'http://localhost:3001',
      });

      expect(runtime.currentMode).toBe('cloud');
      expect(runtime.isCloud).toBe(true);
      expect(runtime.isEmbedded).toBe(false);
    });

    it('should throw when accessing worker in cloud mode', () => {
      const runtime = new x404r({
        mode: 'cloud',
        apiKey: 'x404r_test_key',
      });

      expect(() => runtime.worker()).toThrow('Workers are not available in cloud mode');
    });

    it('should throw when accessing db in cloud mode', () => {
      const runtime = new x404r({
        mode: 'cloud',
        apiKey: 'x404r_test_key',
      });

      expect(() => runtime.db).toThrow('Direct database access not available in cloud mode');
    });
  });

  describe('CloudBackend', () => {
    it('should construct with config', () => {
      const backend = new CloudBackend({
        apiKey: 'x404r_test_key',
        baseUrl: 'http://localhost:3001',
      });

      expect(backend).toBeDefined();
    });

    it('should use default baseUrl if not provided', () => {
      const backend = new CloudBackend({
        apiKey: 'x404r_test_key',
      });

      expect(backend).toBeDefined();
    });
  });

  describe('Mode Detection', () => {
    it('should default to embedded mode when no mode specified', () => {
      // Mock pg Pool to avoid actual connection
      vi.mock('pg', () => ({
        Pool: vi.fn().mockImplementation(() => ({
          query: vi.fn(),
          end: vi.fn(),
        })),
      }));

      const runtime = new x404r({
        connectionString: 'postgresql://localhost:26257/test',
      });

      expect(runtime.currentMode).toBe('embedded');
      expect(runtime.isEmbedded).toBe(true);
    });
  });
});

describe('CloudBackend API Methods', () => {
  it('should have submit method', () => {
    const backend = new CloudBackend({
      apiKey: 'test',
    });

    expect(typeof backend.submit).toBe('function');
  });

  it('should have waitForCompletion method', () => {
    const backend = new CloudBackend({
      apiKey: 'test',
    });

    expect(typeof backend.waitForCompletion).toBe('function');
  });

  it('should have all Backend interface methods', () => {
    const backend = new CloudBackend({
      apiKey: 'test',
    });

    // Core methods
    expect(typeof backend.ready).toBe('function');
    expect(typeof backend.close).toBe('function');

    // Workflow operations
    expect(typeof backend.createWorkflow).toBe('function');
    expect(typeof backend.getWorkflow).toBe('function');
    expect(typeof backend.updateWorkflowStatus).toBe('function');
    expect(typeof backend.listWorkflows).toBe('function');

    // Task operations
    expect(typeof backend.createTasks).toBe('function');
    expect(typeof backend.getWorkflowTasks).toBe('function');
    expect(typeof backend.completeTask).toBe('function');
    expect(typeof backend.failTask).toBe('function');

    // Checkpoint operations
    expect(typeof backend.createCheckpoint).toBe('function');
    expect(typeof backend.getCheckpoint).toBe('function');
    expect(typeof backend.getWorkflowCheckpoints).toBe('function');

    // Memory operations
    expect(typeof backend.storeMemory).toBe('function');
    expect(typeof backend.queryMemories).toBe('function');

    // Status & replay
    expect(typeof backend.isWorkflowComplete).toBe('function');
    expect(typeof backend.replayFromCheckpoint).toBe('function');
    expect(typeof backend.getWorkflowCost).toBe('function');
  });
});
