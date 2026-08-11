/**
 * Example: Code Review Agent
 * Demonstrates a crash-proof AI agent that reviews code changes
 *
 * Run with: npx tsx examples/code-review-agent.ts
 */

import { AgentDB } from '../src/index.js';

// Main execution
async function main() {
  console.log('Starting Code Review Agent\n');

  // Initialize the AgentDB client
  const agent = await new AgentDB({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:26257/agentdb',
    ai: {
      provider: 'gemini',
      apiKey: process.env.GEMINI_API_KEY!,
    },
    debug: true,
  }).ready();

  // Define a code review workflow
  const codeReview = agent.workflow<
    { files: string[]; prTitle: string },
    { approved: boolean; comments: string[] }
  >('code-review', {
    version: '1.0.0',
    steps: [
      {
        name: 'analyze-changes',
        handler: async (ctx) => {
          ctx.log('Analyzing code changes...');

          // Use AI to analyze the changes
          const analysis = await ctx.ai.generate(
            'Analyze these code changes for a PR titled "' + ctx.input.prTitle + '":\n\n' +
              ctx.input.files.join('\n\n'),
            {
              systemPrompt:
                'You are a senior code reviewer. Identify potential issues, bugs, and improvements. Be concise.',
            }
          );

          // Checkpoint after analysis (crash-proof!)
          await ctx.checkpoint({ analysis });

          return { analysis };
        },
      },
      {
        name: 'check-security',
        dependsOn: ['analyze-changes'],
        handler: async (ctx) => {
          ctx.log('Checking for security issues...');

          const securityCheck = await ctx.ai.generate(
            'Review this code for security vulnerabilities:\n\n' + ctx.input.files.join('\n\n'),
            {
              systemPrompt:
                'You are a security expert. Look for SQL injection, XSS, auth issues. Be concise.',
            }
          );

          await ctx.checkpoint({ securityCheck });

          return { securityCheck };
        },
      },
      {
        name: 'generate-review',
        dependsOn: ['check-security'],
        handler: async (ctx) => {
          ctx.log('Generating final review...');

          // Structured output with JSON schema
          const review = await ctx.ai.generate(
            'Based on the analysis, generate a final code review decision. Output JSON only.',
            {
              systemPrompt: 'You are a code review bot. Output valid JSON with: approved (boolean), summary (string), comments (array of strings). No markdown.',
            }
          );

          // Parse JSON from response
          let result;
          try {
            const cleaned = review.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            result = JSON.parse(cleaned);
          } catch {
            result = { approved: false, summary: 'Could not parse review', comments: [review] };
          }

          return {
            approved: result.approved,
            comments: result.comments || [],
          };
        },
      },
    ],
  });

  // Create a worker to process tasks
  const worker = agent.worker({
    concurrency: 3,
    pollInterval: 1000,
  });

  // Register the workflow with the worker
  worker.register(codeReview);

  // Start the worker (processes tasks in background)
  await worker.start();
  console.log('Worker started: ' + worker.id + '\n');

  // Submit a code review job
  const result = await codeReview.run(
    {
      prTitle: 'Add user authentication',
      files: [
        '// auth.ts\nexport async function login(email: string, password: string) {\n  const user = await db.query("SELECT * FROM users WHERE email = $1", [email]);\n  if (user && user.password === password) {\n    return createSession(user);\n  }\n  return null;\n}',
        '// session.ts\nexport function createSession(user: User) {\n  const token = Math.random().toString(36);\n  sessions.set(token, user.id);\n  return { token, expiresAt: Date.now() + 3600000 };\n}',
      ],
    },
    { wait: true, timeout: 120000 }
  );

  console.log('\nCode Review Result:');
  console.log(JSON.stringify(result, null, 2));

  // Graceful shutdown
  await worker.stop();
  await agent.close();

  console.log('\nAgent completed');
}

main().catch(console.error);
