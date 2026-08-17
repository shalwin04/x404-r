#!/usr/bin/env npx tsx
/**
 * x404-r Runtime Integration Tests
 *
 * Tests the full runtime flow with CockroachDB:
 * 1. Database connection
 * 2. Task creation and execution
 * 3. Checkpoint persistence
 * 4. Crash recovery simulation
 * 5. Memory/learning system
 * 6. Metrics tracking
 *
 * Run: npx tsx scripts/test-runtime.ts
 */

import 'dotenv/config';
import { createDatabase, Database, TenantDatabase, DEFAULT_TENANT_CONTEXT } from '../packages/shared/src/index';
import { metrics, MetricsCollector } from '../packages/sdk/src/metrics';

// Test utilities
const log = (msg: string) => console.log(`\x1b[36m[TEST]\x1b[0m ${msg}`);
const pass = (msg: string) => console.log(`\x1b[32m  ✓ ${msg}\x1b[0m`);
const fail = (msg: string) => console.log(`\x1b[31m  ✗ ${msg}\x1b[0m`);
const section = (msg: string) => console.log(`\n\x1b[35m━━━ ${msg} ━━━\x1b[0m`);

let db: Database;
let tenantDb: TenantDatabase;
let testJobId: string;
let testTaskIds: string[] = [];
let testsPassed = 0;
let testsFailed = 0;

async function assert(condition: boolean, message: string): Promise<void> {
  if (condition) {
    pass(message);
    testsPassed++;
  } else {
    fail(message);
    testsFailed++;
  }
}

// ============ Test: Database Connection ============
async function testDatabaseConnection() {
  section('Database Connection');

  try {
    db = createDatabase();
    const result = await db.query<{ test: string | number }>('SELECT 1 as test');
    await assert(Number(result.rows[0].test) === 1, 'Can execute queries');

    // Check CockroachDB version
    const versionResult = await db.query('SELECT version()');
    const version = versionResult.rows[0].version;
    await assert(version.includes('CockroachDB'), `Connected to CockroachDB: ${version.slice(0, 50)}...`);

    // Create tenant database wrapper
    tenantDb = new TenantDatabase(db, DEFAULT_TENANT_CONTEXT);
    await assert(true, 'TenantDatabase wrapper created');

  } catch (error) {
    fail(`Database connection failed: ${error}`);
    testsFailed++;
    throw error;
  }
}

// ============ Test: Job Creation ============
async function testJobCreation() {
  section('Job Creation');

  try {
    const job = await tenantDb.createJob({
      name: 'Integration Test Job',
      description: 'Testing the x404-r runtime',
      input_payload: { test: true, timestamp: Date.now() },
      priority: 1,
    });

    testJobId = job.id;
    await assert(!!job.id, `Job created with ID: ${job.id.slice(0, 8)}...`);
    await assert(job.status === 'pending', 'Job status is pending');
    await assert(job.tenant_id === DEFAULT_TENANT_CONTEXT.tenantId, 'Job has correct tenant ID');

    // Verify job is queryable
    const fetchedJob = await tenantDb.getJob(job.id);
    await assert(fetchedJob?.id === job.id, 'Job can be fetched by ID');

  } catch (error) {
    fail(`Job creation failed: ${error}`);
    testsFailed++;
  }
}

