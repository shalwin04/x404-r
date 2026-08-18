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
      <div className="flex items-center gap-3">
        <div className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }}></div>
        <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading visualization...</span>
      </div>
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

// Enhanced Progress Ring
function ProgressRing({ value, size = 44, strokeWidth = 4 }: { value: number; size?: number; strokeWidth?: number }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (value / 100) * circumference;

  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--bg-elevated)"
        strokeWidth={strokeWidth}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={value === 100 ? 'var(--success)' : 'var(--accent)'}
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        className="transition-all duration-500"
      />
    </svg>
  );
}

// Status indicator with animation
function StatusIndicator({ status }: { status: string }) {
  const config: Record<string, { bg: string; color: string; pulse: boolean }> = {
    running: { bg: 'rgba(59, 130, 246, 0.15)', color: '#3b82f6', pulse: true },
    completed: { bg: 'rgba(34, 197, 94, 0.15)', color: '#22c55e', pulse: false },
    failed: { bg: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', pulse: false },
    pending: { bg: 'rgba(113, 113, 122, 0.15)', color: '#71717a', pulse: false },
    claimed: { bg: 'rgba(59, 130, 246, 0.15)', color: '#3b82f6', pulse: true },
    done: { bg: 'rgba(34, 197, 94, 0.15)', color: '#22c55e', pulse: false },
  };
  const { bg, color, pulse } = config[status] || config.pending;

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${pulse ? 'animate-pulse' : ''}`}
      style={{ background: bg, color }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }}></span>
      {status}
    </span>
  );
}

// Stat Card Component
function StatCard({ label, value, icon, trend, color = 'var(--text-primary)' }: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  trend?: { value: number; label: string };
  color?: string;
}) {
  return (
    <div className="p-4 rounded-xl" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
      <div className="flex items-start justify-between mb-3">
        <div className="p-2 rounded-lg" style={{ background: 'var(--bg-elevated)' }}>
          {icon}
        </div>
        {trend && (
          <span className={`text-xs font-medium ${trend.value >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {trend.value >= 0 ? '+' : ''}{trend.value}%
          </span>
        )}
      </div>
      <div className="text-2xl font-semibold font-mono mb-1" style={{ color }}>{value}</div>
      <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</div>
    </div>
  );
}

