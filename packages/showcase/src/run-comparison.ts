/**
 * x404-r SDK Showcase: Side-by-Side Comparison
 *
 * This script runs the same task with and without the SDK,
 * simulates a crash, and shows the real difference in:
 * - Tokens used
 * - Cost
 * - Recovery behavior
 *
 * Run: npx tsx src/run-comparison.ts
 */

import { runWithSDK, getLastCheckpoint, clearCheckpoint } from './with-sdk.js';
import { runVanilla } from './vanilla.js';
import { CODE_ANALYSIS_TASK, calculateCost, type RunMetrics, type ComparisonReport } from './types.js';
import * as fs from 'fs';
import * as path from 'path';

const CRASH_AT_STEP = 2; // Crash at step 3 (0-indexed)

function printHeader(title: string) {
  console.log('\n');
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log(`║  ${title.padEnd(61)}║`);
  console.log('╚═══════════════════════════════════════════════════════════════╝');
  console.log('');
}

function printDivider() {
  console.log('\n' + '─'.repeat(65) + '\n');
}

async function runComparison() {
  console.clear();
  printHeader('x404-r SDK SHOWCASE: Real Comparison');

  console.log('This showcase demonstrates the REAL difference between:');
  console.log('  ✅ x404-r SDK (with checkpoints)');
  console.log('  ❌ Vanilla implementation (no checkpoints)\n');

  console.log(`Task: ${CODE_ANALYSIS_TASK.name}`);
  console.log(`Steps: ${CODE_ANALYSIS_TASK.steps.length}`);
  console.log(`Crash will occur at: Step ${CRASH_AT_STEP + 1}\n`);

  console.log('Press Enter to start...');
  await waitForEnter();

  // ═══════════════════════════════════════════════════════════════
  // PHASE 1: Run x404-r SDK (first run, will crash)
  // ═══════════════════════════════════════════════════════════════
  printHeader('PHASE 1: x404-r SDK - Initial Run (Will Crash)');
  clearCheckpoint();

  const sdkCrashedRun = await runWithSDK({
    crashAtStep: CRASH_AT_STEP,
    verbose: true,
  });

  console.log('\n[x404-r SDK] Run crashed, but checkpoint was saved!');
  const checkpoint = getLastCheckpoint();
  if (checkpoint) {
    console.log(`[x404-r SDK] Checkpoint saved at step ${checkpoint.stepIndex}`);
    console.log(`[x404-r SDK] Tokens preserved: ${checkpoint.tokensUsed.input + checkpoint.tokensUsed.output}`);
  }

  printDivider();
  console.log('Press Enter to recover from checkpoint...');
  await waitForEnter();

  // ═══════════════════════════════════════════════════════════════
  // PHASE 2: Recover x404-r SDK from checkpoint
  // ═══════════════════════════════════════════════════════════════
  printHeader('PHASE 2: x404-r SDK - Recovery from Checkpoint');

  const sdkRecoveredRun = await runWithSDK({
    previousCheckpoint: checkpoint ?? undefined,
    verbose: true,
  });

  printDivider();
  console.log('x404-r SDK completed! Now running vanilla (no SDK) for comparison...');
  console.log('Press Enter to continue...');
  await waitForEnter();

  // ═══════════════════════════════════════════════════════════════
  // PHASE 3: Run Vanilla (first run, will crash)
  // ═══════════════════════════════════════════════════════════════
  printHeader('PHASE 3: Vanilla Agent - Initial Run (Will Crash)');

  const vanillaCrashedRun = await runVanilla({
    crashAtStep: CRASH_AT_STEP,
    verbose: true,
  });

  console.log('\n[Vanilla] Run crashed - NO CHECKPOINT!');
  console.log(`[Vanilla] ALL ${vanillaCrashedRun.tokensUsed.total} tokens are LOST!`);
  console.log('[Vanilla] Must restart from scratch...');

  printDivider();
  console.log('Press Enter to restart vanilla from scratch...');
  await waitForEnter();

  // ═══════════════════════════════════════════════════════════════
  // PHASE 4: Restart Vanilla from scratch
  // ═══════════════════════════════════════════════════════════════
  printHeader('PHASE 4: Vanilla Agent - Full Restart');

  const vanillaRestartRun = await runVanilla({
    isRestart: true,
    previousTokensWasted: vanillaCrashedRun.tokensUsed.total,
    verbose: true,
  });

  // ═══════════════════════════════════════════════════════════════
  // FINAL: Generate Comparison Report
  // ═══════════════════════════════════════════════════════════════
  printHeader('FINAL COMPARISON REPORT');

  // Calculate totals
  const sdkTotalTokens = sdkCrashedRun.tokensUsed.total + sdkRecoveredRun.tokensUsed.total;
  const sdkTotalCost = sdkCrashedRun.costUsd + sdkRecoveredRun.costUsd;
  const sdkTotalTime = sdkCrashedRun.totalTimeMs + sdkRecoveredRun.totalTimeMs;

  const vanillaTotalTokens = vanillaCrashedRun.tokensUsed.total + vanillaRestartRun.tokensUsed.total;
  const vanillaTotalCost = vanillaCrashedRun.costUsd + vanillaRestartRun.costUsd;
  const vanillaTotalTime = vanillaCrashedRun.totalTimeMs + vanillaRestartRun.totalTimeMs;

  const tokensSaved = vanillaTotalTokens - sdkTotalTokens;
  const costSaved = vanillaTotalCost - sdkTotalCost;
  const timeSaved = vanillaTotalTime - sdkTotalTime;

  console.log('┌─────────────────────────────────────────────────────────────────┐');
  console.log('│                         METRICS SUMMARY                         │');
  console.log('├─────────────────────────────────────────────────────────────────┤');
  console.log(`│                          x404-r SDK    │    Vanilla (No SDK)    │`);
  console.log('├─────────────────────────────────────────────────────────────────┤');
  console.log(`│  Total Tokens Used:    ${sdkTotalTokens.toString().padStart(8)}    │      ${vanillaTotalTokens.toString().padStart(8)}          │`);
  console.log(`│  Total Cost:           $${sdkTotalCost.toFixed(6).padStart(7)}    │     $${vanillaTotalCost.toFixed(6).padStart(7)}          │`);
  console.log(`│  Total Time:           ${(sdkTotalTime / 1000).toFixed(1).padStart(6)}s    │       ${(vanillaTotalTime / 1000).toFixed(1).padStart(6)}s          │`);
  console.log(`│  Tokens Wasted:        ${sdkCrashedRun.tokensWastedOnCrash.toString().padStart(8)}    │      ${vanillaCrashedRun.tokensUsed.total.toString().padStart(8)}          │`);
  console.log(`│  Checkpoints Saved:    ${(sdkCrashedRun.checkpointsSaved + sdkRecoveredRun.checkpointsSaved).toString().padStart(8)}    │             0          │`);
  console.log('├─────────────────────────────────────────────────────────────────┤');
  console.log('│                          SAVINGS WITH x404-r                     │');
  console.log('├─────────────────────────────────────────────────────────────────┤');
  console.log(`│  Tokens Saved:         ${tokensSaved.toString().padStart(8)} tokens                       │`);
  console.log(`│  Cost Saved:           $${costSaved.toFixed(6)} (${((costSaved / vanillaTotalCost) * 100).toFixed(1)}%)                       │`);
  console.log(`│  Time Saved:           ${(timeSaved / 1000).toFixed(1)}s                                    │`);
  console.log('└─────────────────────────────────────────────────────────────────┘');

  console.log('\n');
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║                                                               ║');
  if (tokensSaved > 0) {
    console.log('║   🎉 x404-r SDK saved tokens, cost, and time!                 ║');
  } else {
    console.log('║   x404-r SDK provided crash protection                        ║');
  }
  console.log('║                                                               ║');
  console.log('║   With checkpoints, crashes don\'t mean starting over.         ║');
  console.log('║   Context is never lost.                                       ║');
  console.log('║                                                               ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝');
  console.log('\n');

  // Save report to JSON
  const report: ComparisonReport = {
    task: CODE_ANALYSIS_TASK,
    withSdk: {
      startTime: sdkCrashedRun.startTime,
      endTime: sdkRecoveredRun.endTime,
      totalTimeMs: sdkTotalTime,
      stepsCompleted: sdkRecoveredRun.stepsCompleted,
      totalSteps: CODE_ANALYSIS_TASK.steps.length,
      tokensUsed: {
        input: sdkCrashedRun.tokensUsed.input + sdkRecoveredRun.tokensUsed.input,
        output: sdkCrashedRun.tokensUsed.output + sdkRecoveredRun.tokensUsed.output,
        total: sdkTotalTokens,
      },
      costUsd: sdkTotalCost,
      checkpointsSaved: sdkCrashedRun.checkpointsSaved + sdkRecoveredRun.checkpointsSaved,
      crashedAt: CRASH_AT_STEP,
      recoveredFrom: CRASH_AT_STEP,
      tokensWastedOnCrash: sdkCrashedRun.tokensWastedOnCrash,
      finalState: 'recovered',
    },
    vanilla: {
      startTime: vanillaCrashedRun.startTime,
      endTime: vanillaRestartRun.endTime,
      totalTimeMs: vanillaTotalTime,
      stepsCompleted: vanillaRestartRun.stepsCompleted,
      totalSteps: CODE_ANALYSIS_TASK.steps.length,
      tokensUsed: {
        input: vanillaCrashedRun.tokensUsed.input + vanillaRestartRun.tokensUsed.input,
        output: vanillaCrashedRun.tokensUsed.output + vanillaRestartRun.tokensUsed.output,
        total: vanillaTotalTokens,
      },
      costUsd: vanillaTotalCost,
      checkpointsSaved: 0,
      crashedAt: CRASH_AT_STEP,
      tokensWastedOnCrash: vanillaCrashedRun.tokensUsed.total,
      finalState: 'recovered',
    },
    savings: {
      tokensSaved,
      costSavedUsd: costSaved,
      timeSavedMs: timeSaved,
      percentTokensSaved: (tokensSaved / vanillaTotalTokens) * 100,
      percentCostSaved: (costSaved / vanillaTotalCost) * 100,
    },
    crashSimulated: true,
    crashAtStep: CRASH_AT_STEP,
  };

  // Save report
  const reportPath = path.join(process.cwd(), 'showcase-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`Report saved to: ${reportPath}`);

  return report;
}

function waitForEnter(): Promise<void> {
  return new Promise(resolve => {
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdin.once('data', () => {
      process.stdin.setRawMode?.(false);
      process.stdin.pause();
      resolve();
    });
  });
}

// Run the comparison
runComparison()
  .then(report => {
    console.log('\n✅ Showcase completed!');
    console.log(`\nView the dashboard at http://localhost:3000/monitor to see telemetry.`);
    process.exit(0);
  })
  .catch(error => {
    console.error('Error:', error);
    process.exit(1);
  });
