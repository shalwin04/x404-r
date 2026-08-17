/**
 * x404-r Metrics & Observability
 *
 * Real-world production metrics for AI agent monitoring
 * Supports hybrid mode: in-memory tracking + database persistence
 */

import type { Pool } from 'pg';

/**
 * Database configuration for metrics persistence
 */
export interface MetricsDatabaseConfig {
  pool: Pool;
  tenantId: string;
  flushIntervalMs?: number; // Default: 30000 (30 seconds)
  enabled?: boolean;
}

export interface MetricEvent {
  name: string;
  value: number;
  timestamp: Date;
  tags: Record<string, string>;
  type: 'counter' | 'gauge' | 'histogram' | 'timer';
}

export interface MetricsSummary {
  execution: ExecutionMetrics;
  cost: CostMetrics;
  performance: PerformanceMetrics;
  reliability: ReliabilityMetrics;
  ai: AIMetrics;
  memory: MemoryMetrics;
}

export interface ExecutionMetrics {
  tasksTotal: number;
  tasksCompleted: number;
  tasksFailed: number;
  tasksPending: number;
  tasksRunning: number;
  successRate: number;
  throughput: number; // tasks per minute
  queueDepth: number;
  activeWorkers: number;
}

export interface CostMetrics {
  totalCostUsd: number;
  costPerTask: number;
  costPerWorkflow: number;
  tokensInput: number;
  tokensOutput: number;
  tokensTotal: number;
  savingsFromCheckpoints: number;
  projectedMonthlyCost: number;
}

export interface PerformanceMetrics {
  latencyP50Ms: number;
  latencyP95Ms: number;
  latencyP99Ms: number;
  latencyAvgMs: number;
  throughputPerMinute: number;
  checkpointLatencyMs: number;
  aiLatencyMs: number;
}

export interface ReliabilityMetrics {
  uptimePercent: number;
  mtbfMinutes: number; // Mean Time Between Failures
  mttrSeconds: number; // Mean Time To Recovery
  crashRecoveries: number;
  checkpointHitRate: number;
  failedRecoveries: number;
}

export interface AIMetrics {
  totalGenerations: number;
  modelBreakdown: Record<string, number>;
  avgTokensPerGeneration: number;
  contextUtilization: number; // % of context window used
  cacheHitRate: number;
  streamingRatio: number;
}

export interface MemoryMetrics {
  vectorCount: number;
  avgRetrievalRelevance: number;
  memoryHitRate: number;
  learningImprovement: number; // % improvement from memory
}

/**
 * Histogram for tracking distributions
 */
export class Histogram {
  private values: number[] = [];
  private maxSize: number;

  constructor(maxSize = 1000) {
    this.maxSize = maxSize;
  }

  record(value: number): void {
    this.values.push(value);
    if (this.values.length > this.maxSize) {
      this.values.shift();
    }
  }

  percentile(p: number): number {
    if (this.values.length === 0) return 0;
    const sorted = [...this.values].sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  average(): number {
    if (this.values.length === 0) return 0;
    return this.values.reduce((a, b) => a + b, 0) / this.values.length;
  }

  count(): number {
    return this.values.length;
  }

  reset(): void {
    this.values = [];
  }
}

/**
 * Rate calculator for throughput metrics
 */
export class RateCalculator {
  private events: number[] = [];
  private windowMs: number;

  constructor(windowMs = 60000) {
    this.windowMs = windowMs;
  }

  record(): void {
    this.events.push(Date.now());
    this.cleanup();
  }

  rate(): number {
    this.cleanup();
    return this.events.length;
  }

