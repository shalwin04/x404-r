'use client';

import React, { useState, useCallback, useEffect } from 'react';
import useSWR from 'swr';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { Job, TaskNode, JobResponse, JobStats } from '@/lib/types';
import * as api from '@/lib/api';

// Dynamic import for React Flow
const TaskGraph = dynamic(() => import('@/components/TaskGraph'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center">
      <div className="text-[var(--text-muted)] text-sm">Loading graph...</div>
    </div>
  ),
});

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

const fetcher = async (url: string) => {
  const headers: Record<string, string> = {};
  const apiKey = api.getStoredApiKey();
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }
  const res = await fetch(url, { headers });
  if (res.status === 401) {
    api.clearStoredApiKey();
    throw new Error('Authentication required');
  }
  if (res.status === 429) {
    throw new Error('Rate limit exceeded');
  }
  if (!res.ok) throw new Error('Failed to fetch');
  return res.json();
};

// Progress bar component
function ProgressBar({ value, max, className = '' }: { value: number; max: number; className?: string }) {
  const percentage = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className={`h-1.5 rounded-full overflow-hidden ${className}`} style={{ background: 'var(--bg-elevated)' }}>
      <div
        className="h-full rounded-full transition-all duration-500 ease-out"
        style={{
          width: `${percentage}%`,
          background: percentage === 100 ? 'var(--success)' : 'var(--accent)'
        }}
      />
    </div>
  );
}

// Animated counter component
function AnimatedNumber({ value, className = '' }: { value: number; className?: string }) {
  const [displayValue, setDisplayValue] = useState(value);

  useEffect(() => {
    const duration = 300;
    const start = displayValue;
    const diff = value - start;
    const startTime = performance.now();

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      setDisplayValue(Math.round(start + diff * progress));
      if (progress < 1) requestAnimationFrame(animate);
    };

    requestAnimationFrame(animate);
  }, [value]);

  return <span className={className}>{displayValue}</span>;
}