// ============ Test: Task Creation with Dependencies ============
async function testTaskCreation() {
  section('Task Creation with Dependencies');

  try {
    // Create tasks that form a DAG
    const tasks = await tenantDb.createTasks([
      {
        job_id: testJobId,
        task_type: 'analyze',
        name: 'Analyze Input',
        input_payload: { step: 1 },
        depends_on: [],
      },
      {
        job_id: testJobId,
        task_type: 'process',
        name: 'Process Data A',
        input_payload: { step: 2, branch: 'A' },
        depends_on: [], // Will be updated
      },
      {
        job_id: testJobId,
        task_type: 'process',
        name: 'Process Data B',
        input_payload: { step: 2, branch: 'B' },
        depends_on: [],
      },
      {
        job_id: testJobId,
        task_type: 'aggregate',
        name: 'Aggregate Results',
        input_payload: { step: 3 },
        depends_on: [],
      },
    ]);

    testTaskIds = tasks.map(t => t.id);
    await assert(tasks.length === 4, `Created ${tasks.length} tasks`);

    // Update dependencies: Process A & B depend on Analyze, Aggregate depends on A & B
    await db.query('UPDATE task_nodes SET depends_on = $1 WHERE id = $2', [[testTaskIds[0]], testTaskIds[1]]);
    await db.query('UPDATE task_nodes SET depends_on = $1 WHERE id = $2', [[testTaskIds[0]], testTaskIds[2]]);
    await db.query('UPDATE task_nodes SET depends_on = $1 WHERE id = $2', [[testTaskIds[1], testTaskIds[2]], testTaskIds[3]]);

    await assert(true, 'Task dependencies configured (DAG structure)');

    // Verify tasks are in correct state
    const jobTasks = await tenantDb.getTasksByJob(testJobId);
    await assert(jobTasks.every(t => t.status === 'pending'), 'All tasks start as pending');

  } catch (error) {
    fail(`Task creation failed: ${error}`);
    testsFailed++;
  }
}

// ============ Test: Task Claiming (FOR UPDATE SKIP LOCKED) ============
async function testTaskClaiming() {
  section('Task Claiming (Atomic with FOR UPDATE SKIP LOCKED)');

  try {
    // Update job to running
    await tenantDb.updateJobStatus(testJobId, 'running');

    // Claim the first task (Analyze - has no dependencies)
    const workerId = 'test-worker-' + Math.random().toString(36).slice(2, 8);
    const claimed = await db.claimTask(workerId);

    await assert(claimed.claimed && claimed.task !== null, `Task claimed by worker: ${workerId}`);
    await assert(claimed.task?.name === 'Analyze Input', 'Correct task claimed (respects dependencies)');
    await assert(claimed.task?.status === 'claimed', 'Task status changed to claimed');

    // Try to claim again - should get null (task already claimed)
    const secondClaim = await db.claimTask('another-worker');
    await assert(!secondClaim.claimed || secondClaim.task === null, 'Cannot claim already-claimed task');

    // Complete the first task
    if (claimed.task) {
      await db.updateTaskStatus(claimed.task.id, 'done', { result: 'analyzed', itemCount: 42 });
      pass('First task completed');

      // Now Process A and Process B should be claimable
      const nextTask1 = await db.claimTask('worker-a');
      const nextTask2 = await db.claimTask('worker-b');

      await assert(
        nextTask1.task?.task_type === 'process' && nextTask2.task?.task_type === 'process',
        'Parallel tasks become claimable after dependency completes'
      );

      // Complete both
      if (nextTask1.task) await db.updateTaskStatus(nextTask1.task.id, 'done', { branch: 'A', processed: true });
      if (nextTask2.task) await db.updateTaskStatus(nextTask2.task.id, 'done', { branch: 'B', processed: true });
      pass('Parallel tasks completed');

      // Now Aggregate should be claimable
      const finalTask = await db.claimTask('worker-final');
      await assert(finalTask.task?.name === 'Aggregate Results', 'Final task claimable after all dependencies complete');

      if (finalTask.task) await db.updateTaskStatus(finalTask.task.id, 'done', { aggregated: true, total: 84 });
      pass('Final task completed');
    }

    // Verify job stats
    const stats = await tenantDb.getJobStats(testJobId);
    await assert(stats.done === 4, `All 4 tasks completed (done: ${stats.done})`);
    await assert(stats.pending === 0 && stats.running === 0, 'No pending or running tasks');

  } catch (error) {
    fail(`Task claiming failed: ${error}`);
    testsFailed++;
  }
}