  private cleanup(): void {
    const cutoff = Date.now() - this.windowMs;
    this.events = this.events.filter(t => t > cutoff);
  }
}

/**
 * Main metrics collector
 * Supports in-memory tracking with optional database persistence
 */
export class MetricsCollector {
  private counters: Map<string, number> = new Map();
  private gauges: Map<string, number> = new Map();
  private histograms: Map<string, Histogram> = new Map();
  private rates: Map<string, RateCalculator> = new Map();
  private events: MetricEvent[] = [];
  private maxEvents: number;
  private listeners: Array<(event: MetricEvent) => void> = [];

  // Timing state
  private taskStartTimes: Map<string, number> = new Map();
  private lastFailureTime: number = 0;
  private failureCount: number = 0;
  private recoveryTimes: number[] = [];

  // Database persistence
  private dbConfig: MetricsDatabaseConfig | null = null;
  private flushInterval: NodeJS.Timeout | null = null;
  private lastFlushTime: number = 0;
  private flushInProgress: boolean = false;

  constructor(maxEvents = 10000) {
    this.maxEvents = maxEvents;

    // Initialize default histograms
    this.histograms.set('task.latency', new Histogram());
    this.histograms.set('ai.latency', new Histogram());
    this.histograms.set('checkpoint.latency', new Histogram());
    this.histograms.set('recovery.time', new Histogram());

    // Initialize default rates
    this.rates.set('tasks.completed', new RateCalculator());
    this.rates.set('tasks.failed', new RateCalculator());
    this.rates.set('ai.generations', new RateCalculator());
  }

  /**
   * Subscribe to metric events
   */
  subscribe(listener: (event: MetricEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index > -1) this.listeners.splice(index, 1);
    };
  }

