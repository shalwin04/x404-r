/**
 * Chaos Engineering Module
 *
 * Built-in failure injection for testing crash recovery.
 * Enables chaos testing without external tools.
 *
 * @example
 * ```typescript
 * const workflow = runtime.workflow('test', {
 *   chaos: {
 *     enabled: process.env.CHAOS_MODE === 'true',
 *     failureRate: 0.3,  // 30% of tasks fail randomly
 *     failAtCheckpoints: ['step-2'],  // Always fail at these checkpoints
 *     latencyMs: { min: 100, max: 2000 },  // Random latency injection
 *   },
 *   steps: [...]
 * });
 * ```
 */

export interface ChaosConfig {
  /** Enable chaos mode */
  enabled: boolean;

  /** Random failure rate (0-1) */
  failureRate?: number;

  /** Always fail at these checkpoint names */
  failAtCheckpoints?: string[];

  /** Inject random latency */
  latencyMs?: {
    min: number;
    max: number;
  };

  /** Fail after N successful executions (for testing recovery) */
  failAfterSuccesses?: number;

  /** Specific task types to target */
  targetTaskTypes?: string[];

  /** Failure types to inject */
  failureTypes?: ChaosFailureType[];
}

export type ChaosFailureType =
  | 'crash'           // Simulate process crash (throw error)
  | 'timeout'         // Simulate timeout (delay then fail)
  | 'network'         // Simulate network error
  | 'oom'             // Simulate out of memory
  | 'rate_limit'      // Simulate API rate limit
  | 'partial';        // Simulate partial completion

interface ChaosState {
  successCount: number;
  failureCount: number;
  lastFailureType?: ChaosFailureType;
}

// Global state for tracking across executions
const chaosStates = new Map<string, ChaosState>();

/**
 * Chaos Engine - handles failure injection
 */
export class ChaosEngine {
  private config: ChaosConfig;
  private workflowId: string;

  constructor(workflowId: string, config: ChaosConfig) {
    this.workflowId = workflowId;
    this.config = config;

    if (!chaosStates.has(workflowId)) {
      chaosStates.set(workflowId, {
        successCount: 0,
        failureCount: 0,
      });
    }
  }

  /**
   * Check if chaos should trigger at this point
   */
  shouldFail(context: {
    checkpointName?: string;
    taskType?: string;
  }): boolean {
    if (!this.config.enabled) return false;

    // Check if targeting specific task types
    if (this.config.targetTaskTypes?.length) {
      if (!context.taskType || !this.config.targetTaskTypes.includes(context.taskType)) {
        return false;
      }
    }

    // Check fail at specific checkpoints
    if (context.checkpointName && this.config.failAtCheckpoints?.includes(context.checkpointName)) {
      return true;
    }

    // Check fail after N successes
    const state = chaosStates.get(this.workflowId)!;
    if (this.config.failAfterSuccesses !== undefined) {
      if (state.successCount >= this.config.failAfterSuccesses) {
        return true;
      }
    }

    // Random failure rate
    if (this.config.failureRate !== undefined) {
      return Math.random() < this.config.failureRate;
    }

    return false;
  }

  /**
   * Get the type of failure to inject
   */
  getFailureType(): ChaosFailureType {
    const types = this.config.failureTypes || ['crash'];
    return types[Math.floor(Math.random() * types.length)];
  }

