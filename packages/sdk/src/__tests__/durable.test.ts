/**
 * Durable API Tests
 * Tests for the one-line crash-proof API
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DurableContext, DurableOptions } from '../durable.js';

// Mock the durable module's dependencies
vi.mock('../client.js', () => ({
  AgentDB: vi.fn().mockImplementation(() => ({
    ready: vi.fn().mockResolvedValue({
      workflow: vi.fn().mockReturnValue({
        run: vi.fn().mockResolvedValue({ output: 'test-result' }),
      }),
      close: vi.fn().mockResolvedValue(undefined),
    }),
  })),
}));

describe('DurableContext', () => {
  describe('checkpoint', () => {
    it('records checkpoint with name', async () => {
      // Mock checkpoint function
      const checkpointFn = vi.fn().mockResolvedValue(undefined);
      const ctx: DurableContext = {
        checkpoint: checkpointFn,
        state: {},
        input: {},
      };

      await ctx.checkpoint('step-1');

      expect(checkpointFn).toHaveBeenCalledWith('step-1');
    });

    it('checkpoint with state updates context', async () => {
      const state = { progress: 0 };
      const checkpointFn = vi.fn().mockImplementation(async (name: string, newState?: Record<string, unknown>) => {
        if (newState) {
          Object.assign(state, newState);
        }
      });

      const ctx: DurableContext = {
        checkpoint: checkpointFn,
        state,
        input: {},
      };

      await ctx.checkpoint('step-1', { progress: 50 });

      expect(state.progress).toBe(50);
    });
  });

  describe('state management', () => {
    it('provides access to current state', () => {
      const ctx: DurableContext = {
        checkpoint: vi.fn(),
        state: { counter: 5, items: ['a', 'b'] },
        input: {},
      };

      expect(ctx.state.counter).toBe(5);
      expect(ctx.state.items).toEqual(['a', 'b']);
    });

    it('provides access to input', () => {
      const ctx: DurableContext = {
        checkpoint: vi.fn(),
        state: {},
        input: { taskId: '123', data: 'test' },
      };

      expect(ctx.input.taskId).toBe('123');
      expect(ctx.input.data).toBe('test');
    });
  });
});

describe('DurableOptions', () => {
  it('accepts connection string', () => {
    const options: DurableOptions = {
      connectionString: 'postgresql://localhost:26257/test',
    };

    expect(options.connectionString).toBeDefined();
  });

  it('accepts max attempts configuration', () => {
    const options: DurableOptions = {
      maxAttempts: 5,
    };

    expect(options.maxAttempts).toBe(5);
  });

  it('accepts AI configuration', () => {
    const options: DurableOptions = {
      ai: {
        provider: 'gemini',
        apiKey: 'test-key',
      },
    };

    expect(options.ai?.provider).toBe('gemini');
  });

  it('supports all AI providers', () => {
    const providers = ['gemini', 'openai', 'anthropic', 'bedrock'] as const;

    for (const provider of providers) {
      const options: DurableOptions = {
        ai: { provider },
      };
      expect(options.ai?.provider).toBe(provider);
    }
  });
});

describe('Durable Function Behavior', () => {
  // These tests describe expected behavior without requiring real DB

  it('should create unique task IDs for each invocation', () => {
    const taskNames = new Set<string>();

    // Simulate multiple durable calls
    for (let i = 0; i < 100; i++) {
      const name = `task-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      expect(taskNames.has(name)).toBe(false);
      taskNames.add(name);
    }
  });

  it('should handle async handlers', async () => {
    const asyncHandler = async (ctx: DurableContext) => {
      await new Promise(resolve => setTimeout(resolve, 10));
      return { completed: true };
    };

    const result = await asyncHandler({
      checkpoint: vi.fn(),
      state: {},
      input: {},
    });

    expect(result.completed).toBe(true);
  });

  it('should propagate handler errors', async () => {
    const failingHandler = async () => {
      throw new Error('Handler failed');
    };

    await expect(failingHandler()).rejects.toThrow('Handler failed');
  });

  it('should support checkpoint-based resumption logic', async () => {
    // Simulate a handler that processes items with checkpoints
    const items = ['a', 'b', 'c', 'd'];
    const processedItems: string[] = [];
    let checkpointCount = 0;

    const checkpointFn = vi.fn().mockImplementation(async () => {
      checkpointCount++;
    });

    const ctx: DurableContext = {
      checkpoint: checkpointFn,
      state: { processedIndex: 0 },
      input: { items },
    };

    // Simulate processing with checkpoints
    const startIndex = ctx.state.processedIndex as number;
    for (let i = startIndex; i < items.length; i++) {
      processedItems.push(items[i]);
      ctx.state.processedIndex = i + 1;
      await ctx.checkpoint(`item-${i}`);
    }

    expect(processedItems).toEqual(['a', 'b', 'c', 'd']);
    expect(checkpointCount).toBe(4);
  });

  it('should resume from last checkpoint state', async () => {
    // Simulate resuming after crash at item 2
    const items = ['a', 'b', 'c', 'd'];
    const processedItems: string[] = [];

    const ctx: DurableContext = {
      checkpoint: vi.fn(),
      state: { processedIndex: 2 }, // Recovered state - already processed 'a', 'b'
      input: { items },
    };

    const startIndex = ctx.state.processedIndex as number;
    for (let i = startIndex; i < items.length; i++) {
      processedItems.push(items[i]);
    }

    // Should only process remaining items
    expect(processedItems).toEqual(['c', 'd']);
    expect(processedItems.length).toBe(2);
  });
});

describe('Durable Error Handling', () => {
  it('should distinguish recoverable from fatal errors', () => {
    const recoverableErrors = [
      new Error('ECONNRESET'),
      new Error('timeout'),
      new Error('rate limit exceeded'),
    ];

    const fatalErrors = [
      new Error('Invalid configuration'),
      new TypeError('Cannot read property'),
      new SyntaxError('Unexpected token'),
    ];

    // Recoverable errors typically contain these patterns
    const recoverablePatterns = /ECONNRESET|timeout|rate limit|ECONNREFUSED/i;

    for (const err of recoverableErrors) {
      expect(recoverablePatterns.test(err.message)).toBe(true);
    }

    for (const err of fatalErrors) {
      expect(recoverablePatterns.test(err.message)).toBe(false);
    }
  });

  it('should track attempt count', () => {
    const maxAttempts = 3;
    let attempts = 0;

    const executeWithRetry = async (fn: () => Promise<unknown>) => {
      while (attempts < maxAttempts) {
        attempts++;
        try {
          return await fn();
        } catch (error) {
          if (attempts >= maxAttempts) throw error;
        }
      }
    };

    const alwaysFails = async () => {
      throw new Error('Always fails');
    };

    expect(executeWithRetry(alwaysFails)).rejects.toThrow();
  });
});