  /**
   * Emit a metric event
   */
  private emit(event: MetricEvent): void {
    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  // ============ Counter Operations ============

  increment(name: string, value = 1, tags: Record<string, string> = {}): void {
    const current = this.counters.get(name) || 0;
    this.counters.set(name, current + value);
    this.emit({
      name,
      value: current + value,
      timestamp: new Date(),
      tags,
      type: 'counter',
    });
  }

  // ============ Gauge Operations ============

  gauge(name: string, value: number, tags: Record<string, string> = {}): void {
    this.gauges.set(name, value);
    this.emit({
      name,
      value,
      timestamp: new Date(),
      tags,
      type: 'gauge',
    });
  }

  // ============ Histogram Operations ============

  recordHistogram(name: string, value: number, tags: Record<string, string> = {}): void {
    let histogram = this.histograms.get(name);
    if (!histogram) {
      histogram = new Histogram();
      this.histograms.set(name, histogram);
    }
    histogram.record(value);
    this.emit({
      name,
      value,
      timestamp: new Date(),
      tags,
      type: 'histogram',
    });
  }

  // ============ Timer Operations ============

  startTimer(name: string): () => number {
    const start = performance.now();
    return () => {
      const duration = performance.now() - start;
      this.recordHistogram(name, duration);
      return duration;
    };
  }

  // ============ Task Lifecycle ============

  taskStarted(taskId: string, taskType: string, workflowId: string): void {
    this.taskStartTimes.set(taskId, Date.now());
    this.increment('tasks.started', 1, { taskType, workflowId });
    this.gauge('tasks.running', (this.gauges.get('tasks.running') || 0) + 1);
  }

  taskCompleted(taskId: string, taskType: string, workflowId: string): void {
    const startTime = this.taskStartTimes.get(taskId);
    if (startTime) {
      const duration = Date.now() - startTime;
      this.recordHistogram('task.latency', duration, { taskType });
      this.taskStartTimes.delete(taskId);
    }

    this.increment('tasks.completed', 1, { taskType, workflowId });
    this.rates.get('tasks.completed')?.record();
    this.gauge('tasks.running', Math.max(0, (this.gauges.get('tasks.running') || 0) - 1));
  }

  taskFailed(taskId: string, taskType: string, workflowId: string, error: string): void {
    const startTime = this.taskStartTimes.get(taskId);
    if (startTime) {
      this.taskStartTimes.delete(taskId);
    }

    this.increment('tasks.failed', 1, { taskType, workflowId, error: error.slice(0, 50) });
    this.rates.get('tasks.failed')?.record();
    this.gauge('tasks.running', Math.max(0, (this.gauges.get('tasks.running') || 0) - 1));

    // Track failure timing for MTBF
    const now = Date.now();
    if (this.lastFailureTime > 0) {
      const timeBetweenFailures = now - this.lastFailureTime;
      this.recordHistogram('failure.interval', timeBetweenFailures);
    }
    this.lastFailureTime = now;
    this.failureCount++;
  }

  taskRecovered(taskId: string, taskType: string, recoveryTimeMs: number): void {
    this.increment('tasks.recovered', 1, { taskType });
    this.recordHistogram('recovery.time', recoveryTimeMs);
    this.recoveryTimes.push(recoveryTimeMs);
  }

  // ============ Checkpoint Lifecycle ============

  checkpointCreated(taskId: string, stepNumber: number, dataSize: number): void {
    this.increment('checkpoints.created', 1);
    this.recordHistogram('checkpoint.size', dataSize);
  }

  checkpointRestored(taskId: string, stepNumber: number): void {
    this.increment('checkpoints.restored', 1);
  }

  // ============ AI Operations ============

  aiGenerationStarted(model: string): () => void {
    const stopTimer = this.startTimer('ai.latency');
    return () => {
      stopTimer();
      this.increment('ai.generations', 1, { model });
      this.rates.get('ai.generations')?.record();
    };
  }

  aiTokensUsed(model: string, input: number, output: number): void {
    this.increment('ai.tokens.input', input, { model });
    this.increment('ai.tokens.output', output, { model });
    this.increment('ai.tokens.total', input + output, { model });

    // Track model breakdown
    const modelKey = `ai.model.${model}`;
    this.increment(modelKey, 1);
  }

  aiCostIncurred(model: string, costUsd: number): void {
    this.increment('ai.cost.total', costUsd * 10000, { model }); // Store in 0.0001 USD units
  }

  // ============ Memory Operations ============

  memoryStored(taskType: string): void {
    this.increment('memory.stored', 1, { taskType });
  }

  memoryQueried(taskType: string, resultsCount: number, relevanceScore: number): void {
    this.increment('memory.queries', 1, { taskType });
    this.recordHistogram('memory.results', resultsCount);
    this.recordHistogram('memory.relevance', relevanceScore * 100);
  }

  // ============ Aggregation ============

  getSummary(): MetricsSummary {
    const tasksCompleted = this.counters.get('tasks.completed') || 0;
    const tasksFailed = this.counters.get('tasks.failed') || 0;
    const tasksTotal = tasksCompleted + tasksFailed + (this.counters.get('tasks.started') || 0);

    const taskLatency = this.histograms.get('task.latency');
    const aiLatency = this.histograms.get('ai.latency');
    const checkpointLatency = this.histograms.get('checkpoint.latency');
    const recoveryTime = this.histograms.get('recovery.time');

    const tokensInput = this.counters.get('ai.tokens.input') || 0;
    const tokensOutput = this.counters.get('ai.tokens.output') || 0;
    const totalCost = (this.counters.get('ai.cost.total') || 0) / 10000;

    const checkpointsCreated = this.counters.get('checkpoints.created') || 0;
    const checkpointsRestored = this.counters.get('checkpoints.restored') || 0;

    const memoryStored = this.counters.get('memory.stored') || 0;
    const memoryRelevance = this.histograms.get('memory.relevance');

    // Calculate model breakdown
    const modelBreakdown: Record<string, number> = {};
    for (const [key, value] of this.counters.entries()) {
      if (key.startsWith('ai.model.')) {
        const model = key.replace('ai.model.', '');
        modelBreakdown[model] = value;
      }
    }

    const completedRate = this.rates.get('tasks.completed');
    const throughput = completedRate?.rate() || 0;

    return {
      execution: {
        tasksTotal,
        tasksCompleted,
        tasksFailed,
        tasksPending: this.gauges.get('tasks.pending') || 0,
        tasksRunning: this.gauges.get('tasks.running') || 0,
        successRate: tasksTotal > 0 ? (tasksCompleted / tasksTotal) * 100 : 100,
        throughput,
        queueDepth: this.gauges.get('queue.depth') || 0,
        activeWorkers: this.gauges.get('workers.active') || 0,
      },
      cost: {
        totalCostUsd: totalCost,
        costPerTask: tasksCompleted > 0 ? totalCost / tasksCompleted : 0,
        costPerWorkflow: totalCost, // Simplified
        tokensInput,
        tokensOutput,
        tokensTotal: tokensInput + tokensOutput,
        savingsFromCheckpoints: checkpointsRestored * 0.001, // Estimated savings
        projectedMonthlyCost: totalCost * 30 * 24, // Rough projection
      },
      performance: {
        latencyP50Ms: taskLatency?.percentile(50) || 0,
        latencyP95Ms: taskLatency?.percentile(95) || 0,
        latencyP99Ms: taskLatency?.percentile(99) || 0,
        latencyAvgMs: taskLatency?.average() || 0,
        throughputPerMinute: throughput,
        checkpointLatencyMs: checkpointLatency?.average() || 0,
        aiLatencyMs: aiLatency?.average() || 0,
      },
      reliability: {
        uptimePercent: 99.9, // Would need actual uptime tracking
        mtbfMinutes: this.failureCount > 1
          ? (Date.now() - this.lastFailureTime) / 60000 / this.failureCount
          : 999,
        mttrSeconds: recoveryTime?.average() ? recoveryTime.average() / 1000 : 0,
        crashRecoveries: this.counters.get('tasks.recovered') || 0,
        checkpointHitRate: checkpointsCreated > 0
          ? (checkpointsRestored / checkpointsCreated) * 100
          : 0,
        failedRecoveries: 0,
      },
      ai: {
        totalGenerations: this.counters.get('ai.generations') || 0,
        modelBreakdown,
        avgTokensPerGeneration: (this.counters.get('ai.generations') || 0) > 0
          ? (tokensInput + tokensOutput) / (this.counters.get('ai.generations') || 1)
          : 0,
        contextUtilization: 0.35, // Would need actual tracking
        cacheHitRate: 0,
        streamingRatio: 0,
      },
      memory: {
        vectorCount: memoryStored,
        avgRetrievalRelevance: memoryRelevance?.average() || 0,
        memoryHitRate: 0,
        learningImprovement: 0,
      },
    };
  }

  /**
   * Get recent events for streaming
   */
  getRecentEvents(limit = 100): MetricEvent[] {
    return this.events.slice(-limit);
  }

  /**
   * Export metrics in Prometheus format
   */
  toPrometheus(): string {
    const lines: string[] = [];

    for (const [name, value] of this.counters.entries()) {
      const metricName = name.replace(/\./g, '_');
      lines.push(`# TYPE ${metricName} counter`);
      lines.push(`${metricName} ${value}`);
    }

    for (const [name, value] of this.gauges.entries()) {
      const metricName = name.replace(/\./g, '_');
      lines.push(`# TYPE ${metricName} gauge`);
      lines.push(`${metricName} ${value}`);
    }

    for (const [name, histogram] of this.histograms.entries()) {
      const metricName = name.replace(/\./g, '_');
      lines.push(`# TYPE ${metricName} histogram`);
      lines.push(`${metricName}_p50 ${histogram.percentile(50)}`);
      lines.push(`${metricName}_p95 ${histogram.percentile(95)}`);
      lines.push(`${metricName}_p99 ${histogram.percentile(99)}`);
      lines.push(`${metricName}_avg ${histogram.average()}`);
      lines.push(`${metricName}_count ${histogram.count()}`);
    }

    return lines.join('\n');
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.events = [];
    for (const histogram of this.histograms.values()) {
      histogram.reset();
    }
  }

  // ============ Database Persistence ============

  /**
   * Configure database connection for metrics persistence
   * Call this to enable automatic flushing to CockroachDB
   */
  setDatabase(config: MetricsDatabaseConfig): void {
    this.dbConfig = config;

    // Start automatic flush interval
    if (config.enabled !== false) {
      const intervalMs = config.flushIntervalMs || 30000;
      this.startAutoFlush(intervalMs);
    }
  }

  /**
   * Start automatic periodic flushing
   */
  private startAutoFlush(intervalMs: number): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }

