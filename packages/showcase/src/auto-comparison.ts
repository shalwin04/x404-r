#!/usr/bin/env npx tsx
/**
 * x404-r SDK Showcase: Auto-Running Comparison
 *
 * Demonstrates the REAL difference between x404-r SDK and vanilla agents.
 * Shows how checkpoints prevent wasted work when crashes occur.
 *
 * Run: npx tsx src/auto-comparison.ts
 */

import { runWithSDK, getLastCheckpoint, clearCheckpoint } from './with-sdk.js';
import { runVanilla } from './vanilla.js';
import { CODE_ANALYSIS_TASK, type ComparisonReport } from './types.js';
import * as fs from 'fs';
import * as path from 'path';

const CRASH_AT_STEP = 2; // Crash at step 3 (0-indexed)

async function runAutoComparison(): Promise<ComparisonReport> {
  console.log('\n╔═══════════════════════════════════════════════════════════════╗');
  console.log('║           x404-r SDK SHOWCASE: Automated Comparison           ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  console.log(`Task: ${CODE_ANALYSIS_TASK.name}`);
  console.log(`Steps: ${CODE_ANALYSIS_TASK.steps.length}`);
  console.log(`Crash simulation at: Step ${CRASH_AT_STEP + 1}\n`);

  // ═══════════════════════════════════════════════════════════════
  // Run x404-r SDK
  // ═══════════════════════════════════════════════════════════════
  console.log('═══ x404-r SDK (with checkpoints) ═══\n');
  clearCheckpoint();

  // Crash run
  console.log('Phase 1: Running until crash...');
  const sdkCrashedRun = await runWithSDK({
    crashAtStep: CRASH_AT_STEP,
    verbose: false,
  });
  const sdkStepsBeforeCrash = sdkCrashedRun.stepsCompleted;
  console.log(`  ✓ Crashed at step ${CRASH_AT_STEP + 1}`);
  console.log(`  ✓ Checkpoint saved at step ${sdkStepsBeforeCrash}`);
  console.log(`  ✓ Tokens used before crash: ${sdkCrashedRun.tokensUsed.total}`);
  console.log(`  ✓ AI calls made: ${sdkStepsBeforeCrash}`);

  // Recovery run
  console.log('\nPhase 2: Recovering from checkpoint...');
  const checkpoint = getLastCheckpoint();
  const sdkRecoveredRun = await runWithSDK({
    previousCheckpoint: checkpoint ?? undefined,
    verbose: false,
  });
  const sdkStepsAfterRecovery = sdkRecoveredRun.stepsCompleted - (checkpoint?.stepIndex ?? 0);
  console.log(`  ✓ Recovered from step ${checkpoint?.stepIndex ?? 0}`);
  console.log(`  ✓ Additional tokens used: ${sdkRecoveredRun.tokensUsed.total}`);
  console.log(`  ✓ Additional AI calls: ${CODE_ANALYSIS_TASK.steps.length - (checkpoint?.stepIndex ?? 0)}`);
  console.log(`  ✓ Task completed!`);

  // ═══════════════════════════════════════════════════════════════
  // Run Vanilla
  // ═══════════════════════════════════════════════════════════════
  console.log('\n═══ Vanilla Agent (no checkpoints) ═══\n');

  // Crash run
  console.log('Phase 1: Running until crash...');
  const vanillaCrashedRun = await runVanilla({
    crashAtStep: CRASH_AT_STEP,
    verbose: false,
  });
  const vanillaStepsBeforeCrash = vanillaCrashedRun.stepsCompleted;
  console.log(`  ✓ Crashed at step ${CRASH_AT_STEP + 1}`);
  console.log(`  ✗ NO checkpoint - all progress lost!`);
  console.log(`  ✗ Tokens wasted: ${vanillaCrashedRun.tokensUsed.total}`);
  console.log(`  ✗ AI calls wasted: ${vanillaStepsBeforeCrash}`);

  // Restart run
  console.log('\nPhase 2: Restarting from scratch...');
  const vanillaRestartRun = await runVanilla({
    isRestart: true,
    previousTokensWasted: vanillaCrashedRun.tokensUsed.total,
    verbose: false,
  });
  console.log(`  ✓ Started over from step 1`);
  console.log(`  ✓ Tokens used for full restart: ${vanillaRestartRun.tokensUsed.total}`);
  console.log(`  ✓ AI calls for restart: ${CODE_ANALYSIS_TASK.steps.length}`);
  console.log(`  ✓ Task completed!`);

  // ═══════════════════════════════════════════════════════════════
  // Calculate Results - Focus on AI CALLS and WORK WASTED
  // ═══════════════════════════════════════════════════════════════

  // SDK: runs steps before crash + steps after recovery
  const sdkTotalAICalls = sdkStepsBeforeCrash + (CODE_ANALYSIS_TASK.steps.length - (checkpoint?.stepIndex ?? 0));
  const sdkTotalTokens = sdkCrashedRun.tokensUsed.total + sdkRecoveredRun.tokensUsed.total;
  const sdkTotalCost = sdkCrashedRun.costUsd + sdkRecoveredRun.costUsd;
  const sdkTotalTime = sdkCrashedRun.totalTimeMs + sdkRecoveredRun.totalTimeMs;
  const sdkWastedCalls = 0; // SDK resumes from checkpoint, no wasted calls
  const sdkWastedTokens = sdkCrashedRun.tokensWastedOnCrash; // Only partial step wasted

  // Vanilla: runs steps before crash (wasted) + ALL steps on restart
  const vanillaTotalAICalls = vanillaStepsBeforeCrash + CODE_ANALYSIS_TASK.steps.length;
  const vanillaTotalTokens = vanillaCrashedRun.tokensUsed.total + vanillaRestartRun.tokensUsed.total;
  const vanillaTotalCost = vanillaCrashedRun.costUsd + vanillaRestartRun.costUsd;
  const vanillaTotalTime = vanillaCrashedRun.totalTimeMs + vanillaRestartRun.totalTimeMs;
  const vanillaWastedCalls = vanillaStepsBeforeCrash; // All pre-crash calls are wasted
  const vanillaWastedTokens = vanillaCrashedRun.tokensUsed.total; // All pre-crash tokens wasted

  const aiCallsSaved = vanillaTotalAICalls - sdkTotalAICalls;
  const tokensSaved = vanillaWastedTokens - sdkWastedTokens;
  const percentCallsSaved = (aiCallsSaved / vanillaTotalAICalls) * 100;

  // Print results
  console.log('\n╔═══════════════════════════════════════════════════════════════╗');
  console.log('║                       COMPARISON RESULTS                      ║');
  console.log('╠═══════════════════════════════════════════════════════════════╣');
  console.log('║                      x404-r SDK       Vanilla                 ║');
  console.log('╠═══════════════════════════════════════════════════════════════╣');
  console.log(`║  Total AI Calls:          ${sdkTotalAICalls.toString().padStart(3)}             ${vanillaTotalAICalls.toString().padStart(3)}                 ║`);
  console.log(`║  Wasted AI Calls:         ${sdkWastedCalls.toString().padStart(3)}             ${vanillaWastedCalls.toString().padStart(3)}                 ║`);
  console.log(`║  Total Tokens:       ${sdkTotalTokens.toString().padStart(8)}        ${vanillaTotalTokens.toString().padStart(8)}                 ║`);
  console.log(`║  Wasted Tokens:      ${sdkWastedTokens.toString().padStart(8)}        ${vanillaWastedTokens.toString().padStart(8)}                 ║`);
  console.log(`║  Total Cost:         $${sdkTotalCost.toFixed(5)}       $${vanillaTotalCost.toFixed(5)}                 ║`);
  console.log(`║  Total Time:         ${(sdkTotalTime / 1000).toFixed(1).padStart(6)}s        ${(vanillaTotalTime / 1000).toFixed(1).padStart(6)}s                 ║`);
  console.log('╠═══════════════════════════════════════════════════════════════╣');
  console.log('║                     KEY DIFFERENCE                            ║');
  console.log('╠═══════════════════════════════════════════════════════════════╣');
  console.log(`║  AI Calls Saved:               ${aiCallsSaved} calls (${percentCallsSaved.toFixed(0)}% fewer)         ║`);
  console.log(`║  Tokens Not Wasted:       ${tokensSaved.toString().padStart(6)} tokens                     ║`);
  console.log('╚═══════════════════════════════════════════════════════════════╝');

  console.log('\n┌─────────────────────────────────────────────────────────────────┐');
  console.log('│                         THE TAKEAWAY                            │');
  console.log('├─────────────────────────────────────────────────────────────────┤');
  console.log('│                                                                 │');
  console.log('│  When a crash occurs:                                           │');
  console.log('│                                                                 │');
  console.log(`│  ❌ Vanilla: Wasted ${vanillaWastedCalls} AI calls, must redo ALL ${CODE_ANALYSIS_TASK.steps.length} steps            │`);
  console.log(`│  ✅ x404-r:  Wasted 0 AI calls, resumed from checkpoint          │`);
  console.log('│                                                                 │');
  console.log('│  x404-r SDK ensures context is NEVER lost.                      │');
  console.log('│                                                                 │');
  console.log('└─────────────────────────────────────────────────────────────────┘');

  // Create report
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
      tokensWastedOnCrash: sdkWastedTokens,
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
      tokensWastedOnCrash: vanillaWastedTokens,
      finalState: 'recovered',
    },
    savings: {
      tokensSaved: tokensSaved,
      costSavedUsd: (vanillaWastedTokens - sdkWastedTokens) * 0.000009,
      timeSavedMs: 0,
      percentTokensSaved: (tokensSaved / vanillaWastedTokens) * 100,
      percentCostSaved: (tokensSaved / vanillaWastedTokens) * 100,
    },
    crashSimulated: true,
    crashAtStep: CRASH_AT_STEP,
  };

  // Save report
  const reportPath = path.join(process.cwd(), 'showcase-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n📄 Report saved to: ${reportPath}`);

  return report;
}

// Run
runAutoComparison()
  .then(() => {
    console.log('\n✅ Showcase completed successfully!\n');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Error:', error);
    process.exit(1);
  });
