/**
 * VANILLA: Traditional Agent Execution (No SDK)
 *
 * This version runs WITHOUT the x404-r SDK.
 * If crashed, ALL progress is lost - must restart from scratch.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  CODE_ANALYSIS_TASK,
  calculateCost,
  type RunMetrics,
} from './types.js';

interface VanillaRunOptions {
  crashAtStep?: number; // Simulate crash at this step (0-indexed)
  isRestart?: boolean; // Is this a restart after crash?
  previousTokensWasted?: number; // Tokens from previous crashed run
  verbose?: boolean;
}

export async function runVanilla(options: VanillaRunOptions = {}): Promise<RunMetrics> {
  const { crashAtStep, isRestart = false, previousTokensWasted = 0, verbose = true } = options;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable required');
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const task = CODE_ANALYSIS_TASK;
  const startTime = Date.now();

  let tokensUsed = { input: 0, output: 0 };
  const stepResults: string[] = [];

  // Track total tokens wasted (including from previous crashes)
  let tokensWastedOnCrash = previousTokensWasted;

  if (verbose) {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  Vanilla Agent - No Checkpoints');
    console.log('═══════════════════════════════════════════════════════════════\n');
    console.log(`Task: ${task.name}`);
    console.log(`Steps: ${task.steps.length}`);
    if (isRestart) {
      console.log(`⚠️  This is a RESTART - previous progress was lost!`);
      console.log(`   Tokens wasted from crash: ${previousTokensWasted}`);
    }
    console.log('');
  }

  try {
    for (let i = 0; i < task.steps.length; i++) {
      const step = task.steps[i];

      // Check if we should simulate a crash
      if (crashAtStep !== undefined && i === crashAtStep) {
        if (verbose) {
          console.log(`\n💥 [CRASH] Process killed at step ${i + 1}: ${step.name}`);
          console.log(`   ❌ NO CHECKPOINT - All progress lost!`);
          console.log(`   Tokens wasted: ${tokensUsed.input + tokensUsed.output}`);
        }

        // ALL tokens used so far are wasted - no checkpoint!
        const totalTokensWasted = tokensUsed.input + tokensUsed.output;

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
          checkpointsSaved: 0, // No checkpoints in vanilla!
          crashedAt: i,
          tokensWastedOnCrash: totalTokensWasted + previousTokensWasted,
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

      if (verbose) {
        console.log(`   ✓ Completed (${inputTokens + outputTokens} tokens)`);
        console.log(`   ⚠️  No checkpoint saved`);
      }

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    const endTime = Date.now();

    // If this was a restart, add the wasted tokens to the total
    const totalTokens = tokensUsed.input + tokensUsed.output + previousTokensWasted;
    const totalCost = calculateCost(tokensUsed.input + previousTokensWasted * 0.5, tokensUsed.output + previousTokensWasted * 0.5);

    if (verbose) {
      console.log('\n───────────────────────────────────────────────────────────────');
      console.log('✅ Task completed successfully!');
      console.log(`   Tokens this run: ${tokensUsed.input + tokensUsed.output}`);
      if (isRestart) {
        console.log(`   Tokens wasted on crash: ${previousTokensWasted}`);
        console.log(`   TOTAL tokens used: ${totalTokens}`);
      }
      console.log(`   Total cost: $${totalCost.toFixed(6)}`);
      console.log(`   Checkpoints saved: 0 (none)`);
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
      checkpointsSaved: 0,
      tokensWastedOnCrash: previousTokensWasted,
      finalState: isRestart ? 'recovered' : 'completed',
    };
  } catch (error) {
    console.error('[Vanilla] Error:', error);
    throw error;
  }
}

// Run if executed directly
if (process.argv[1]?.endsWith('vanilla.ts')) {
  const crashAt = process.argv.includes('--crash')
    ? parseInt(process.argv[process.argv.indexOf('--crash') + 1] || '2')
    : undefined;

  console.log('\n🚀 Running Vanilla (no SDK) showcase...\n');

  if (crashAt !== undefined) {
    console.log(`Will crash at step ${crashAt + 1}`);
  }

  runVanilla({
    crashAtStep: crashAt,
    verbose: true,
  })
    .then(metrics => {
      console.log('\nFinal Metrics:', JSON.stringify(metrics, null, 2));
    })
    .catch(console.error);
}