export default function Dashboard() {
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<TaskNode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCheckpoints, setShowCheckpoints] = useState(false);
  const [viewMode, setViewMode] = useState<'graph' | 'list'>('graph');

  const { data: jobsData, mutate: mutateJobs } = useSWR<{ jobs: Job[] }>(
    `${API_BASE}/jobs`,
    fetcher,
    { refreshInterval: 2000, onError: (err) => setError(err.message) }
  );

  const { data: jobData, mutate: mutateJob } = useSWR<JobResponse>(
    selectedJobId ? `${API_BASE}/jobs/${selectedJobId}` : null,
    fetcher,
    { refreshInterval: 1000 }
  );

  const { data: checkpointsData } = useSWR<api.CheckpointsResponse>(
    selectedJobId && showCheckpoints ? `${API_BASE}/jobs/${selectedJobId}/checkpoints` : null,
    fetcher
  );

  const { data: costData } = useSWR<api.JobCostResponse>(
    selectedJobId ? `${API_BASE}/jobs/${selectedJobId}/cost` : null,
    fetcher
  );

  const jobs = jobsData?.jobs || [];
  const tasks = jobData?.tasks || [];
  const stats: JobStats = jobData?.stats || { total: 0, done: 0, failed: 0, pending: 0, running: 0 };
  const selectedJob = jobs.find(j => j.id === selectedJobId);

  const handleCreateDemo = useCallback(async () => {
    try {
      setError(null);
      const result = await api.createDemoJob();
      setSelectedJobId(result.jobId);
      mutateJobs();
    } catch (error) {
      setError(error instanceof api.ApiError ? error.message : 'Failed to create job');
    }
  }, [mutateJobs]);

  const handleKillWorker = useCallback(async (taskId: string) => {
    try {
      await api.killWorker(taskId);
      mutateJob();
    } catch (error) {
      console.error('Failed to kill worker:', error);
    }
  }, [mutateJob]);

  const handleReplay = useCallback(async (checkpointId: string) => {
    if (!selectedJobId) return;
    try {
      const result = await api.replayFromCheckpoint(selectedJobId, { checkpointId });
      setSelectedJobId(result.replayJobId);
      mutateJobs();
    } catch (error) {
      setError(error instanceof api.ApiError ? error.message : 'Failed to replay');
    }
  }, [selectedJobId, mutateJobs]);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-primary)' }}>
      {/* Header */}
      <header className="flex-shrink-0 border-b glass" style={{ borderColor: 'var(--border-subtle)' }}>
        <div className="h-14 px-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-2">
              <span className="text-lg font-semibold tracking-tight" style={{ color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
                x404-r
              </span>
              <span className="text-xs px-1.5 py-0.5 rounded font-mono" style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
                dashboard
              </span>
            </Link>
          </div>

          <div className="flex items-center gap-4">
            <Link href="/usage" className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Usage
            </Link>
            <Link href="/settings" className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Settings
            </Link>
            <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
              <span className="status-dot running"></span>
              <span>Live</span>
            </div>
          </div>
        </div>
      </header>

      {/* Error Banner */}
      {error && (
        <div className="flex-shrink-0 px-4 py-2 flex items-center justify-between" style={{ background: 'rgba(239, 68, 68, 0.1)', borderBottom: '1px solid rgba(239, 68, 68, 0.2)' }}>
          <span className="text-sm" style={{ color: 'var(--error)' }}>{error}</span>
          <button onClick={() => setError(null)} className="p-1 hover:opacity-70" style={{ color: 'var(--error)' }}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex min-h-0">
        {/* Sidebar */}
        <aside className="w-64 flex-shrink-0 border-r flex flex-col" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-secondary)' }}>
          <div className="p-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--border-subtle)' }}>
            <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)', letterSpacing: '0.05em' }}>
              Workflows
            </span>
            <button
              onClick={handleCreateDemo}
              className="text-xs px-2.5 py-1.5 rounded-md font-medium"
              style={{ background: 'var(--accent)', color: 'white' }}
            >
              + Demo
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {jobs.length === 0 ? (
              <div className="p-4 text-center animate-fade-in">
                <div className="text-sm mb-1" style={{ color: 'var(--text-muted)' }}>No workflows yet</div>
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Create a demo to get started</div>
              </div>
            ) : (
              <div className="space-y-1 stagger-enter">
                {jobs.map(job => (
                  <button
                    key={job.id}
                    onClick={() => setSelectedJobId(job.id)}
                    className="w-full text-left p-2.5 rounded-lg animate-fade-in"
                    style={{
                      background: selectedJobId === job.id ? 'var(--bg-elevated)' : 'transparent',
                      border: selectedJobId === job.id ? '1px solid var(--border-default)' : '1px solid transparent',
                    }}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`status-dot ${job.status === 'running' ? 'running' : job.status === 'completed' ? 'success' : job.status === 'failed' ? 'error' : 'pending'}`}></span>
                      <span className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                        {job.name}
                      </span>
                    </div>
                    <div className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                      {new Date(job.created_at).toLocaleTimeString()}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>

        {/* Main Area */}
        <main className="flex-1 flex flex-col min-w-0">
          {selectedJobId && selectedJob ? (
            <>
              {/* Job Header */}
              <div className="flex-shrink-0 p-4 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
                <div className="flex items-start justify-between">
                  <div>
                    <h1 className="text-lg font-medium" style={{ color: 'var(--text-primary)' }}>{selectedJob.name}</h1>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                        {selectedJob.id.slice(0, 8)}
                      </span>
                      <span className={`text-xs px-1.5 py-0.5 rounded ${
                        selectedJob.status === 'running' ? 'bg-blue-500/20 text-blue-400' :
                        selectedJob.status === 'completed' ? 'bg-green-500/20 text-green-400' :
                        selectedJob.status === 'failed' ? 'bg-red-500/20 text-red-400' :
                        'bg-zinc-500/20 text-zinc-400'
                      }`}>
                        {selectedJob.status}
                      </span>
                    </div>
                  </div>

                  {/* Stats & Actions */}
                  <div className="flex items-center gap-6">
                    {/* Cost Badge */}
                    {costData && (
                      <div className="text-right">
                        <div className="text-lg font-semibold font-mono" style={{ color: 'var(--text-primary)' }}>
                          ${costData.summary.estimatedCostUsd.toFixed(4)}
                        </div>
                        <div className="text-xs" style={{ color: 'var(--success)' }}>
                          saved ${costData.summary.savedByRecoveryUsd.toFixed(4)}
                        </div>
                      </div>
                    )}

                    <div className="flex items-center gap-4">
                      <div className="text-center">
                        <div className="text-xl font-semibold font-mono" style={{ color: 'var(--text-primary)' }}>{stats.done}</div>
                        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>done</div>
                      </div>
                      <div className="text-center">
                        <div className="text-xl font-semibold font-mono" style={{ color: 'var(--accent)' }}>{stats.running}</div>
                        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>running</div>
                      </div>
                      <div className="text-center">
                        <div className="text-xl font-semibold font-mono" style={{ color: 'var(--text-muted)' }}>{stats.pending}</div>
                        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>pending</div>
                      </div>
                      {stats.failed > 0 && (
                        <div className="text-center">
                          <div className="text-xl font-semibold font-mono" style={{ color: 'var(--error)' }}>{stats.failed}</div>
                          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>failed</div>
                        </div>
                      )}
                    </div>

                    {/* Time Travel Toggle */}
                    <button
                      onClick={() => setShowCheckpoints(!showCheckpoints)}
                      className="px-3 py-1.5 rounded-md text-xs font-medium"
                      style={{
                        background: showCheckpoints ? 'var(--accent)' : 'var(--bg-elevated)',
                        color: showCheckpoints ? 'white' : 'var(--text-secondary)',
                        border: showCheckpoints ? 'none' : '1px solid var(--border-default)',
                      }}
                    >
                      Time Travel
                    </button>
                  </div>
                </div>

                {/* Checkpoints Panel */}
                {showCheckpoints && checkpointsData && (
                  <div className="mt-4 p-4 rounded-lg" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-medium">Checkpoints ({checkpointsData.count})</h3>
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Click to replay from checkpoint</span>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      {checkpointsData.checkpoints.map((cp) => (
                        <button
                          key={cp.id}
                          onClick={() => handleReplay(cp.id)}
                          className="px-3 py-2 rounded-lg text-xs font-mono card-interactive"
                          style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)' }}
                        >
                          <div style={{ color: 'var(--text-primary)' }}>{cp.taskName}</div>
                          <div style={{ color: 'var(--text-muted)' }}>Step {cp.stepNumber}</div>
                        </button>
                      ))}
                      {checkpointsData.checkpoints.length === 0 && (
                        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>No checkpoints yet</div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Graph */}
              <div className="flex-1 min-h-0 p-4">
                <div className="h-full rounded-lg overflow-hidden" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)' }}>
                  <TaskGraph
                    tasks={tasks}
                    onTaskClick={setSelectedTask}
                    onKillWorker={handleKillWorker}
                  />
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center max-w-md px-4 animate-fade-in">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-6" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                  <svg className="w-8 h-8" style={{ color: 'var(--text-muted)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <h2 className="text-xl font-medium mb-2" style={{ color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
                  Select a workflow
                </h2>
                <p className="text-sm mb-6 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                  Select a workflow from the sidebar or create a demo to visualize crash-proof agent execution.
                </p>
                <button
                  onClick={handleCreateDemo}
                  className="px-5 py-2.5 rounded-lg text-sm font-medium"
                  style={{ background: 'var(--accent)', color: 'white' }}
                >
                  Create Demo Workflow
                </button>
              </div>
            </div>
          )}
        </main>

        {/* Right Panel - Task Details */}
        {selectedTask && (
          <aside className="w-80 flex-shrink-0 border-l overflow-y-auto" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-secondary)' }}>
            <div className="p-4">
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  Task Details
                </span>
                <button
                  onClick={() => setSelectedTask(null)}
                  className="p-1 rounded hover:opacity-70"
                  style={{ color: 'var(--text-muted)' }}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`status-dot ${selectedTask.status === 'running' || selectedTask.status === 'claimed' ? 'running' : selectedTask.status === 'done' ? 'success' : selectedTask.status === 'failed' ? 'error' : 'pending'}`}></span>
                    <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{selectedTask.name}</span>
                  </div>
                  <div className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{selectedTask.task_type}</div>
                </div>

                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span style={{ color: 'var(--text-muted)' }}>Status</span>
                    <span className="font-mono" style={{ color: 'var(--text-primary)' }}>{selectedTask.status}</span>
                  </div>
                  <div className="flex justify-between">
                    <span style={{ color: 'var(--text-muted)' }}>Attempts</span>
                    <span className="font-mono" style={{ color: 'var(--text-primary)' }}>{selectedTask.attempt_count}/{selectedTask.max_attempts}</span>
                  </div>
                  {selectedTask.claimed_by && (
                    <div className="flex justify-between">
                      <span style={{ color: 'var(--text-muted)' }}>Worker</span>
                      <span className="font-mono text-xs" style={{ color: 'var(--text-primary)' }}>{selectedTask.claimed_by.slice(0, 12)}...</span>
                    </div>
                  )}
                </div>

                {/* Chaos: Kill Worker Button */}
                {(selectedTask.status === 'running' || selectedTask.status === 'claimed') && (
                  <button
                    onClick={() => handleKillWorker(selectedTask.id)}
                    className="w-full py-2 rounded-md text-sm font-medium transition-colors"
                    style={{ background: 'rgba(239, 68, 68, 0.1)', color: 'var(--error)', border: '1px solid rgba(239, 68, 68, 0.2)' }}
                  >
                    Simulate Crash
                  </button>
                )}

                {/* Error Message */}
                {selectedTask.error_message && (
                  <div className="p-3 rounded-md text-xs font-mono" style={{ background: 'rgba(239, 68, 68, 0.1)', color: 'var(--error)' }}>
                    {selectedTask.error_message}
                  </div>
                )}

                {/* Output */}
                {selectedTask.output_payload && (
                  <div>
                    <div className="text-xs font-medium uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>Output</div>
                    <pre className="p-3 rounded-md text-xs font-mono overflow-x-auto" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
                      {JSON.stringify(selectedTask.output_payload, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
