#!/usr/bin/env npx tsx
/**
 * Demo: SDK Metrics Flow to Dashboard
 *
 * Shows how SDK users can track metrics that flow to the dashboard:
 * 1. SDK collects metrics in-memory
 * 2. SDK periodically flushes to CockroachDB
 * 3. Dashboard queries historical metrics
 */

import 'dotenv/config';
import { Pool } from 'pg';
import { MetricsCollector } from '../packages/sdk/src/metrics.js';

const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000000';

async function main() {
  console.log('\n📊 x404-r SDK Metrics Flow Demo\n');
  console.log('=' .repeat(50));

  // 1. Create database connection
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  // 2. Create SDK metrics collector with database persistence
  const sdkMetrics = new MetricsCollector();

  // Configure database persistence (this is what SDK users would do)
  sdkMetrics.setDatabase({
    pool,
    tenantId: DEFAULT_TENANT_ID,
    flushIntervalMs: 5000, // Flush every 5 seconds for demo
    enabled: true,
  });

  console.log('\n✓ Metrics collector configured with database persistence');
  console.log('  - Tenant ID:', DEFAULT_TENANT_ID);
  console.log('  - Auto-flush interval: 5 seconds\n');

  // 3. Simulate SDK usage - tasks being processed
  console.log('📈 Simulating SDK task execution...\n');

  // Simulate some tasks
  for (let i = 1; i <= 5; i++) {
    const taskId = `demo-task-${i}`;
    const taskType = ['analyze', 'transform', 'validate'][i % 3];
    const workflowId = 'demo-workflow';

    // Task starts
    sdkMetrics.taskStarted(taskId, taskType, workflowId);
    console.log(`  → Task ${i} started (${taskType})`);

    // Simulate work
    await new Promise(r => setTimeout(r, 100 + Math.random() * 200));

    // Simulate AI usage
    const inputTokens = Math.floor(200 + Math.random() * 300);
    const outputTokens = Math.floor(50 + Math.random() * 150);
    sdkMetrics.aiTokensUsed('gemini-2.5-flash', inputTokens, outputTokens);
    sdkMetrics.aiCostIncurred('gemini-2.5-flash', (inputTokens * 0.000001 + outputTokens * 0.000002));

    // Task completes (or fails randomly)
    if (Math.random() > 0.2) {
      sdkMetrics.taskCompleted(taskId, taskType, workflowId);
      console.log(`  ✓ Task ${i} completed`);
    } else {
      sdkMetrics.taskFailed(taskId, taskType, workflowId, 'Simulated failure');
      console.log(`  ✗ Task ${i} failed (simulated)`);
    }

    // Simulate checkpoint
    sdkMetrics.checkpointCreated(taskId, i, 512);
  }

  // Simulate memory operations
  sdkMetrics.memoryStored('analyze');
  sdkMetrics.memoryQueried('analyze', 3, 0.87);

  // 4. Get in-memory summary
  console.log('\n📊 In-Memory Metrics Summary:');
  const summary = sdkMetrics.getSummary();
  console.log(`  Tasks: ${summary.execution.tasksCompleted} completed, ${summary.execution.tasksFailed} failed`);
  console.log(`  Success Rate: ${summary.execution.successRate.toFixed(1)}%`);
  console.log(`  AI Tokens: ${summary.cost.tokensTotal} total`);
  console.log(`  Cost: $${summary.cost.totalCostUsd.toFixed(6)}`);

  // 5. Manually flush to database
  console.log('\n💾 Flushing metrics to CockroachDB...');
  await sdkMetrics.flush('flush');
  console.log('  ✓ Metrics persisted to metrics_snapshots table');

  // 6. Query historical metrics
  console.log('\n📜 Querying historical metrics from database...');
  const history = await sdkMetrics.getHistory({ hours: 1, limit: 5 });
  console.log(`  Found ${history.length} snapshot(s)`);

  if (history.length > 0) {
    console.log('\n  Latest snapshot:');
    const latest = history[0];
    console.log(`    Tasks: ${latest.execution.tasksCompleted} completed`);
    console.log(`    Tokens: ${latest.cost.tokensTotal}`);
  }

  // 7. Cleanup
  sdkMetrics.stopAutoFlush();
  await pool.end();

  console.log('\n' + '='.repeat(50));
  console.log('✨ Demo complete! Check the dashboard at /monitor\n');
  console.log('The flow works like this:');
  console.log('  SDK (in-memory) → flush() → CockroachDB → Dashboard /metrics/history\n');
}

main().catch(console.error);