    this.flushInterval = setInterval(async () => {
      try {
        await this.flush('periodic');
      } catch (error) {
        console.error('[x404-r Metrics] Auto-flush failed:', error);
      }
    }, intervalMs);

    // Don't prevent process exit
    this.flushInterval.unref();
  }

  /**
   * Stop automatic flushing
   */
  stopAutoFlush(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
  }

  /**
   * Flush current metrics to the database
   * @param snapshotType - Type of snapshot: 'periodic', 'flush', 'shutdown'
   */
  async flush(snapshotType: 'periodic' | 'flush' | 'shutdown' = 'flush'): Promise<void> {
    if (!this.dbConfig) {
      return; // No database configured, skip
    }

    if (this.flushInProgress) {
      return; // Prevent concurrent flushes
    }

    this.flushInProgress = true;
    const now = Date.now();
    const periodSeconds = Math.round((now - (this.lastFlushTime || now)) / 1000);

    try {
      const summary = this.getSummary();

      await this.dbConfig.pool.query(
        `INSERT INTO metrics_snapshots (
          tenant_id, snapshot_type, period_seconds,
          tasks_total, tasks_completed, tasks_failed, tasks_pending, tasks_running,
          success_rate, throughput_per_min,
          total_cost_usd, tokens_input, tokens_output,
          latency_p50_ms, latency_p95_ms, latency_p99_ms, latency_avg_ms,
          ai_latency_ms, checkpoint_latency_ms,
          crash_recoveries, checkpoint_hit_rate,
          ai_generations, model_breakdown,
          memory_vectors_stored, avg_retrieval_relevance,
          full_snapshot
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)`,
        [
          this.dbConfig.tenantId,
          snapshotType,
          periodSeconds || 30,
          summary.execution.tasksTotal,
          summary.execution.tasksCompleted,
          summary.execution.tasksFailed,
          summary.execution.tasksPending,
          summary.execution.tasksRunning,
          summary.execution.successRate,
          summary.execution.throughput,
          summary.cost.totalCostUsd,
          summary.cost.tokensInput,
          summary.cost.tokensOutput,
          summary.performance.latencyP50Ms,
          summary.performance.latencyP95Ms,
          summary.performance.latencyP99Ms,
          summary.performance.latencyAvgMs,
          summary.performance.aiLatencyMs,
          summary.performance.checkpointLatencyMs,
          summary.reliability.crashRecoveries,
          summary.reliability.checkpointHitRate,
          summary.ai.totalGenerations,
          JSON.stringify(summary.ai.modelBreakdown),
          summary.memory.vectorCount,
          Math.min(summary.memory.avgRetrievalRelevance / 100, 1), // Normalize to 0-1 range
          JSON.stringify(summary),
        ]
      );

      this.lastFlushTime = now;
    } finally {
      this.flushInProgress = false;
    }
  }

  /**
   * Query historical metrics from database
   */
  async getHistory(options: {
    hours?: number;
    limit?: number;
  } = {}): Promise<MetricsSummary[]> {
    if (!this.dbConfig) {
      return [];
    }

    const hours = options.hours || 24;
    const limit = options.limit || 100;

    const result = await this.dbConfig.pool.query<{ full_snapshot: MetricsSummary }>(
      `SELECT full_snapshot FROM metrics_snapshots
       WHERE tenant_id = $1
         AND created_at > now() - INTERVAL '${hours} hours'
       ORDER BY created_at DESC
       LIMIT $2`,
      [this.dbConfig.tenantId, limit]
    );

    return result.rows.map(r => r.full_snapshot);
  }

  /**
   * Get aggregated hourly metrics
   */
  async getHourlyMetrics(hours = 24): Promise<Array<{
    hour: Date;
    avgTasksCompleted: number;
    avgTasksFailed: number;
    avgSuccessRate: number;
    totalCost: number;
    avgLatencyP50: number;
  }>> {
    if (!this.dbConfig) {
      return [];
    }

    const result = await this.dbConfig.pool.query<{
      hour: Date;
      avg_tasks_completed: number;
      avg_tasks_failed: number;
      avg_success_rate: number;
      total_cost: number;
      avg_latency_p50: number;
    }>(
      `SELECT
        date_trunc('hour', created_at) as hour,
        AVG(tasks_completed)::INT as avg_tasks_completed,
        AVG(tasks_failed)::INT as avg_tasks_failed,
        AVG(success_rate) as avg_success_rate,
        SUM(total_cost_usd) as total_cost,
        AVG(latency_p50_ms) as avg_latency_p50
       FROM metrics_snapshots
       WHERE tenant_id = $1
         AND created_at > now() - INTERVAL '${hours} hours'
       GROUP BY date_trunc('hour', created_at)
       ORDER BY hour DESC`,
      [this.dbConfig.tenantId]
    );

    return result.rows.map(r => ({
      hour: r.hour,
      avgTasksCompleted: r.avg_tasks_completed,
      avgTasksFailed: r.avg_tasks_failed,
      avgSuccessRate: Number(r.avg_success_rate),
      totalCost: Number(r.total_cost),
      avgLatencyP50: Number(r.avg_latency_p50),
    }));
  }

  /**
   * Graceful shutdown - flush final metrics
   */
  async shutdown(): Promise<void> {
    this.stopAutoFlush();
    await this.flush('shutdown');
  }

  /**
   * Check if database persistence is configured
   */
  isDatabaseEnabled(): boolean {
    return this.dbConfig !== null && this.dbConfig.enabled !== false;
  }
}

