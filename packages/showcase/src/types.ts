/**
 * Showcase Types
 * Shared types for SDK vs Vanilla comparison
 */

export interface ShowcaseTask {
  id: string;
  name: string;
  description: string;
  steps: TaskStep[];
}

export interface TaskStep {
  id: string;
  name: string;
  prompt: string;
  estimatedTokens: number;
}

export interface RunMetrics {
  startTime: number;
  endTime: number;
  totalTimeMs: number;
  stepsCompleted: number;
  totalSteps: number;
  tokensUsed: {
    input: number;
    output: number;
    total: number;
  };
  costUsd: number;
  checkpointsSaved: number;
  crashedAt?: number; // Step index where crash occurred
  recoveredFrom?: number; // Step index recovered from
  tokensWastedOnCrash: number;
  finalState: 'completed' | 'crashed' | 'recovered';
}

export interface ComparisonReport {
  task: ShowcaseTask;
  withSdk: RunMetrics;
  vanilla: RunMetrics;
  savings: {
    tokensSaved: number;
    costSavedUsd: number;
    timeSavedMs: number;
    percentTokensSaved: number;
    percentCostSaved: number;
  };
  crashSimulated: boolean;
  crashAtStep: number;
}

// Gemini pricing (approximate)
export const PRICING = {
  inputPerMillion: 0.075, // $0.075 per 1M input tokens
  outputPerMillion: 0.30, // $0.30 per 1M output tokens
};

export function calculateCost(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * PRICING.inputPerMillion +
    (outputTokens / 1_000_000) * PRICING.outputPerMillion
  );
}

/**
 * The showcase task: Code Analysis
 * 5 steps that analyze code, each building on the previous
 */
export const CODE_ANALYSIS_TASK: ShowcaseTask = {
  id: 'code-analysis',
  name: 'Code Analysis Pipeline',
  description: 'Analyze code for quality, security, and improvements',
  steps: [
    {
      id: 'step-1',
      name: 'Parse Structure',
      prompt: `Analyze the following TypeScript code structure. Identify all functions, classes, and exports. List them with their line numbers.

\`\`\`typescript
// Example: A simple auth module
export interface User {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
}

export class AuthService {
  private users: Map<string, User> = new Map();

  async register(email: string, password: string): Promise<User> {
    const id = crypto.randomUUID();
    const passwordHash = await this.hashPassword(password);
    const user: User = { id, email, passwordHash, createdAt: new Date() };
    this.users.set(id, user);
    return user;
  }

  async login(email: string, password: string): Promise<string | null> {
    const user = Array.from(this.users.values()).find(u => u.email === email);
    if (!user) return null;
    const valid = await this.verifyPassword(password, user.passwordHash);
    return valid ? this.generateToken(user) : null;
  }

  private async hashPassword(password: string): Promise<string> {
    return password; // TODO: implement proper hashing
  }

  private async verifyPassword(password: string, hash: string): Promise<boolean> {
    return password === hash;
  }

  private generateToken(user: User): string {
    return Buffer.from(JSON.stringify({ userId: user.id, exp: Date.now() + 3600000 })).toString('base64');
  }
}
\`\`\`

Provide a structured analysis of the code components.`,
      estimatedTokens: 800,
    },
    {
      id: 'step-2',
      name: 'Security Audit',
      prompt: `Based on the code structure identified, perform a security audit. Look for:
1. Authentication vulnerabilities
2. Password handling issues
3. Token security problems
4. Data exposure risks

Previous analysis found these components:
- User interface with passwordHash field
- AuthService class with register, login methods
- Password hashing using placeholder implementation
- Token generation using base64 encoding

Identify all security issues with severity levels (Critical, High, Medium, Low).`,
      estimatedTokens: 600,
    },
    {
      id: 'step-3',
      name: 'Performance Review',
      prompt: `Review the code for performance issues. Consider:
1. Memory usage (storing users in Map)
2. Async operations efficiency
3. Potential bottlenecks at scale
4. Caching opportunities

The code uses an in-memory Map for user storage and has async password operations.

Provide performance recommendations with expected impact.`,
      estimatedTokens: 500,
    },
    {
      id: 'step-4',
      name: 'Best Practices Check',
      prompt: `Check the code against TypeScript/JavaScript best practices:
1. Type safety
2. Error handling
3. Code organization
4. Naming conventions
5. Documentation

Identify violations and suggest improvements.`,
      estimatedTokens: 500,
    },
    {
      id: 'step-5',
      name: 'Generate Report',
      prompt: `Synthesize all previous analyses into a final code review report. Include:
1. Executive Summary
2. Critical Issues (must fix)
3. Recommendations (should fix)
4. Nice-to-haves
5. Overall code quality score (1-10)

Format as a structured report that could be shared with a development team.`,
      estimatedTokens: 700,
    },
  ],
};
