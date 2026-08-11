import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  Database,
  TenantDatabase,
  TaskDefinition,
  DecompositionResult,
  CreateTaskInput,
} from '@crash-proof/shared';

/**
 * Task decomposition module using Gemini
 * Breaks down high-level tasks into a DAG of subtasks
 */

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

export interface DecomposeInput {
  jobId: string;
  taskDescription: string;
  context?: Record<string, unknown>;
}

/**
 * Decompose a high-level task into subtasks using Gemini
 */
export async function decompose(input: DecomposeInput): Promise<DecompositionResult> {
  const prompt = buildDecomposePrompt(input.taskDescription, input.context);

  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
  const result = await model.generateContent(prompt);
  const response = result.response.text();

  return parseDecompositionResponse(response);
}

/**
 * Build the prompt for task decomposition
 */
function buildDecomposePrompt(
  taskDescription: string,
  context?: Record<string, unknown>
): string {
  return `
You are a task decomposition expert. Break down the following high-level task into subtasks that can be executed independently or in sequence.

# Task
${taskDescription}

${context ? `# Context\n${JSON.stringify(context, null, 2)}` : ''}

# Instructions
1. Create a directed acyclic graph (DAG) of subtasks
2. Each subtask should be atomic and well-defined
3. Specify dependencies between tasks using task names
4. Use these task types:
   - analyze_codebase: Analyze code structure and identify files
   - refactor_file: Refactor a single file
   - lint_code: Check code for issues
   - run_tests: Verify code works correctly

# Output Format
Respond with a JSON object containing a "tasks" array. Each task should have:
- task_type: One of the types above
- name: A descriptive name for the task
- input_payload: Object with task-specific inputs
- depends_on_names: Array of task names this depends on (empty if no dependencies)

Example:
{
  "tasks": [
    {
      "task_type": "analyze_codebase",
      "name": "Analyze codebase structure",
      "input_payload": { "directory": "src" },
      "depends_on_names": []
    },
    {
      "task_type": "refactor_file",
      "name": "Refactor api.js",
      "input_payload": { "file": "src/api.js" },
      "depends_on_names": ["Analyze codebase structure"]
    }
  ]
}

Only output the JSON, no markdown code blocks or explanations.
`.trim();
}

/**
 * Parse Gemini's decomposition response
 */
function parseDecompositionResponse(response: string): DecompositionResult {
  try {
    const cleaned = response
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();

    const parsed = JSON.parse(cleaned);

    if (!parsed.tasks || !Array.isArray(parsed.tasks)) {
      throw new Error('Invalid response: missing tasks array');
    }

    return {
      tasks: parsed.tasks.map((t: Record<string, unknown>) => ({
        task_type: String(t.task_type || 'unknown'),
        name: String(t.name || 'Unnamed task'),
        input_payload: (t.input_payload as Record<string, unknown>) || {},
        depends_on_names: Array.isArray(t.depends_on_names)
          ? t.depends_on_names.map(String)
          : [],
      })),
    };
  } catch (error) {
    console.error('Failed to parse decomposition response:', response);
    throw new Error(`Failed to parse decomposition: ${error}`);
  }
}

/**
 * Create tasks in the database with proper dependency resolution
 * Works with both Database and TenantDatabase
 */
export async function createTasksFromDecomposition(
  db: Database | TenantDatabase,
  jobId: string,
  result: DecompositionResult
): Promise<string[]> {
  const { tasks } = result;

  // First pass: create all tasks without dependencies
  const taskInputs: CreateTaskInput[] = tasks.map(t => ({
    job_id: jobId,
    task_type: t.task_type,
    name: t.name,
    input_payload: t.input_payload,
    depends_on: [], // Will be updated in second pass
  }));

  const createdTasks = await db.createTasks(taskInputs);

  // Build name to ID mapping
  const nameToId = new Map<string, string>();
  createdTasks.forEach((task, index) => {
    nameToId.set(tasks[index].name, task.id);
  });

  // Get raw db for direct queries
  const rawDb = db instanceof TenantDatabase ? db.rawDb : db;

  // Second pass: update dependencies
  for (let i = 0; i < tasks.length; i++) {
    const taskDef = tasks[i];
    const createdTask = createdTasks[i];

    if (taskDef.depends_on_names && taskDef.depends_on_names.length > 0) {
      const dependencyIds = taskDef.depends_on_names
        .map(name => nameToId.get(name))
        .filter((id): id is string => id !== undefined);

      if (dependencyIds.length > 0) {
        await rawDb.query(
          'UPDATE task_nodes SET depends_on = $1 WHERE id = $2',
          [dependencyIds, createdTask.id]
        );
      }
    }
  }

  return createdTasks.map(t => t.id);
}

/**
 * Pre-built decomposition for the demo refactoring task
 */
export function getDemoRefactoringTasks(): DecompositionResult {
  return {
    tasks: [
      {
        task_type: 'analyze_codebase',
        name: 'Analyze Codebase',
        input_payload: {
          directory: 'demo-repo',
          description: 'Identify all JavaScript files using callbacks',
        },
        depends_on_names: [],
      },
      {
        task_type: 'refactor_file',
        name: 'Refactor file1.js',
        input_payload: {
          file: 'demo-repo/file1.js',
          transformation: 'Convert callbacks to async/await',
        },
        depends_on_names: ['Analyze Codebase'],
      },
      {
        task_type: 'refactor_file',
        name: 'Refactor file2.js',
        input_payload: {
          file: 'demo-repo/file2.js',
          transformation: 'Convert callbacks to async/await',
        },
        depends_on_names: ['Analyze Codebase'],
      },
      {
        task_type: 'refactor_file',
        name: 'Refactor file3.js',
        input_payload: {
          file: 'demo-repo/file3.js',
          transformation: 'Convert callbacks to async/await',
        },
        depends_on_names: ['Analyze Codebase'],
      },
      {
        task_type: 'lint_code',
        name: 'Lint All',
        input_payload: {
          files: ['demo-repo/file1.js', 'demo-repo/file2.js', 'demo-repo/file3.js'],
        },
        depends_on_names: ['Refactor file1.js', 'Refactor file2.js', 'Refactor file3.js'],
      },
      {
        task_type: 'run_tests',
        name: 'Test All',
        input_payload: {
          directory: 'demo-repo',
        },
        depends_on_names: ['Lint All'],
      },
    ],
  };
}
