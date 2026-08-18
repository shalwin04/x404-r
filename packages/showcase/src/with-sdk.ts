/**
 * WITH SDK: x404-r Crash-Proof Execution
 *
 * This version uses the x404-r SDK with checkpoints.
 * If crashed, it can recover from the last checkpoint.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  CODE_ANALYSIS_TASK,
  calculateCost,
  type RunMetrics,
  type TaskStep,
} from './types.js';

interface CheckpointData {
  stepIndex: number;
  stepResults: string[];
  tokensUsed: { input: number; output: number };
  savedAt: number;
}

interface SDKRunOptions {
  crashAtStep?: number; // Simulate crash at this step (0-indexed)
  previousCheckpoint?: CheckpointData; // Resume from checkpoint
  verbose?: boolean;
}

// Simulated checkpoint storage (in real SDK, this goes to CockroachDB)
let savedCheckpoint: CheckpointData | null = null;

export function getLastCheckpoint(): CheckpointData | null {
  return savedCheckpoint;
}

export function clearCheckpoint(): void {
  savedCheckpoint = null;
}

export async function runWithSDK(options: SDKRunOptions = {}): Promise<RunMetrics> {
  const { crashAtStep, previousCheckpoint, verbose = true } = options;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable required');
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const task = CODE_ANALYSIS_TASK;
  const startTime = Date.now();

  // Initialize from checkpoint if available
  let stepIndex = previousCheckpoint?.stepIndex ?? 0;
  let stepResults: string[] = previousCheckpoint?.stepResults ?? [];
  let tokensUsed = previousCheckpoint?.tokensUsed ?? { input: 0, output: 0 };
  let checkpointsSaved = previousCheckpoint ? 1 : 0;
  let recoveredFrom = previousCheckpoint?.stepIndex;
  let tokensWastedOnCrash = 0;

  if (previousCheckpoint && verbose) {
    console.log(`\n[x404-r SDK] Recovering from checkpoint at step ${stepIndex}`);
    console.log(`[x404-r SDK] Tokens already used: ${tokensUsed.input + tokensUsed.output}`);
    console.log(`[x404-r SDK] Skipping ${stepIndex} completed steps\n`);
  }

  if (verbose) {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  x404-r SDK - Crash-Proof Execution');
    console.log('═══════════════════════════════════════════════════════════════\n');
    console.log(`Task: ${task.name}`);
    console.log(`Steps: ${task.steps.length}`);
    if (recoveredFrom !== undefined) {
      console.log(`Recovered from: Step ${recoveredFrom + 1}`);
    }
    console.log('');
  }

  try {
    for (let i = stepIndex; i < task.steps.length; i++) {
      const step = task.steps[i];

      // Check if we should simulate a crash
      if (crashAtStep !== undefined && i === crashAtStep) {
        if (verbose) {
          console.log(`\n💥 [CRASH] Process killed at step ${i + 1}: ${step.name}`);
          console.log(`   Last checkpoint saved at step ${i}`);
        }

        // Calculate tokens that would be wasted (only the crashed step)
        // With SDK, we only lose work since last checkpoint
        const tokensLostThisStep = Math.round(step.estimatedTokens * 0.5); // Assume crashed midway
        tokensWastedOnCrash = tokensLostThisStep;

        return {
          startTime,
          endTime: Date.now(),
          totalTimeMs: Date.now() - startTime,
          stepsCompleted: i,
          totalSteps: task.steps.length,
          tokensUsed: {
            input: tokensUsed.input,
            output: tokensUsed.output,
            total: tokensUsed.input + tokensUsed.output,
          },
          costUsd: calculateCost(tokensUsed.input, tokensUsed.output),
          checkpointsSaved,
          crashedAt: i,
          tokensWastedOnCrash,
          finalState: 'crashed',
        };
      }

      if (verbose) {
        console.log(`[Step ${i + 1}/${task.steps.length}] ${step.name}...`);
      }

      // Execute the AI call
      const result = await model.generateContent(step.prompt);
      const response = result.response;
      const text = response.text();

      // Track token usage
      const usage = response.usageMetadata;
      const inputTokens = usage?.promptTokenCount ?? step.estimatedTokens;
      const outputTokens = usage?.candidatesTokenCount ?? Math.round(step.estimatedTokens * 0.8);

      tokensUsed.input += inputTokens;
      tokensUsed.output += outputTokens;

      stepResults.push(text);

      // SAVE CHECKPOINT after each step
      savedCheckpoint = {
        stepIndex: i + 1, // Next step to run
        stepResults: [...stepResults],
        tokensUsed: { ...tokensUsed },
        savedAt: Date.now(),
      };
      checkpointsSaved++;

      if (verbose) {
        console.log(`   ✓ Completed (${inputTokens + outputTokens} tokens)`);
        console.log(`   💾 Checkpoint saved`);
      }

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    const endTime = Date.now();

    if (verbose) {
      console.log('\n───────────────────────────────────────────────────────────────');
      console.log('✅ Task completed successfully!');
      console.log(`   Total tokens: ${tokensUsed.input + tokensUsed.output}`);
      console.log(`   Total cost: $${calculateCost(tokensUsed.input, tokensUsed.output).toFixed(6)}`);
      console.log(`   Checkpoints saved: ${checkpointsSaved}`);
      console.log('───────────────────────────────────────────────────────────────\n');
    }

    return {
      startTime,
      endTime,
      totalTimeMs: endTime - startTime,
      stepsCompleted: task.steps.length,
      totalSteps: task.steps.length,
      tokensUsed: {
        input: tokensUsed.input,
        output: tokensUsed.output,
        total: tokensUsed.input + tokensUsed.output,
      },
      costUsd: calculateCost(tokensUsed.input, tokensUsed.output),
      checkpointsSaved,
      recoveredFrom,
      tokensWastedOnCrash,
      finalState: recoveredFrom !== undefined ? 'recovered' : 'completed',
    };
  } catch (error) {
    console.error('[x404-r SDK] Error:', error);
    throw error;
  }
}

// Run if executed directly
if (process.argv[1]?.endsWith('with-sdk.ts')) {
  const crashAt = process.argv.includes('--crash')
    ? parseInt(process.argv[process.argv.indexOf('--crash') + 1] || '2')
    : undefined;

  const recover = process.argv.includes('--recover');

  console.log('\n🚀 Running x404-r SDK showcase...\n');

  if (crashAt !== undefined) {
    console.log(`Will crash at step ${crashAt + 1}`);
  }

  runWithSDK({
    crashAtStep: crashAt,
    previousCheckpoint: recover ? getLastCheckpoint() ?? undefined : undefined,
    verbose: true,
  })
    .then(metrics => {
      console.log('\nFinal Metrics:', JSON.stringify(metrics, null, 2));
    })
    .catch(console.error);
}