// Global metrics instance
export const metrics = new MetricsCollector();

/**
 * Decorator for automatic metrics collection
 */
export function observe(name: string) {
  return function <T extends (...args: unknown[]) => Promise<unknown>>(
    target: unknown,
    propertyKey: string,
    descriptor: TypedPropertyDescriptor<T>
  ): TypedPropertyDescriptor<T> {
    const original = descriptor.value!;

    descriptor.value = async function (this: unknown, ...args: unknown[]) {
      const stopTimer = metrics.startTimer(`${name}.duration`);
      metrics.increment(`${name}.calls`);

      try {
        const result = await original.apply(this, args);
        metrics.increment(`${name}.success`);
        return result;
      } catch (error) {
        metrics.increment(`${name}.errors`);
        throw error;
      } finally {
        stopTimer();
      }
    } as T;

    return descriptor;
  };
}

/**
 * Helper to wrap async functions with metrics
 */
export function withMetrics<T>(
  name: string,
  fn: () => Promise<T>,
  tags: Record<string, string> = {}
): Promise<T> {
  const stopTimer = metrics.startTimer(`${name}.duration`);
  metrics.increment(`${name}.calls`, 1, tags);

  return fn()
    .then((result) => {
      metrics.increment(`${name}.success`, 1, tags);
      return result;
    })
    .catch((error) => {
      metrics.increment(`${name}.errors`, 1, tags);
      throw error;
    })
    .finally(() => {
      stopTimer();
    });
}
