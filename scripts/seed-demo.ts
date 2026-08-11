import { createDatabase } from '../packages/shared/src/db';
import { getDemoRefactoringTasks, createTasksFromDecomposition } from '../packages/supervisor/src/decompose';

async function seedDemo() {
  const db = createDatabase();

  try {
    console.log('Creating demo job...');

    // Create job
    const job = await db.createJob({
      name: 'Demo: Callback to Async/Await',
      description: 'Convert callback-based code to async/await syntax',
      input_payload: { type: 'demo', transformation: 'callback_to_async' },
    });

    console.log(`Created job: ${job.id}`);

    // Get demo decomposition
    const decomposition = getDemoRefactoringTasks();
    console.log(`Creating ${decomposition.tasks.length} tasks...`);

    // Create tasks
    const taskIds = await createTasksFromDecomposition(db, job.id, decomposition);
    console.log(`Created tasks: ${taskIds.join(', ')}`);

    // Update job status
    await db.updateJobStatus(job.id, 'running');
    console.log('Job status updated to running');

    console.log('\nDemo job created successfully!');
    console.log(`Job ID: ${job.id}`);
    console.log('You can now view this in the dashboard.');
  } catch (error) {
    console.error('Failed to seed demo:', error);
    process.exit(1);
  } finally {
    await db.close();
  }
}

seedDemo();
