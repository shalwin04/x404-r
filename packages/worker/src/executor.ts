import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  Database,
  TaskNode,
  MemoryVector,
  TaskExecutionResult,
  TenantContext,
  DEFAULT_TENANT_CONTEXT,
  recordUsageEvent,
} from '@crash-proof/shared';

/**
 * Task executor using Gemini for AI-powered task completion
 */

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

export interface ExecutorContext {
  task: TaskNode;
  memories: MemoryVector[];
  db: Database;
  tenantContext?: TenantContext;
}

/**
 * Execute a task using Gemini
 */
export async function executeTask(ctx: ExecutorContext): Promise<TaskExecutionResult> {
  const { task, memories, db, tenantContext } = ctx;
  const context = tenantContext ?? DEFAULT_TENANT_CONTEXT;

  try {
    // Build prompt with memory context
    const prompt = buildPrompt(task, memories);

    // Call Gemini
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const result = await model.generateContent(prompt);
    const response = result.response.text();

    // Parse the response based on task type
    const output = parseResponse(task.task_type, response);

    // Record successful task completion
    await recordUsageEvent(db, context, 'task_completed', 1, {}, task.job_id, task.id);

    return {
      success: true,
      output,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Record task failure
    await recordUsageEvent(db, context, 'task_failed', 1, { error: errorMessage }, task.job_id, task.id);

    // Check if this needs human intervention
    if (shouldEscalateToHuman(errorMessage, task.attempt_count)) {
      return {
        success: false,
        error: errorMessage,
        needsHuman: true,
      };
    }

    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Build the prompt for Gemini with memory context
 */
function buildPrompt(task: TaskNode, memories: MemoryVector[]): string {
  const parts: string[] = [];

  // Task description
  parts.push(`# Task: ${task.name}`);
  parts.push(`Type: ${task.task_type}`);
  parts.push('');
  parts.push('## Input');
  parts.push(JSON.stringify(task.input_payload, null, 2));
  parts.push('');

  // Memory context (past failures and successes)
  if (memories.length > 0) {
    parts.push('## Relevant Past Experiences');
    parts.push('Learn from these past attempts:');
    parts.push('');

    for (const memory of memories) {
      const icon = memory.event_type === 'failure' ? '! FAILURE' : '+ SUCCESS';
      parts.push(`### ${icon}`);
      parts.push(memory.context_summary);
      if (memory.resolution) {
        parts.push(`Resolution: ${memory.resolution}`);
      }
      parts.push('');
    }
  }

  // Task-specific instructions
  parts.push('## Instructions');
  parts.push(getTaskInstructions(task.task_type));
  parts.push('');

  // Output format
  parts.push('## Output Format');
  parts.push('Respond with a JSON object containing:');
  parts.push('- "result": The main output of the task');
  parts.push('- "explanation": Brief explanation of what was done');
  parts.push('');
  parts.push('Only output the JSON, no markdown code blocks.');

  return parts.join('\n');
}

/**
 * Get task-specific instructions
 */
function getTaskInstructions(taskType: string): string {
  const instructions: Record<string, string> = {
    analyze_codebase: `
Analyze the provided code structure and identify:
1. All files that need refactoring
2. Dependencies between files
3. Potential challenges

Output a list of files and their relationships.
    `.trim(),

    refactor_file: `
Convert the callback-based code to async/await syntax:
1. Replace callback functions with async functions
2. Use try/catch for error handling
3. Maintain the same functionality
4. Preserve all imports and exports

Output the refactored code.
    `.trim(),

    lint_code: `
Check the code for common issues:
1. Unused variables
2. Missing error handling
3. Code style violations
4. Potential bugs

Output a list of issues found or confirm the code is clean.
    `.trim(),

    run_tests: `
Verify the code works correctly:
1. Check for syntax errors
2. Verify async/await patterns are correct
3. Ensure error handling is in place

Output test results and any issues found.
    `.trim(),
  };

  return instructions[taskType] || 'Complete the task as described in the input.';
}

/**
 * Parse Gemini's response into structured output
 */
function parseResponse(taskType: string, response: string): Record<string, unknown> {
  try {
    // Try to parse as JSON first
    const cleaned = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(cleaned);
  } catch {
    // If not valid JSON, wrap in a result object
    return {
      result: response,
      raw: true,
    };
  }
}

/**
 * Determine if an error should be escalated to a human
 */
function shouldEscalateToHuman(error: string, attemptCount: number): boolean {
  // Always escalate after multiple failures
  if (attemptCount >= 2) {
    return true;
  }

  // Escalate specific error types immediately
  const humanRequiredPatterns = [
    /permission denied/i,
    /authentication required/i,
    /rate limit/i,
    /quota exceeded/i,
    /api key/i,
  ];

  return humanRequiredPatterns.some(pattern => pattern.test(error));
}

/**
 * Generate an embedding for memory storage
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const model = genAI.getGenerativeModel({ model: 'text-embedding-004' });
    const result = await model.embedContent(text);
    return result.embedding.values;
  } catch (error) {
    console.error('Failed to generate embedding:', error);
    // Return a zero vector as fallback
    return new Array(768).fill(0);
  }
}

/**
 * Store execution result in memory for future reference
 */
export async function storeMemory(
  db: Database,
  task: TaskNode,
  result: TaskExecutionResult,
  tenantContext?: TenantContext
): Promise<void> {
  const eventType = result.success ? 'success' : 'failure';
  const tenantId = tenantContext?.tenantId ?? task.tenant_id;

  const contextSummary = result.success
    ? `Task "${task.name}" completed successfully. ${JSON.stringify(result.output)}`
    : `Task "${task.name}" failed: ${result.error}`;

  const embedding = await generateEmbedding(contextSummary);

  await db.storeMemory(
    task.id,
    eventType,
    contextSummary,
    embedding,
    task.task_type,
    result.success ? undefined : categorizeError(result.error || ''),
    result.success ? 'Completed without issues' : undefined,
    tenantId
  );
}

/**
 * Categorize an error for better memory retrieval
 */
function categorizeError(error: string): string {
  if (/syntax/i.test(error)) return 'syntax_error';
  if (/timeout/i.test(error)) return 'timeout';
  if (/network|connection/i.test(error)) return 'network_error';
  if (/permission|auth/i.test(error)) return 'auth_error';
  if (/rate limit|quota/i.test(error)) return 'rate_limit';
  return 'unknown';
}

/**
 * Query relevant memories for a task (scoped to tenant)
 */
export async function queryMemories(
  db: Database,
  task: TaskNode,
  limit = 5,
  tenantId?: string
): Promise<MemoryVector[]> {
  const contextText = `Task type: ${task.task_type}. ${task.name}. ${JSON.stringify(task.input_payload)}`;
  const embedding = await generateEmbedding(contextText);

  // Use tenant_id from task if not explicitly provided
  const effectiveTenantId = tenantId ?? task.tenant_id;

  return db.querySimilarMemories(embedding, task.task_type, limit, effectiveTenantId);
}