export default function Dashboard() {
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<TaskNode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCheckpoints, setShowCheckpoints] = useState(false);
  const [viewMode, setViewMode] = useState<'graph' | 'list'>('graph');
  const [searchQuery, setSearchQuery] = useState('');

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

  const { data: metricsData } = useSWR<{ metrics: api.MetricsSummary }>(
    `${API_BASE}/metrics`,
    fetcher,
    { refreshInterval: 5000, onError: () => {} }
  );

  const jobs = jobsData?.jobs || [];
  const tasks = jobData?.tasks || [];
  const stats: JobStats = jobData?.stats || { total: 0, done: 0, failed: 0, pending: 0, running: 0 };
  const selectedJob = jobs.find(j => j.id === selectedJobId);
  const metrics = metricsData?.metrics;

  const filteredJobs = jobs.filter(job =>
    job.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    job.id.toLowerCase().includes(searchQuery.toLowerCase())
  );

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

  const progressPercentage = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-primary)' }}>
      {/* Header */}
      <header className="flex-shrink-0 border-b" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-secondary)' }}>
        <div className="h-16 px-6 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--accent)' }}>
                <span className="text-white font-bold text-sm">x4</span>
              </div>
              <span className="text-lg font-semibold" style={{ letterSpacing: '-0.02em' }}>x404-r</span>
            </Link>
            <nav className="flex items-center gap-1">
              <Link href="/dashboard" className="px-3 py-2 rounded-lg text-sm font-medium" style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}>
                Workflows
              </Link>
              <Link href="/monitor" className="px-3 py-2 rounded-lg text-sm font-medium" style={{ color: 'var(--text-muted)' }}>
                Monitor
              </Link>
              <Link href="/usage" className="px-3 py-2 rounded-lg text-sm font-medium" style={{ color: 'var(--text-muted)' }}>
                Usage
              </Link>
            </nav>
          </div>

          <div className="flex items-center gap-4">
            {/* Quick Stats */}
            {metrics && (
              <div className="flex items-center gap-4 px-4 py-2 rounded-lg" style={{ background: 'var(--bg-elevated)' }}>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-green-400"></span>
                  <span className="text-xs font-mono">{metrics.execution.tasksCompleted}</span>
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>completed</span>
                </div>
                <div className="w-px h-4" style={{ background: 'var(--border-subtle)' }}></div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono">${metrics.cost.totalCostUsd.toFixed(4)}</span>
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>spent</span>
                </div>
              </div>
            )}

            <Link href="/create" className="px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2" style={{ background: 'var(--accent)', color: 'white' }}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              New Workflow
            </Link>

            <Link href="/settings" className="p-2 rounded-lg" style={{ color: 'var(--text-muted)' }}>
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </Link>
          </div>
        </div>
      </header>

      {/* Error Banner */}
      {error && (
        <div className="flex-shrink-0 px-6 py-3 flex items-center justify-between" style={{ background: 'rgba(239, 68, 68, 0.1)', borderBottom: '1px solid rgba(239, 68, 68, 0.2)' }}>
          <div className="flex items-center gap-3">
            <svg className="w-5 h-5" style={{ color: 'var(--error)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-sm" style={{ color: 'var(--error)' }}>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="p-1 rounded hover:bg-red-500/20" style={{ color: 'var(--error)' }}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex min-h-0">
        {/* Sidebar */}
        <aside className="w-72 flex-shrink-0 border-r flex flex-col" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-secondary)' }}>
          {/* Search */}
          <div className="p-4 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-muted)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="Search workflows..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 rounded-lg text-sm"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
              />
            </div>
          </div>

          {/* Workflow List */}
          <div className="flex-1 overflow-y-auto p-3">
            {filteredJobs.length === 0 ? (
              <div className="p-6 text-center">
                <div className="w-12 h-12 mx-auto mb-4 rounded-xl flex items-center justify-center" style={{ background: 'var(--bg-elevated)' }}>
                  <svg className="w-6 h-6" style={{ color: 'var(--text-muted)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                </div>
                <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>No workflows yet</p>
                <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>Create your first workflow to get started</p>
                <button
                  onClick={handleCreateDemo}
                  className="px-4 py-2 rounded-lg text-sm font-medium"
                  style={{ background: 'var(--accent)', color: 'white' }}
                >
                  Create Demo
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredJobs.map(job => {
                  const isSelected = selectedJobId === job.id;
                  return (
                    <button
                      key={job.id}
                      onClick={() => setSelectedJobId(job.id)}
                      className="w-full text-left p-3 rounded-xl transition-all"
                      style={{
                        background: isSelected ? 'var(--bg-elevated)' : 'transparent',
                        border: isSelected ? '1px solid var(--border-default)' : '1px solid transparent',
                      }}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                          {job.name}
                        </span>
                        <StatusIndicator status={job.status} />
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                          {job.id.slice(0, 8)}
                        </span>
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          {new Date(job.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Quick Actions */}
          <div className="p-4 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
            <button
              onClick={handleCreateDemo}
              className="w-full py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-2"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Quick Demo
            </button>
          </div>
        </aside>

        {/* Main Area */}
        <main className="flex-1 flex flex-col min-w-0">
          {selectedJobId && selectedJob ? (
            <>
              {/* Job Header */}
              <div className="flex-shrink-0 p-6 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="flex items-center gap-3 mb-2">
                      <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>{selectedJob.name}</h1>
                      <StatusIndicator status={selectedJob.status} />
                    </div>
                    <div className="flex items-center gap-4 text-sm" style={{ color: 'var(--text-muted)' }}>
                      <span className="font-mono">{selectedJob.id.slice(0, 12)}...</span>
                      <span>Created {new Date(selectedJob.created_at).toLocaleString()}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    {/* View Toggle */}
                    <div className="flex rounded-lg p-1" style={{ background: 'var(--bg-elevated)' }}>
                      <button
                        onClick={() => setViewMode('graph')}
                        className="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
                        style={{
                          background: viewMode === 'graph' ? 'var(--bg-primary)' : 'transparent',
                          color: viewMode === 'graph' ? 'var(--text-primary)' : 'var(--text-muted)',
                        }}
                      >
                        Graph
                      </button>
                      <button
                        onClick={() => setViewMode('list')}
                        className="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
                        style={{
                          background: viewMode === 'list' ? 'var(--bg-primary)' : 'transparent',
                          color: viewMode === 'list' ? 'var(--text-primary)' : 'var(--text-muted)',
                        }}
                      >
                        List
                      </button>
                    </div>

                    {/* Time Travel */}
                    <button
                      onClick={() => setShowCheckpoints(!showCheckpoints)}
                      className="px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors"
                      style={{
                        background: showCheckpoints ? 'var(--accent)' : 'var(--bg-elevated)',
                        color: showCheckpoints ? 'white' : 'var(--text-secondary)',
                      }}
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Time Travel
                    </button>
                  </div>
                </div>

                {/* Stats Row */}
                <div className="grid grid-cols-5 gap-4">
                  {/* Progress */}
                  <div className="col-span-2 p-4 rounded-xl flex items-center gap-4" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
                    <div className="relative">
                      <ProgressRing value={progressPercentage} size={56} strokeWidth={5} />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-sm font-semibold font-mono">{progressPercentage}%</span>
                      </div>
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Progress</div>
                      <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-elevated)' }}>
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${progressPercentage}%`, background: progressPercentage === 100 ? 'var(--success)' : 'var(--accent)' }}
                        />
                      </div>
                      <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{stats.done} of {stats.total} tasks</div>
                    </div>
                  </div>

                  {/* Task Stats */}
                  <div className="p-4 rounded-xl text-center" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
                    <div className="text-2xl font-semibold font-mono" style={{ color: 'var(--success)' }}>{stats.done}</div>
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Completed</div>
                  </div>
                  <div className="p-4 rounded-xl text-center" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
                    <div className="text-2xl font-semibold font-mono" style={{ color: 'var(--accent)' }}>{stats.running}</div>
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Running</div>
                  </div>

                  {/* Cost */}
                  {costData && (
                    <div className="p-4 rounded-xl" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
                      <div className="flex items-baseline gap-1">
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>$</span>
                        <span className="text-2xl font-semibold font-mono">{costData.summary.estimatedCostUsd.toFixed(4)}</span>
                      </div>
                      {costData.summary.savedByRecoveryUsd > 0 && (
                        <div className="text-xs flex items-center gap-1 mt-1" style={{ color: 'var(--success)' }}>
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                          </svg>
                          ${costData.summary.savedByRecoveryUsd.toFixed(4)} saved
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Checkpoints Panel */}
                {showCheckpoints && checkpointsData && (
                  <div className="mt-4 p-4 rounded-xl" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-medium flex items-center gap-2">
                        <svg className="w-4 h-4" style={{ color: 'var(--accent)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Checkpoints ({checkpointsData.count})
                      </h3>
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Click to replay from any checkpoint</span>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      {checkpointsData.checkpoints.map((cp) => (
                        <button
                          key={cp.id}
                          onClick={() => handleReplay(cp.id)}
                          className="px-4 py-2.5 rounded-lg text-sm transition-all hover:scale-[1.02]"
                          style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)' }}
                        >
                          <div className="font-medium" style={{ color: 'var(--text-primary)' }}>{cp.taskName}</div>
                          <div className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>Step {cp.stepNumber}</div>
                        </button>
                      ))}
                      {checkpointsData.checkpoints.length === 0 && (
                        <div className="text-sm" style={{ color: 'var(--text-muted)' }}>No checkpoints saved yet</div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Graph or List View */}
              <div className="flex-1 min-h-0 p-6">
                {viewMode === 'graph' ? (
                  <div className="h-full rounded-xl overflow-hidden" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
                    <TaskGraph
                      tasks={tasks}
                      onTaskClick={setSelectedTask}
                      onKillWorker={handleKillWorker}
                    />
                  </div>
                ) : (
                  <div className="h-full rounded-xl overflow-hidden" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
                    <div className="overflow-auto h-full">
                      <table className="w-full">
                        <thead className="sticky top-0" style={{ background: 'var(--bg-tertiary)' }}>
                          <tr>
                            <th className="text-left px-4 py-3 text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Task</th>
                            <th className="text-left px-4 py-3 text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Type</th>
                            <th className="text-left px-4 py-3 text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Status</th>
                            <th className="text-left px-4 py-3 text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Attempts</th>
                            <th className="text-right px-4 py-3 text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
                          {tasks.map((task) => (
                            <tr
                              key={task.id}
                              className="hover:bg-[var(--bg-elevated)] cursor-pointer transition-colors"
                              onClick={() => setSelectedTask(task)}
                            >
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{task.name}</span>
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <span className="text-xs font-mono px-2 py-1 rounded" style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
                                  {task.task_type}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                <StatusIndicator status={task.status} />
                              </td>
                              <td className="px-4 py-3 font-mono text-sm" style={{ color: 'var(--text-muted)' }}>
                                {task.attempt_count}/{task.max_attempts}
                              </td>
                              <td className="px-4 py-3 text-right">
                                {(task.status === 'running' || task.status === 'claimed') && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleKillWorker(task.id); }}
                                    className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
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
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center p-8">
              <div className="text-center max-w-lg">
                <div className="w-20 h-20 mx-auto mb-6 rounded-2xl flex items-center justify-center" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
                  <svg className="w-10 h-10" style={{ color: 'var(--text-muted)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <h2 className="text-2xl font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
                  Welcome to x404-r
                </h2>
                <p className="text-base mb-8 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                  Select a workflow from the sidebar to view its execution graph, or create a new workflow to get started with crash-proof AI agents.
                </p>
                <div className="flex flex-col sm:flex-row gap-3 justify-center">
                  <button
                    onClick={handleCreateDemo}
                    className="px-6 py-3 rounded-xl text-sm font-medium"
                    style={{ background: 'var(--accent)', color: 'white' }}
                  >
                    Create Demo Workflow
                  </button>
                  <Link
                    href="/create"
                    className="px-6 py-3 rounded-xl text-sm font-medium"
                    style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}
                  >
                    Build Custom Agent
                  </Link>
                </div>
              </div>
            </div>
          )}
        </main>

        {/* Task Details Panel */}
        {selectedTask && (
          <aside className="w-96 flex-shrink-0 border-l overflow-y-auto" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-secondary)' }}>
            <div className="p-5">
              {/* Header */}
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  Task Details
                </h2>
                <button
                  onClick={() => setSelectedTask(null)}
                  className="p-2 rounded-lg hover:bg-[var(--bg-elevated)] transition-colors"
                  style={{ color: 'var(--text-muted)' }}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Task Info Card */}
              <div className="p-4 rounded-xl mb-4" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                <div className="flex items-start gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    selectedTask.status === 'running' || selectedTask.status === 'claimed' ? 'bg-blue-500/20' :
                    selectedTask.status === 'done' ? 'bg-green-500/20' :
                    selectedTask.status === 'failed' ? 'bg-red-500/20' : 'bg-zinc-500/20'
                  }`}>
                    {(selectedTask.status === 'running' || selectedTask.status === 'claimed') ? (
                      <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"></div>
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
                    <h3 className="font-semibold truncate mb-1" style={{ color: 'var(--text-primary)' }}>{selectedTask.name}</h3>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono px-2 py-0.5 rounded" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>
                        {selectedTask.task_type}
                      </span>
                      <StatusIndicator status={selectedTask.status} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Quick Stats */}
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="p-3 rounded-xl" style={{ background: 'var(--bg-elevated)' }}>
                  <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Attempts</div>
                  <div className="font-mono font-semibold">{selectedTask.attempt_count} / {selectedTask.max_attempts}</div>
                </div>
                <div className="p-3 rounded-xl" style={{ background: 'var(--bg-elevated)' }}>
                  <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Task ID</div>
                  <div className="font-mono text-xs truncate">{selectedTask.id.slice(0, 12)}...</div>
                </div>
              </div>

              {/* Worker Info */}
              {selectedTask.claimed_by && (
                <div className="p-3 rounded-xl mb-4" style={{ background: 'var(--bg-elevated)' }}>
                  <div className="flex items-center gap-2 mb-1">
                    <svg className="w-4 h-4" style={{ color: 'var(--text-muted)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                    <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Worker</span>
                  </div>
                  <div className="font-mono text-sm truncate">{selectedTask.claimed_by}</div>
                </div>
              )}

              {/* Kill Worker Button */}
              {(selectedTask.status === 'running' || selectedTask.status === 'claimed') && (
                <button
                  onClick={() => handleKillWorker(selectedTask.id)}
                  className="w-full py-3 rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-all hover:scale-[0.98]"
                  style={{ background: 'rgba(239, 68, 68, 0.1)', color: 'var(--error)', border: '1px solid rgba(239, 68, 68, 0.2)' }}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Simulate Crash
                </button>
              )}

              {/* Error */}
              {selectedTask.error_message && (
                <div className="mt-4 p-4 rounded-xl" style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                  <div className="flex items-center gap-2 mb-2">
                    <svg className="w-4 h-4" style={{ color: 'var(--error)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="text-xs font-semibold" style={{ color: 'var(--error)' }}>Error</span>
                  </div>
                  <div className="text-xs font-mono" style={{ color: 'var(--error)' }}>{selectedTask.error_message}</div>
                </div>
              )}

              {/* Output */}
              {selectedTask.output_payload && (
                <div className="mt-4">
                  <div className="flex items-center gap-2 mb-2">
                    <svg className="w-4 h-4" style={{ color: 'var(--success)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Output</span>
                  </div>
                  <pre className="p-3 rounded-xl text-xs font-mono overflow-x-auto max-h-48" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
                    {JSON.stringify(selectedTask.output_payload, null, 2)}
                  </pre>
                </div>
              )}

              {/* Input */}
              {selectedTask.input_payload && (
                <div className="mt-4">
                  <div className="flex items-center gap-2 mb-2">
                    <svg className="w-4 h-4" style={{ color: 'var(--text-muted)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                    <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Input</span>
                  </div>
                  <pre className="p-3 rounded-xl text-xs font-mono overflow-x-auto max-h-40" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
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
