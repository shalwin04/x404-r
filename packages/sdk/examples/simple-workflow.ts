/**
 * Example: Simple Workflow
 * Basic workflow demonstrating checkpoints and crash recovery
 *
 * Run with: npx tsx examples/simple-workflow.ts
 */

import { AgentDB } from '../src/index.js';

const agent = new AgentDB({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost:26257/agentdb',
  debug: true,
});

// Define a simple data processing workflow
const processData = agent.workflow<
  { items: string[] },
  { processed: number }
>('process-data', {
  steps: [
    {
      name: 'process-items',
      handler: async (ctx) => {
        const items = ctx.input.items;
        let processed = (ctx.state.processed as number) || 0;
        
        ctx.log('Starting from item ' + processed + ' of ' + items.length);

        // Process each item with checkpoints
        for (let idx = processed; idx < items.length; idx++) {
          ctx.log('Processing item ' + (idx + 1) + ': ' + items[idx]);
          
          // Simulate work
          await ctx.sleep(500);
          
          // Checkpoint after each item (crash-proof!)
          // If the process crashes, it resumes from the last checkpoint
          processed = idx + 1;
          await ctx.checkpoint({ processed });
        }

        return { processed };
      },
    },
  ],
});

async function main() {
  console.log('Simple Workflow Example\n');

  // Create and start a worker
  const worker = agent.worker({ concurrency: 1 });
  worker.register(processData);
  await worker.start();

  // Run the workflow
  const result = await processData.run(
    { items: ['apple', 'banana', 'cherry', 'date', 'elderberry'] },
    { wait: true }
  );

  console.log('\nResult:', result);

  await worker.stop();
  await agent.close();
}

main().catch(console.error);
