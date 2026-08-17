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
function AnimatedNumber({ value, className = '', style }: { value: number; className?: string; style?: React.CSSProperties }) {
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

  return <span className={className} style={style}>{displayValue}</span>;
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
            <Link href="/create" className="text-xs px-3 py-1.5 rounded-lg font-medium" style={{ background: 'var(--accent)', color: 'white' }}>
              + New Agent
            </Link>
            <Link href="/monitor" className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Monitor
            </Link>
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
                  <div className="flex-1 mr-6">
                    <div className="flex items-center gap-3 mb-2">
                      <h1 className="text-lg font-medium" style={{ color: 'var(--text-primary)' }}>{selectedJob.name}</h1>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        selectedJob.status === 'running' ? 'bg-blue-500/20 text-blue-400' :
                        selectedJob.status === 'completed' ? 'bg-green-500/20 text-green-400' :
                        selectedJob.status === 'failed' ? 'bg-red-500/20 text-red-400' :
                        'bg-zinc-500/20 text-zinc-400'
                      }`}>
                        {selectedJob.status === 'running' && <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 mr-1.5 animate-pulse"></span>}
                        {selectedJob.status}
                      </span>
                    </div>

                    {/* Progress bar */}
                    <div className="flex items-center gap-3">
                      <ProgressBar value={stats.done} max={stats.total} className="flex-1 max-w-xs" />
                      <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                        {stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0}%
                      </span>
                      <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                        {selectedJob.id.slice(0, 8)}
                      </span>
                    </div>
                  </div>

                  {/* Stats & Actions */}
                  <div className="flex items-center gap-4">
                    {/* Cost Badge */}
                    {costData && (
                      <div className="px-3 py-2 rounded-lg" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                        <div className="flex items-baseline gap-1">
                          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>$</span>
                          <span className="text-lg font-semibold font-mono" style={{ color: 'var(--text-primary)' }}>
                            {costData.summary.estimatedCostUsd.toFixed(4)}
                          </span>
                        </div>
                        {costData.summary.savedByRecoveryUsd > 0 && (
                          <div className="text-xs flex items-center gap-1" style={{ color: 'var(--success)' }}>
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                            </svg>
                            saved ${costData.summary.savedByRecoveryUsd.toFixed(4)}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Stats pills */}
                    <div className="flex items-center gap-2">
                      <div className="px-3 py-1.5 rounded-lg text-center" style={{ background: 'var(--bg-elevated)' }}>
                        <AnimatedNumber value={stats.done} className="text-lg font-semibold font-mono" />
                        <span className="text-xs ml-1" style={{ color: 'var(--text-muted)' }}>done</span>
                      </div>
                      {stats.running > 0 && (
                        <div className="px-3 py-1.5 rounded-lg text-center" style={{ background: 'rgba(59, 130, 246, 0.1)' }}>
                          <AnimatedNumber value={stats.running} className="text-lg font-semibold font-mono" style={{ color: 'var(--accent)' }} />
                          <span className="text-xs ml-1" style={{ color: 'var(--accent)' }}>running</span>
                        </div>
                      )}
                      {stats.pending > 0 && (
                        <div className="px-3 py-1.5 rounded-lg text-center" style={{ background: 'var(--bg-elevated)' }}>
                          <span className="text-lg font-semibold font-mono" style={{ color: 'var(--text-muted)' }}>{stats.pending}</span>
                          <span className="text-xs ml-1" style={{ color: 'var(--text-muted)' }}>pending</span>
                        </div>
                      )}
                      {stats.failed > 0 && (
                        <div className="px-3 py-1.5 rounded-lg text-center" style={{ background: 'rgba(239, 68, 68, 0.1)' }}>
                          <AnimatedNumber value={stats.failed} className="text-lg font-semibold font-mono" style={{ color: 'var(--error)' }} />
                          <span className="text-xs ml-1" style={{ color: 'var(--error)' }}>failed</span>
                        </div>
                      )}
                    </div>

                    {/* View Mode Toggle */}
                    <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--border-default)' }}>
                      <button
                        onClick={() => setViewMode('graph')}
                        className="px-3 py-1.5 text-xs font-medium"
                        style={{
                          background: viewMode === 'graph' ? 'var(--bg-elevated)' : 'transparent',
                          color: viewMode === 'graph' ? 'var(--text-primary)' : 'var(--text-muted)',
                        }}
                      >
                        Graph
                      </button>
                      <button
                        onClick={() => setViewMode('list')}
                        className="px-3 py-1.5 text-xs font-medium"
                        style={{
                          background: viewMode === 'list' ? 'var(--bg-elevated)' : 'transparent',
                          color: viewMode === 'list' ? 'var(--text-primary)' : 'var(--text-muted)',
                        }}
                      >
                        List
                      </button>
                    </div>

                    {/* Time Travel Toggle */}
                    <button
                      onClick={() => setShowCheckpoints(!showCheckpoints)}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5"
                      style={{
                        background: showCheckpoints ? 'var(--accent)' : 'var(--bg-elevated)',
                        color: showCheckpoints ? 'white' : 'var(--text-secondary)',
                        border: showCheckpoints ? 'none' : '1px solid var(--border-default)',
                      }}
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
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

              {/* Graph or List View */}
              <div className="flex-1 min-h-0 p-4">
                {viewMode === 'graph' ? (
                  <div className="h-full rounded-lg overflow-hidden" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)' }}>
                    <TaskGraph
                      tasks={tasks}
                      onTaskClick={setSelectedTask}
                      onKillWorker={handleKillWorker}
                    />
                  </div>
                ) : (
                  <div className="h-full rounded-lg overflow-auto" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)' }}>
                    <table className="w-full text-sm">
                      <thead className="sticky top-0" style={{ background: 'var(--bg-secondary)' }}>
                        <tr className="border-b" style={{ borderColor: 'var(--border-subtle)' }}>
                          <th className="text-left p-3 font-medium" style={{ color: 'var(--text-muted)' }}>Task</th>
                          <th className="text-left p-3 font-medium" style={{ color: 'var(--text-muted)' }}>Type</th>
                          <th className="text-left p-3 font-medium" style={{ color: 'var(--text-muted)' }}>Status</th>
                          <th className="text-left p-3 font-medium" style={{ color: 'var(--text-muted)' }}>Attempts</th>
                          <th className="text-left p-3 font-medium" style={{ color: 'var(--text-muted)' }}>Worker</th>
                          <th className="text-right p-3 font-medium" style={{ color: 'var(--text-muted)' }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tasks.map((task) => (
                          <tr
                            key={task.id}
                            className="border-b cursor-pointer hover:bg-[var(--bg-elevated)]"
                            style={{ borderColor: 'var(--border-subtle)' }}
                            onClick={() => setSelectedTask(task)}
                          >
                            <td className="p-3">
                              <div className="flex items-center gap-2">
                                <span className={`status-dot ${task.status === 'running' || task.status === 'claimed' ? 'running' : task.status === 'done' ? 'success' : task.status === 'failed' ? 'error' : 'pending'}`}></span>
                                <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{task.name}</span>
                              </div>
                            </td>
                            <td className="p-3 font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{task.task_type}</td>
                            <td className="p-3">
                              <span className={`text-xs px-2 py-0.5 rounded-full ${
                                task.status === 'running' || task.status === 'claimed' ? 'bg-blue-500/20 text-blue-400' :
                                task.status === 'done' ? 'bg-green-500/20 text-green-400' :
                                task.status === 'failed' ? 'bg-red-500/20 text-red-400' :
                                'bg-zinc-500/20 text-zinc-400'
                              }`}>
                                {task.status}
                              </span>
                            </td>
                            <td className="p-3 font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
                              {task.attempt_count}/{task.max_attempts}
                            </td>
                            <td className="p-3 font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
                              {task.claimed_by ? task.claimed_by.slice(0, 8) + '...' : '-'}
                            </td>
                            <td className="p-3 text-right">
                              {(task.status === 'running' || task.status === 'claimed') && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleKillWorker(task.id); }}
                                  className="text-xs px-2 py-1 rounded"
                                  style={{ background: 'rgba(239, 68, 68, 0.1)', color: 'var(--error)' }}
                                >
                                  Kill
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
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
          <aside className="w-96 flex-shrink-0 border-l overflow-y-auto" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-secondary)' }}>
            <div className="p-4">
              {/* Header */}
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  Task Details
                </span>
                <button
                  onClick={() => setSelectedTask(null)}
                  className="p-1.5 rounded-lg hover:bg-[var(--bg-elevated)]"
                  style={{ color: 'var(--text-muted)' }}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Task Header */}
              <div className="p-4 rounded-xl mb-4" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                <div className="flex items-start gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    selectedTask.status === 'running' || selectedTask.status === 'claimed' ? 'bg-blue-500/20' :
                    selectedTask.status === 'done' ? 'bg-green-500/20' :
                    selectedTask.status === 'failed' ? 'bg-red-500/20' : 'bg-zinc-500/20'
                  }`}>
                    {selectedTask.status === 'running' || selectedTask.status === 'claimed' ? (
                      <svg className="w-5 h-5 text-blue-400 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                    ) : selectedTask.status === 'done' ? (
                      <svg className="w-5 h-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : selectedTask.status === 'failed' ? (
                      <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{selectedTask.name}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs font-mono px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>
                        {selectedTask.task_type}
                      </span>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                        selectedTask.status === 'running' || selectedTask.status === 'claimed' ? 'bg-blue-500/20 text-blue-400' :
                        selectedTask.status === 'done' ? 'bg-green-500/20 text-green-400' :
                        selectedTask.status === 'failed' ? 'bg-red-500/20 text-red-400' :
                        'bg-zinc-500/20 text-zinc-400'
                      }`}>
                        {selectedTask.status}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-2 gap-2 mb-4">
                <div className="p-3 rounded-lg" style={{ background: 'var(--bg-elevated)' }}>
                  <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Attempts</div>
                  <div className="font-mono font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {selectedTask.attempt_count} / {selectedTask.max_attempts}
                  </div>
                </div>
                <div className="p-3 rounded-lg" style={{ background: 'var(--bg-elevated)' }}>
                  <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Task ID</div>
                  <div className="font-mono text-xs truncate" style={{ color: 'var(--text-primary)' }}>
                    {selectedTask.id.slice(0, 12)}...
                  </div>
                </div>
              </div>

              {/* Worker Info */}
              {selectedTask.claimed_by && (
                <div className="p-3 rounded-lg mb-4" style={{ background: 'var(--bg-elevated)' }}>
                  <div className="flex items-center gap-2 mb-1">
                    <svg className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                    <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Worker</span>
                  </div>
                  <div className="font-mono text-sm" style={{ color: 'var(--text-primary)' }}>
                    {selectedTask.claimed_by}
                  </div>
                </div>
              )}

              {/* Chaos: Kill Worker Button */}
              {(selectedTask.status === 'running' || selectedTask.status === 'claimed') && (
                <button
                  onClick={() => handleKillWorker(selectedTask.id)}
                  className="w-full py-2.5 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2 hover:scale-[0.98] active:scale-[0.96]"
                  style={{ background: 'rgba(239, 68, 68, 0.1)', color: 'var(--error)', border: '1px solid rgba(239, 68, 68, 0.2)' }}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Simulate Crash (Chaos Test)
                </button>
              )}

              {/* Error Message */}
              {selectedTask.error_message && (
                <div className="mt-4 p-3 rounded-lg" style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                  <div className="flex items-center gap-2 mb-2">
                    <svg className="w-4 h-4" style={{ color: 'var(--error)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="text-xs font-medium" style={{ color: 'var(--error)' }}>Error</span>
                  </div>
                  <div className="text-xs font-mono" style={{ color: 'var(--error)' }}>
                    {selectedTask.error_message}
                  </div>
                </div>
              )}

              {/* Output */}
              {selectedTask.output_payload && (
                <div className="mt-4">
                  <div className="flex items-center gap-2 mb-2">
                    <svg className="w-4 h-4" style={{ color: 'var(--success)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Output</span>
                  </div>
                  <pre className="p-3 rounded-lg text-xs font-mono overflow-x-auto max-h-64" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}>
                    {JSON.stringify(selectedTask.output_payload, null, 2)}
                  </pre>
                </div>
              )}

              {/* Input Payload */}
              {selectedTask.input_payload && (
                <div className="mt-4">
                  <div className="flex items-center gap-2 mb-2">
                    <svg className="w-4 h-4" style={{ color: 'var(--text-muted)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                    <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Input</span>
                  </div>
                  <pre className="p-3 rounded-lg text-xs font-mono overflow-x-auto max-h-48" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}>
                    {JSON.stringify(selectedTask.input_payload, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
