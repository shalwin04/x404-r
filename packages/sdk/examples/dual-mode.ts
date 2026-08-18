#!/usr/bin/env npx tsx
/**
 * x404-r SDK Dual Mode Example
 *
 * Demonstrates both embedded and cloud modes
 */

import { x404r } from '../src/index.js';

// ═══════════════════════════════════════════════════════════════
// MODE A: EMBEDDED - Direct DB connection, run workers locally
// ═══════════════════════════════════════════════════════════════

async function embeddedModeExample() {
  console.log('\n═══ EMBEDDED MODE ═══\n');

  const runtime = await new x404r({
    mode: 'embedded', // Optional, this is the default
    connectionString: process.env.DATABASE_URL || 'postgresql://root@localhost:26257/x404r',
    ai: {
      provider: 'gemini',
      apiKey: process.env.GEMINI_API_KEY,
    },
    debug: true,
  }).ready();

  console.log('✓ Connected to CockroachDB');
  console.log(`  Mode: ${runtime.currentMode}`);
  console.log(`  Is Embedded: ${runtime.isEmbedded}`);

  // Define a workflow
  const analyzeCode = runtime.workflow('analyze-code', {
    steps: [
      {
        name: 'parse',
        handler: async (ctx) => {
          console.log('  Parsing code...');
          await ctx.checkpoint({ step: 'parse' });
          return { parsed: true };
        },
      },
      {
        name: 'analyze',
        dependsOn: ['parse'],
        handler: async (ctx) => {
          console.log('  Analyzing...');
          await ctx.checkpoint({ step: 'analyze' });
          return { issues: 0 };
        },
      },
    ],
  });

  console.log('✓ Workflow defined:', analyzeCode.name);

  // In embedded mode, you run workers locally
  const worker = runtime.worker({ concurrency: 2 });
  worker.register(analyzeCode);
  console.log('✓ Worker created (not started in this example)');

  // You can also submit jobs programmatically
  const result = await runtime.submit('analyze-code', { code: 'function hello() {}' });
  console.log('✓ Job submitted:', result.workflowId);

  await runtime.close();
  console.log('✓ Connection closed');
}

// ═══════════════════════════════════════════════════════════════
// MODE B: CLOUD - Connect to hosted API, workers run on Lambda
// ═══════════════════════════════════════════════════════════════

async function cloudModeExample() {
  console.log('\n═══ CLOUD MODE ═══\n');

  const runtime = new x404r({
    mode: 'cloud',
    apiKey: process.env.X404R_API_KEY || 'x404r_test_key',
    baseUrl: process.env.X404R_API_URL || 'http://localhost:3001', // Use local for demo
    debug: true,
  });

  console.log(`  Mode: ${runtime.currentMode}`);
  console.log(`  Is Cloud: ${runtime.isCloud}`);

  // In cloud mode, workflows are defined on the platform
  // You just submit jobs and check status

  try {
    // This would work with a real API
    // const job = await runtime.submit('analyze-code', { code: 'function hello() {}' });
    // console.log('✓ Job submitted:', job.workflowId);

    // const status = await runtime.status(job.workflowId);
    // console.log('✓ Job status:', status?.status);

    // Worker throws error in cloud mode
    try {
      runtime.worker();
    } catch (error) {
      console.log('✓ Workers not available in cloud mode (expected):', (error as Error).message);
    }

    // Direct DB access throws error in cloud mode
    try {
      const _ = runtime.db;
    } catch (error) {
      console.log('✓ Direct DB not available in cloud mode (expected):', (error as Error).message);
    }

  } catch (error) {
    console.log('  (Cloud API not running, expected in local dev)');
  }

  await runtime.close();
  console.log('✓ Client closed');
}

// ═══════════════════════════════════════════════════════════════
// COMPARISON
// ═══════════════════════════════════════════════════════════════

function printComparison() {
  console.log('\n═══ MODE COMPARISON ═══\n');
  console.log('┌─────────────────────────────────────────────────────────────────┐');
  console.log('│                    EMBEDDED vs CLOUD                            │');
  console.log('├─────────────────────────────────────────────────────────────────┤');
  console.log('│                                                                 │');
  console.log('│  EMBEDDED MODE:                                                 │');
  console.log('│  ├── Direct CockroachDB connection                              │');
  console.log('│  ├── Run workers locally (your infrastructure)                  │');
  console.log('│  ├── Full control over execution                                │');
  console.log('│  └── Requires: connectionString, AI keys                        │');
  console.log('│                                                                 │');
  console.log('│  CLOUD MODE:                                                    │');
  console.log('│  ├── HTTP API to hosted platform                                │');
  console.log('│  ├── Workers run on Lambda (our infrastructure)                 │');
  console.log('│  ├── Zero infrastructure to manage                              │');
  console.log('│  └── Requires: apiKey only                                      │');
  console.log('│                                                                 │');
  console.log('└─────────────────────────────────────────────────────────────────┘');
}

// ═══════════════════════════════════════════════════════════════
// RUN
// ═══════════════════════════════════════════════════════════════

async function main() {
  console.log('\n╔═══════════════════════════════════════════════════════════════╗');
  console.log('║             x404-r SDK: Dual Mode Demonstration                ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝');

  printComparison();

  // Only run embedded if DB is available
  if (process.env.DATABASE_URL || process.argv.includes('--embedded')) {
    await embeddedModeExample();
  } else {
    console.log('\n(Skipping embedded mode - no DATABASE_URL set)');
    console.log('(Run with DATABASE_URL=... or --embedded flag)');
  }

  // Cloud mode example (works without real API)
  await cloudModeExample();

  console.log('\n✅ Dual mode demonstration complete!\n');
}

main().catch(console.error);