  /**
   * Get random latency to inject
   */
  getLatency(): number {
    if (!this.config.latencyMs) return 0;
    const { min, max } = this.config.latencyMs;
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * Inject failure based on type
   */
  async injectFailure(type: ChaosFailureType): Promise<never> {
    const state = chaosStates.get(this.workflowId)!;
    state.failureCount++;
    state.lastFailureType = type;

    switch (type) {
      case 'crash':
        throw new ChaosError('CHAOS: Simulated process crash', type);

      case 'timeout':
        await new Promise(resolve => setTimeout(resolve, 30000));
        throw new ChaosError('CHAOS: Simulated timeout', type);

      case 'network':
        throw new ChaosError('CHAOS: Simulated network error - ECONNREFUSED', type);

      case 'oom':
        throw new ChaosError('CHAOS: Simulated out of memory - JavaScript heap out of memory', type);

      case 'rate_limit':
        throw new ChaosError('CHAOS: Simulated rate limit - 429 Too Many Requests', type);

      case 'partial':
        throw new ChaosError('CHAOS: Simulated partial completion - task interrupted', type);

      default:
        throw new ChaosError('CHAOS: Unknown failure type', 'crash');
    }
  }

  /**
   * Inject latency if configured
   */
  async injectLatency(): Promise<void> {
    if (!this.config.enabled) return;

    const latency = this.getLatency();
    if (latency > 0) {
      await new Promise(resolve => setTimeout(resolve, latency));
    }
  }

  /**
   * Record successful execution
   */
  recordSuccess(): void {
    const state = chaosStates.get(this.workflowId)!;
    state.successCount++;
  }

  /**
   * Get current chaos state
   */
  getState(): ChaosState {
    return { ...chaosStates.get(this.workflowId)! };
  }

  /**
   * Reset chaos state
   */
  reset(): void {
    chaosStates.set(this.workflowId, {
      successCount: 0,
      failureCount: 0,
    });
  }
}

/**
 * Custom error for chaos-induced failures
 */
export class ChaosError extends Error {
  readonly isChaos = true;
  readonly failureType: ChaosFailureType;

  constructor(message: string, failureType: ChaosFailureType) {
    super(message);
    this.name = 'ChaosError';
    this.failureType = failureType;
  }
}

/**
 * Create a chaos-wrapped checkpoint function
 */
export function createChaosCheckpoint(
  originalCheckpoint: (state?: Record<string, unknown>) => Promise<void>,
  engine: ChaosEngine
): (name: string, state?: Record<string, unknown>) => Promise<void> {
  return async (name: string, state?: Record<string, unknown>) => {
    // Inject latency before checkpoint
    await engine.injectLatency();

    // Check if we should fail at this checkpoint
    if (engine.shouldFail({ checkpointName: name })) {
      const failureType = engine.getFailureType();
      await engine.injectFailure(failureType);
    }

    // Execute original checkpoint
    await originalCheckpoint(state);
  };
}

/**
 * Chaos middleware for step handlers
 */
export function withChaos<T>(
  handler: () => Promise<T>,
  engine: ChaosEngine,
  taskType?: string
): () => Promise<T> {
  return async () => {
    // Inject pre-execution latency
    await engine.injectLatency();

    // Check for pre-execution failure
    if (engine.shouldFail({ taskType })) {
      const failureType = engine.getFailureType();
      await engine.injectFailure(failureType);
    }

    // Execute handler
    const result = await handler();

    // Record success
    engine.recordSuccess();

    // Post-execution latency
    await engine.injectLatency();

    return result;
  };
}

/**
 * Utility to enable chaos mode via environment variable
 */
export function isChaosEnabled(): boolean {
  return process.env.CHAOS_MODE === 'true' || process.env.X404R_CHAOS === 'true';
}

/**
 * Default chaos config for testing
 */
export const DEFAULT_CHAOS_CONFIG: ChaosConfig = {
  enabled: isChaosEnabled(),
  failureRate: 0.1,
  latencyMs: { min: 50, max: 500 },
  failureTypes: ['crash', 'network', 'timeout'],
};

/**
 * Aggressive chaos config for stress testing
 */
export const STRESS_CHAOS_CONFIG: ChaosConfig = {
  enabled: true,
  failureRate: 0.5,
  latencyMs: { min: 100, max: 2000 },
  failureTypes: ['crash', 'network', 'timeout', 'oom', 'rate_limit'],
};