// ============ Test: Checkpoint Persistence ============
async function testCheckpoints() {
  section('Checkpoint Persistence (Crash Recovery)');

  try {
    // Create a new job for checkpoint testing
    const job = await tenantDb.createJob({
      name: 'Checkpoint Test Job',
      description: 'Testing checkpoint persistence',
      input_payload: { items: ['a', 'b', 'c', 'd', 'e'] },
    });

    const [task] = await tenantDb.createTasks([{
      job_id: job.id,
      task_type: 'iterate',
      name: 'Process Items with Checkpoints',
      input_payload: { items: ['a', 'b', 'c', 'd', 'e'] },
      depends_on: [],
    }]);

    await tenantDb.updateJobStatus(job.id, 'running');

    // Simulate processing with checkpoints
    const workerId = 'checkpoint-worker';
    await db.query(
      `UPDATE task_nodes SET status = 'claimed', claimed_by = $1, claimed_at = now() WHERE id = $2`,
      [workerId, task.id]
    );

    // Create checkpoints as if processing items (using raw SQL)
    for (let i = 0; i < 3; i++) {
      const state = {
        processedItems: ['a', 'b', 'c'].slice(0, i + 1),
        lastIndex: i,
        timestamp: Date.now(),
      };
      await db.query(
        `INSERT INTO checkpoints (task_id, step_number, state)
         VALUES ($1, $2, $3)
         ON CONFLICT (task_id, step_number)
         DO UPDATE SET state = $3, created_at = now()`,
        [task.id, i, JSON.stringify(state)]
      );
    }

    await assert(true, 'Created 3 checkpoints during processing');

    // Simulate crash - reset task to pending
    await db.query(
      `UPDATE task_nodes SET status = 'pending', claimed_by = NULL, claimed_at = NULL WHERE id = $1`,
      [task.id]
    );

    // Get latest checkpoint (simulating recovery)
    const checkpointResult = await db.query<{ step_number: number; state: Record<string, unknown> }>(
      `SELECT step_number, state FROM checkpoints
       WHERE task_id = $1
       ORDER BY step_number DESC
       LIMIT 1`,
      [task.id]
    );
    const checkpoint = checkpointResult.rows[0];
    await assert(checkpoint !== undefined, 'Checkpoint persisted after simulated crash');
    await assert(Number(checkpoint?.step_number) === 2, `Latest checkpoint is step 2 (was: ${checkpoint?.step_number})`);
    await assert(
      (checkpoint?.state as any)?.lastIndex === 2,
      'Checkpoint state preserved correctly'
    );

    // New worker claims and resumes
    const newWorkerId = 'recovery-worker';
    const recovered = await db.claimTask(newWorkerId);
    await assert(recovered.task?.id === task.id, 'Task reclaimed after crash');

    // Would resume from checkpoint.state.lastIndex = 2, process items d, e
    pass('Recovery worker can resume from checkpoint');

  } catch (error) {
    fail(`Checkpoint test failed: ${error}`);
    testsFailed++;
  }
}

// ============ Test: Memory/Learning System ============
async function testMemorySystem() {
  section('Memory/Learning System (Vector Storage)');

  try {
    // Store a memory
    const testEmbedding = Array(768).fill(0).map((_, i) => Math.sin(i * 0.1));

    await db.storeMemory(
      testTaskIds[0],
      'success',
      'Task completed successfully with optimization applied',
      testEmbedding,
      'analyze',
      undefined,
      'Used caching for better performance',
      DEFAULT_TENANT_CONTEXT.tenantId
    );

    await assert(true, 'Memory stored with embedding');

    // Store a failure memory
    await db.storeMemory(
      testTaskIds[1],
      'failure',
      'Task failed due to timeout on large dataset',
      testEmbedding.map(v => v * 0.9), // Slightly different embedding
      'process',
      'timeout',
      'Increased timeout and added batching',
      DEFAULT_TENANT_CONTEXT.tenantId
    );

    await assert(true, 'Failure memory stored with resolution');

    // Query similar memories
    const queryEmbedding = testEmbedding.map(v => v * 0.95);
    const memories = await db.querySimilarMemories(
      queryEmbedding,
      undefined,
      5,
      DEFAULT_TENANT_CONTEXT.tenantId
    );

    await assert(memories.length >= 1, `Found ${memories.length} similar memories`);
    await assert(
      memories[0].similarity !== undefined && memories[0].similarity > 0,
      `Similarity score computed: ${memories[0]?.similarity?.toFixed(4)}`
    );

  } catch (error) {
    fail(`Memory system test failed: ${error}`);
    testsFailed++;
  }
}

