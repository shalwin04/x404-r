/**
 * Example: Simple Workflow
 * Demonstrates checkpoints and crash recovery with x404-r
 *
 * Run with: npx tsx examples/simple-workflow.ts
 */

import { x404r } from '../src/index.js';

const runtime = await new x404r({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost:26257/x404r',
  debug: true,
}).ready();

// Define a crash-proof data processing workflow
const processData = runtime.workflow<
  { items: string[] },
  { processed: number }
>('process-data', {
  steps: [
    {
      name: 'process-items',
      handler: async (ctx) => {
        const items = ctx.input.items;

        // Resume from checkpoint if we crashed
        let processed = (ctx.state.processed as number) || 0;

        ctx.log('Starting from item ' + processed + ' of ' + items.length);

        for (let idx = processed; idx < items.length; idx++) {
          ctx.log('Processing item ' + (idx + 1) + ': ' + items[idx]);

          // Simulate work
          await ctx.sleep(500);

          // Checkpoint after each item - CRASH-PROOF!
          // If the process dies here, next worker resumes from this checkpoint
          processed = idx + 1;
          await ctx.checkpoint({ processed });
        }

        return { processed };
      },
    },
  ],
});

async function main() {
  console.log('x404-r Simple Workflow Example\n');
  console.log('Context is never lost - even if workers crash!\n');

  // Create and start a worker
  const worker = runtime.worker({ concurrency: 1 });
  worker.register(processData);
  await worker.start();

  // Run the workflow
  const result = await processData.run(
    { items: ['apple', 'banana', 'cherry', 'date', 'elderberry'] },
    { wait: true }
  );

  console.log('\nResult:', result);

  await worker.stop();
  await runtime.close();
}

main().catch(console.error);
