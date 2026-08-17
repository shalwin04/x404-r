'use client';

import React, { useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as api from '@/lib/api';

interface GeneratedTask {
  id: string;
  name: string;
  type: string;
  description: string;
  dependsOn: string[];
  hasCheckpoint: boolean;
}

interface AgentPlan {
  name: string;
  description: string;
  tasks: GeneratedTask[];
  estimatedCost: number;
  estimatedTime: string;
}

const TASK_TYPE_ICONS: Record<string, string> = {
  analyze: '🔍',
  fetch: '📥',
  process: '⚙️',
  generate: '✨',
  validate: '✓',
  deploy: '🚀',
  notify: '📣',
  default: '📋',
};

const EXAMPLE_PROMPTS = [
  {
    title: 'Code Refactoring',
    prompt: 'Analyze my codebase and convert all callback-based functions to async/await',
    icon: '🔄',
  },
  {
    title: 'Documentation Generator',
    prompt: 'Scan all TypeScript files and generate comprehensive API documentation',
    icon: '📚',
  },
  {
    title: 'Security Audit',
    prompt: 'Review the codebase for security vulnerabilities and create a report with fixes',
    icon: '🔒',
  },
  {
    title: 'Test Coverage',
    prompt: 'Analyze untested functions and generate unit tests for critical paths',
    icon: '🧪',
  },
];

export default function CreateAgentPage() {
  const router = useRouter();
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [plan, setPlan] = useState<AgentPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [editingTask, setEditingTask] = useState<string | null>(null);

  // GitHub connection state
  const [showGitHub, setShowGitHub] = useState(false);
  const [repoUrl, setRepoUrl] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectedRepo, setConnectedRepo] = useState<string | null>(null);

  const handleGeneratePlan = useCallback(async () => {
    if (!prompt.trim()) return;

    setIsGenerating(true);
    setError(null);

    try {
      // In production, this would call the AI to decompose the task
      // For now, we'll simulate the plan generation
      await new Promise(resolve => setTimeout(resolve, 1500));

      const mockPlan: AgentPlan = generateMockPlan(prompt, connectedRepo);
      setPlan(mockPlan);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate plan');
    } finally {
      setIsGenerating(false);
    }
  }, [prompt, connectedRepo]);

  const handleRunAgent = useCallback(async () => {
    if (!plan) return;

    setIsRunning(true);
    setError(null);

    try {
      // Create the job via API
      const result = await api.createJob({
        name: plan.name,
        description: plan.description,
        context: {
          tasks: plan.tasks,
          repo: connectedRepo,
        },
      });

      // Navigate to dashboard to watch execution
      router.push(`/dashboard?job=${result.jobId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start agent');
      setIsRunning(false);
    }
  }, [plan, connectedRepo, router]);

  const handleConnectGitHub = useCallback(async () => {
    if (!repoUrl.trim()) return;

    setIsConnecting(true);
    try {
      // Validate GitHub URL
      const match = repoUrl.match(/github\.com\/([^/]+\/[^/]+)/);
      if (!match) {
        throw new Error('Invalid GitHub URL');
      }

      await new Promise(resolve => setTimeout(resolve, 800));
      setConnectedRepo(match[1]);
      setShowGitHub(false);
      setRepoUrl('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect repository');
    } finally {
      setIsConnecting(false);
    }
  }, [repoUrl]);

  const toggleTaskCheckpoint = (taskId: string) => {
    if (!plan) return;
    setPlan({
      ...plan,
      tasks: plan.tasks.map(t =>
        t.id === taskId ? { ...t, hasCheckpoint: !t.hasCheckpoint } : t
      ),
    });
  };

  const removeTask = (taskId: string) => {
    if (!plan) return;
    setPlan({
      ...plan,
      tasks: plan.tasks.filter(t => t.id !== taskId),
    });
  };

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-primary)' }}>
      {/* Header */}
      <header className="border-b glass sticky top-0 z-50" style={{ borderColor: 'var(--border-subtle)' }}>
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="flex items-center gap-2">
              <span className="text-lg font-semibold" style={{ letterSpacing: '-0.02em' }}>x404-r</span>
            </Link>
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>/</span>
            <span className="text-sm font-medium">Create Agent</span>
          </div>
          <Link href="/dashboard" className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Dashboard →
          </Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-12">
        {/* Title */}
        <div className="text-center mb-12">
          <h1 className="text-3xl font-bold mb-3" style={{ letterSpacing: '-0.02em' }}>
            Create a Crash-Proof Agent
          </h1>
          <p style={{ color: 'var(--text-muted)' }}>
            Describe what you want your agent to do. We'll break it into recoverable tasks.
          </p>
        </div>

        {/* Error Banner */}
        {error && (
          <div className="mb-6 p-4 rounded-xl flex items-center justify-between" style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
            <span className="text-sm" style={{ color: 'var(--error)' }}>{error}</span>
            <button onClick={() => setError(null)} className="p-1" style={{ color: 'var(--error)' }}>✕</button>
          </div>
        )}

        {/* Connected Repo Badge */}
        {connectedRepo && (
          <div className="mb-6 p-3 rounded-xl flex items-center justify-between" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--bg-elevated)' }}>
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
                </svg>
              </div>
              <div>
                <div className="text-sm font-medium">{connectedRepo}</div>
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Repository connected</div>
              </div>
            </div>
            <button
              onClick={() => setConnectedRepo(null)}
              className="text-xs px-2 py-1 rounded"
              style={{ color: 'var(--text-muted)' }}
            >
              Disconnect
            </button>
          </div>
        )}

        {!plan ? (
          /* Input Phase */
          <div className="space-y-6">
            {/* Main Input */}
            <div className="rounded-2xl p-6" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
              <label className="block text-sm font-medium mb-3">
                What do you want your agent to do?
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Example: Analyze my codebase for performance issues and create a report with suggested optimizations..."
                className="w-full h-32 p-4 rounded-xl text-sm resize-none"
                style={{
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border-default)',
                  color: 'var(--text-primary)',
                }}
              />

              <div className="flex items-center justify-between mt-4">
                <button
                  onClick={() => setShowGitHub(true)}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm"
                  style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)' }}
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
                  </svg>
                  {connectedRepo ? 'Change Repository' : 'Connect GitHub'}
                </button>

                <button
                  onClick={handleGeneratePlan}
                  disabled={!prompt.trim() || isGenerating}
                  className="px-5 py-2.5 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50"
                  style={{ background: 'var(--accent)', color: 'white' }}
                >
                  {isGenerating ? (
                    <>
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Generating Plan...
                    </>
                  ) : (
                    <>
                      Generate Plan
                      <span>→</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Example Prompts */}
            <div>
              <div className="text-xs font-medium uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>
                Example Agents
              </div>
              <div className="grid grid-cols-2 gap-3">
                {EXAMPLE_PROMPTS.map((example, i) => (
                  <button
                    key={i}
                    onClick={() => setPrompt(example.prompt)}
                    className="p-4 rounded-xl text-left card-interactive"
                    style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-lg">{example.icon}</span>
                      <span className="font-medium text-sm">{example.title}</span>
                    </div>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {example.prompt}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          /* Plan Review Phase */
          <div className="space-y-6">
            {/* Plan Header */}
            <div className="rounded-2xl p-6" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="text-xl font-semibold mb-1">{plan.name}</h2>
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{plan.description}</p>
                </div>
                <button
                  onClick={() => setPlan(null)}
                  className="text-sm px-3 py-1.5 rounded-lg"
                  style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}
                >
                  ← Edit Prompt
                </button>
              </div>

              <div className="flex gap-6 text-sm">
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Tasks: </span>
                  <span className="font-mono font-semibold">{plan.tasks.length}</span>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Est. Cost: </span>
                  <span className="font-mono font-semibold">${plan.estimatedCost.toFixed(4)}</span>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Checkpoints: </span>
                  <span className="font-mono font-semibold">{plan.tasks.filter(t => t.hasCheckpoint).length}</span>
                </div>
              </div>
            </div>

            {/* Task List */}
            <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
              <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Execution Plan</span>
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Click tasks to edit</span>
                </div>
              </div>

              <div className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
                {plan.tasks.map((task, index) => (
                  <div
                    key={task.id}
                    className="p-4 hover:bg-[var(--bg-elevated)] transition-colors"
                  >
                    <div className="flex items-start gap-4">
                      {/* Step Number */}
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-sm font-mono font-semibold"
                        style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
                        {index + 1}
                      </div>

                      {/* Task Details */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span>{TASK_TYPE_ICONS[task.type] || TASK_TYPE_ICONS.default}</span>
                          <span className="font-medium">{task.name}</span>
                          <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
                            {task.type}
                          </span>
                        </div>
                        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{task.description}</p>

                        {task.dependsOn.length > 0 && (
                          <div className="flex items-center gap-1 mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                            <span>Depends on:</span>
                            {task.dependsOn.map(dep => (
                              <span key={dep} className="px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-elevated)' }}>
                                {plan.tasks.find(t => t.id === dep)?.name || dep}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => toggleTaskCheckpoint(task.id)}
                          className={`px-2 py-1 rounded text-xs ${task.hasCheckpoint ? 'bg-green-500/20 text-green-400' : ''}`}
                          style={!task.hasCheckpoint ? { background: 'var(--bg-elevated)', color: 'var(--text-muted)' } : {}}
                          title={task.hasCheckpoint ? 'Checkpoint enabled' : 'Add checkpoint'}
                        >
                          {task.hasCheckpoint ? '💾 Checkpoint' : '+ Checkpoint'}
                        </button>
                        <button
                          onClick={() => removeTask(task.id)}
                          className="p-1.5 rounded hover:bg-red-500/10"
                          style={{ color: 'var(--text-muted)' }}
                          title="Remove task"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Run Button */}
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setPlan(null)}
                className="px-5 py-2.5 rounded-lg text-sm font-medium"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)' }}
              >
                Cancel
              </button>
              <button
                onClick={handleRunAgent}
                disabled={isRunning || plan.tasks.length === 0}
                className="px-6 py-2.5 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50"
                style={{ background: 'var(--accent)', color: 'white' }}
              >
                {isRunning ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Starting Agent...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Run Agent
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* GitHub Modal */}
        {showGitHub && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
            <div className="w-full max-w-md rounded-2xl p-6" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)' }}>
              <h3 className="text-lg font-semibold mb-4">Connect GitHub Repository</h3>

              <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
                Connect a repository to give your agent access to your codebase.
              </p>

              <input
                type="text"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                placeholder="https://github.com/username/repo"
                className="w-full px-4 py-2.5 rounded-lg text-sm mb-4"
                style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-default)' }}
              />

              <div className="flex justify-end gap-3">
                <button
                  onClick={() => { setShowGitHub(false); setRepoUrl(''); }}
                  className="px-4 py-2 rounded-lg text-sm"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleConnectGitHub}
                  disabled={!repoUrl.trim() || isConnecting}
                  className="px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
                  style={{ background: 'var(--accent)', color: 'white' }}
                >
                  {isConnecting ? 'Connecting...' : 'Connect'}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// Mock plan generator - in production, this calls AI
function generateMockPlan(prompt: string, repo: string | null): AgentPlan {
  const lowerPrompt = prompt.toLowerCase();

  if (lowerPrompt.includes('refactor') || lowerPrompt.includes('callback') || lowerPrompt.includes('async')) {
    return {
      name: 'Code Refactoring Agent',
      description: 'Converts callback-based code to modern async/await patterns',
      estimatedCost: 0.0045,
      estimatedTime: '2-5 min',
      tasks: [
        { id: '1', name: 'Scan Codebase', type: 'analyze', description: 'Identify all files with callback patterns', dependsOn: [], hasCheckpoint: true },
        { id: '2', name: 'Parse AST', type: 'analyze', description: 'Build abstract syntax tree for each file', dependsOn: ['1'], hasCheckpoint: false },
        { id: '3', name: 'Refactor File 1', type: 'process', description: 'Convert callbacks to async/await', dependsOn: ['2'], hasCheckpoint: true },
        { id: '4', name: 'Refactor File 2', type: 'process', description: 'Convert callbacks to async/await', dependsOn: ['2'], hasCheckpoint: true },
        { id: '5', name: 'Refactor File 3', type: 'process', description: 'Convert callbacks to async/await', dependsOn: ['2'], hasCheckpoint: true },
        { id: '6', name: 'Run Linter', type: 'validate', description: 'Check refactored code for issues', dependsOn: ['3', '4', '5'], hasCheckpoint: false },
        { id: '7', name: 'Run Tests', type: 'validate', description: 'Verify functionality is preserved', dependsOn: ['6'], hasCheckpoint: true },
      ],
    };
  }

  if (lowerPrompt.includes('document') || lowerPrompt.includes('api')) {
    return {
      name: 'Documentation Generator',
      description: 'Generates comprehensive API documentation from code',
      estimatedCost: 0.0032,
      estimatedTime: '1-3 min',
      tasks: [
        { id: '1', name: 'Find Source Files', type: 'analyze', description: 'Locate all TypeScript/JavaScript files', dependsOn: [], hasCheckpoint: true },
        { id: '2', name: 'Extract Functions', type: 'analyze', description: 'Parse and identify all exported functions', dependsOn: ['1'], hasCheckpoint: true },
        { id: '3', name: 'Generate Descriptions', type: 'generate', description: 'AI-generate descriptions for each function', dependsOn: ['2'], hasCheckpoint: true },
        { id: '4', name: 'Generate Examples', type: 'generate', description: 'Create usage examples', dependsOn: ['2'], hasCheckpoint: true },
        { id: '5', name: 'Compile Documentation', type: 'process', description: 'Assemble final markdown documentation', dependsOn: ['3', '4'], hasCheckpoint: false },
      ],
    };
  }

  if (lowerPrompt.includes('security') || lowerPrompt.includes('vulnerability') || lowerPrompt.includes('audit')) {
    return {
      name: 'Security Audit Agent',
      description: 'Scans codebase for security vulnerabilities',
      estimatedCost: 0.0058,
      estimatedTime: '3-8 min',
      tasks: [
        { id: '1', name: 'Inventory Dependencies', type: 'analyze', description: 'List all npm packages and versions', dependsOn: [], hasCheckpoint: true },
        { id: '2', name: 'Check CVE Database', type: 'fetch', description: 'Query known vulnerabilities for each package', dependsOn: ['1'], hasCheckpoint: true },
        { id: '3', name: 'Static Analysis', type: 'analyze', description: 'Scan code for common vulnerability patterns', dependsOn: [], hasCheckpoint: true },
        { id: '4', name: 'Check Secrets', type: 'analyze', description: 'Detect hardcoded credentials or API keys', dependsOn: [], hasCheckpoint: false },
        { id: '5', name: 'Generate Report', type: 'generate', description: 'Create detailed security report with fixes', dependsOn: ['2', '3', '4'], hasCheckpoint: true },
      ],
    };
  }

  // Default generic plan
  return {
    name: 'Custom Agent',
    description: prompt.slice(0, 100),
    estimatedCost: 0.0025,
    estimatedTime: '1-5 min',
    tasks: [
      { id: '1', name: 'Analyze Request', type: 'analyze', description: 'Understand the task requirements', dependsOn: [], hasCheckpoint: true },
      { id: '2', name: 'Gather Data', type: 'fetch', description: 'Collect necessary information', dependsOn: ['1'], hasCheckpoint: true },
      { id: '3', name: 'Process Data', type: 'process', description: 'Execute the main task logic', dependsOn: ['2'], hasCheckpoint: true },
      { id: '4', name: 'Validate Results', type: 'validate', description: 'Verify output correctness', dependsOn: ['3'], hasCheckpoint: false },
      { id: '5', name: 'Generate Output', type: 'generate', description: 'Create final deliverable', dependsOn: ['4'], hasCheckpoint: true },
    ],
  };
}