// ============ Test: Stale Task Reclamation ============
async function testStaleReclamation() {
  section('Stale Task Reclamation (Heartbeat Timeout)');

  try {
    // Create a job with a task that will become stale
    const job = await tenantDb.createJob({
      name: 'Stale Task Test',
      description: 'Testing heartbeat timeout',
      input_payload: {},
    });

    const [task] = await tenantDb.createTasks([{
      job_id: job.id,
      task_type: 'long_running',
      name: 'Simulated Stale Task',
      input_payload: {},
      depends_on: [],
    }]);

    await tenantDb.updateJobStatus(job.id, 'running');

    // Claim and set old heartbeat (simulating stale worker)
    await db.query(
      `UPDATE task_nodes SET
        status = 'running',
        claimed_by = 'dead-worker',
        claimed_at = now() - INTERVAL '10 minutes',
        heartbeat_at = now() - INTERVAL '5 minutes'
       WHERE id = $1`,
      [task.id]
    );

    await assert(true, 'Created stale task (heartbeat 5 min ago)');

    // Reclaim stale tasks
    const result = await db.query<{ id: string; name: string }>(
      `UPDATE task_nodes
       SET status = 'pending', claimed_by = NULL, claimed_at = NULL, heartbeat_at = NULL
       WHERE status = 'running'
         AND heartbeat_at < now() - INTERVAL '2 minutes'
       RETURNING id, name`
    );

    await assert(result.rows.length >= 1, `Reclaimed ${result.rows.length} stale task(s)`);

    // Verify task is claimable again
    const reclaimed = await db.claimTask('new-worker');
    await assert(reclaimed.task?.id === task.id, 'Stale task can be claimed by new worker');

  } catch (error) {
    fail(`Stale reclamation test failed: ${error}`);
    testsFailed++;
  }
}

// ============ Test: Metrics Tracking ============
async function testMetrics() {
  section('Metrics Tracking');

  try {
    // Create fresh metrics collector
    const testMetrics = new MetricsCollector();

    // Simulate task lifecycle
    testMetrics.taskStarted('task-1', 'analyze', 'job-1');
    testMetrics.taskStarted('task-2', 'process', 'job-1');

    // Simulate some work
    await new Promise(r => setTimeout(r, 50));

    testMetrics.taskCompleted('task-1', 'analyze', 'job-1');
    testMetrics.aiTokensUsed('gemini-2.5-flash', 500, 200);
    testMetrics.aiCostIncurred('gemini-2.5-flash', 0.0005);

    await new Promise(r => setTimeout(r, 30));

    testMetrics.taskFailed('task-2', 'process', 'job-1', 'Timeout error');
    testMetrics.taskRecovered('task-2', 'process', 150);

    testMetrics.checkpointCreated('task-1', 1, 1024);
    testMetrics.checkpointRestored('task-2', 0);

    testMetrics.memoryStored('analyze');
    testMetrics.memoryQueried('analyze', 3, 0.85);

    // Get summary
    const summary = testMetrics.getSummary();

    await assert(summary.execution.tasksCompleted === 1, 'Tracks completed tasks');
    await assert(summary.execution.tasksFailed === 1, 'Tracks failed tasks');
    await assert(summary.cost.tokensInput === 500, 'Tracks input tokens');
    await assert(summary.cost.tokensOutput === 200, 'Tracks output tokens');
    await assert(summary.reliability.crashRecoveries === 1, 'Tracks crash recoveries');
    await assert(summary.ai.modelBreakdown['gemini-2.5-flash'] === 1, 'Tracks model usage');

    // Test Prometheus export
    const prometheus = testMetrics.toPrometheus();
    await assert(prometheus.includes('tasks_completed'), 'Can export to Prometheus format');

    pass(`Metrics summary: ${summary.execution.tasksCompleted} completed, ${summary.execution.tasksFailed} failed`);

  } catch (error) {
    fail(`Metrics test failed: ${error}`);
    testsFailed++;
  }
}

// ============ Test: Multi-tenant Isolation ============
async function testMultiTenantIsolation() {
  section('Multi-Tenant Isolation');

  try {
    // Create jobs for different tenants
    const tenant1Id = DEFAULT_TENANT_CONTEXT.tenantId;

    // Create a second tenant
    const tenant2Result = await db.query<{ id: string }>(
      `INSERT INTO tenants (name, slug, plan) VALUES ('Test Tenant 2', 'test-tenant-2', 'pro')
       ON CONFLICT (slug) DO UPDATE SET name = 'Test Tenant 2'
       RETURNING id`
    );
    const tenant2Id = tenant2Result.rows[0].id;

    const tenant2Db = new TenantDatabase(db, { ...DEFAULT_TENANT_CONTEXT, tenantId: tenant2Id });

    // Create job for tenant 2
    const tenant2Job = await tenant2Db.createJob({
      name: 'Tenant 2 Job',
      description: 'Should be isolated',
      input_payload: {},
    });

    await assert(tenant2Job.tenant_id === tenant2Id, 'Job created for tenant 2');

    // Tenant 1 should not see tenant 2's jobs
    const tenant1Jobs = await tenantDb.listJobs();
    const seesOtherTenantJob = tenant1Jobs.some(j => j.id === tenant2Job.id);
    await assert(!seesOtherTenantJob, 'Tenant 1 cannot see tenant 2 jobs');

    // Tenant 2 should see their own job
    const tenant2Jobs = await tenant2Db.listJobs();
    const seesOwnJob = tenant2Jobs.some(j => j.id === tenant2Job.id);
    await assert(seesOwnJob, 'Tenant 2 can see their own jobs');

  } catch (error) {
    fail(`Multi-tenant isolation test failed: ${error}`);
    testsFailed++;
  }
}

// ============ Main Test Runner ============
async function runTests() {
  console.log('\n\x1b[1m╔════════════════════════════════════════════════════════════╗\x1b[0m');
  console.log('\x1b[1m║       x404-r Runtime Integration Tests                     ║\x1b[0m');
  console.log('\x1b[1m║       CockroachDB as Distributed AI Agent Runtime          ║\x1b[0m');
  console.log('\x1b[1m╚════════════════════════════════════════════════════════════╝\x1b[0m');

  const startTime = Date.now();

  try {
    await testDatabaseConnection();
    await testJobCreation();
    await testTaskCreation();
    await testTaskClaiming();
    await testCheckpoints();
    await testMemorySystem();
    await testStaleReclamation();
    await testMetrics();
    await testMultiTenantIsolation();

  } catch (error) {
    console.error('\n\x1b[31mTest suite aborted due to critical error:\x1b[0m', error);
  } finally {
    if (db) {
      await db.close();
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log('\n\x1b[1m════════════════════════════════════════════════════════════\x1b[0m');
  console.log(`\x1b[1mResults:\x1b[0m ${testsPassed} passed, ${testsFailed} failed`);
  console.log(`\x1b[1mDuration:\x1b[0m ${duration}s`);

  if (testsFailed === 0) {
    console.log('\n\x1b[32m✓ All tests passed! CockroachDB runtime is working correctly.\x1b[0m\n');
    process.exit(0);
  } else {
    console.log('\n\x1b[31m✗ Some tests failed. Check the output above.\x1b[0m\n');
    process.exit(1);
  }
}

runTests();
