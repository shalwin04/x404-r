'use client';

import React, { useState, useCallback, useEffect } from 'react';
import useSWR, { mutate as globalMutate } from 'swr';
import dynamic from 'next/dynamic';
import JobList from '@/components/JobList';
import TaskDetails from '@/components/TaskDetails';
import ChaosPanel from '@/components/ChaosPanel';
import StatsBar from '@/components/StatsBar';
import TenantSelector from '@/components/TenantSelector';
import UsageBar from '@/components/UsageBar';
import { Job, TaskNode, JobResponse, JobStats, TenantInfo } from '@/lib/types';
import * as api from '@/lib/api';

// Dynamic import for React Flow to avoid SSR issues
const TaskGraph = dynamic(() => import('@/components/TaskGraph'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-gray-800 rounded-lg">
      <div className="text-gray-400">Loading graph...</div>
    </div>
  ),
});

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

// Fetcher that includes auth headers
const fetcher = async (url: string) => {
  const headers: Record<string, string> = {};
  const apiKey = api.getStoredApiKey();
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const res = await fetch(url, { headers });
  if (res.status === 401) {
    // Clear invalid API key
    api.clearStoredApiKey();
    throw new Error('Authentication required');
  }
  if (res.status === 429) {
    const data = await res.json();
    throw new Error(data.error || 'Rate limit exceeded');
  }
  if (!res.ok) throw new Error('Failed to fetch');
  return res.json();
};

export default function Dashboard() {
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<TaskNode | null>(null);
  const [tenant, setTenant] = useState<TenantInfo | null>(null);
  const [usageRefreshKey, setUsageRefreshKey] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Fetch jobs list
  const { data: jobsData, mutate: mutateJobs, error: jobsError } = useSWR<{ jobs: Job[] }>(
    `${API_BASE}/jobs`,
    fetcher,
    { refreshInterval: 2000, onError: (err) => setError(err.message) }
  );

  // Fetch selected job details
  const { data: jobData, mutate: mutateJob } = useSWR<JobResponse>(
    selectedJobId ? `${API_BASE}/jobs/${selectedJobId}` : null,
    fetcher,
    { refreshInterval: 1000 }
  );

  const jobs = jobsData?.jobs || [];
  const tasks = jobData?.tasks || [];
  const stats: JobStats = jobData?.stats || { total: 0, done: 0, failed: 0, pending: 0, running: 0 };

  // Handle tenant change - refresh all data
  const handleTenantChange = useCallback((newTenant: TenantInfo | null) => {
    setTenant(newTenant);
    setSelectedJobId(null);
    setSelectedTask(null);
    setError(null);
    // Refresh all SWR caches
    globalMutate(() => true, undefined, { revalidate: true });
    setUsageRefreshKey(k => k + 1);
  }, []);

  const handleCreateDemo = useCallback(async () => {
    try {
      setError(null);
      const result = await api.createDemoJob();
      setSelectedJobId(result.jobId);
      mutateJobs();
      setUsageRefreshKey(k => k + 1);
    } catch (error) {
      const message = error instanceof api.ApiError ? error.message : 'Failed to create demo job';
      setError(message);
      console.error('Failed to create demo job:', error);
    }
  }, [mutateJobs]);

  const handleKillWorker = useCallback(
    async (taskId: string) => {
      try {
        await api.killWorker(taskId);
        mutateJob();
      } catch (error) {
        console.error('Failed to kill worker:', error);
      }
    },
    [mutateJob]
  );

  const handleTriggerReclaim = useCallback(async () => {
    try {
      await api.triggerReclaim();
      mutateJob();
    } catch (error) {
      console.error('Failed to trigger reclaim:', error);
    }
  }, [mutateJob]);

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"
                />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold">Crash-Proof Agent</h1>
              <p className="text-xs text-gray-400">CockroachDB + Lambda + Gemini</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <TenantSelector onTenantChange={handleTenantChange} />
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
              Live
            </div>
          </div>
        </div>
      </header>

      {/* Error Banner */}
      {error && (
        <div className="bg-red-500/10 border-b border-red-500/30 px-6 py-3">
          <div className="flex items-center justify-between">
            <span className="text-red-400 text-sm">{error}</span>
            <button
              onClick={() => setError(null)}
              className="text-red-400 hover:text-red-300"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="flex h-[calc(100vh-73px)]">
        {/* Left Sidebar - Job List */}
        <aside className="w-72 border-r border-gray-700 p-4 overflow-y-auto flex flex-col gap-4">
          {/* Usage Bar */}
          <UsageBar refreshKey={usageRefreshKey} />

          {/* Jobs */}
          <JobList
            jobs={jobs}
            selectedJobId={selectedJobId || undefined}
            onSelectJob={setSelectedJobId}
            onCreateDemo={handleCreateDemo}
          />
        </aside>

        {/* Main Area - Task Graph */}
        <main className="flex-1 p-4 overflow-hidden">
          {selectedJobId ? (
            <div className="h-full flex flex-col gap-4">
              {/* Stats Bar */}
              <StatsBar stats={stats} />

              {/* Task Graph */}
              <div className="flex-1 min-h-0">
                <TaskGraph
                  tasks={tasks}
                  onTaskClick={setSelectedTask}
                  onKillWorker={handleKillWorker}
                />
              </div>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center">
              <div className="text-center">
                <div className="w-16 h-16 mx-auto mb-4 bg-gray-800 rounded-full flex items-center justify-center">
                  <svg className="w-8 h-8 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                    />
                  </svg>
                </div>
                <h2 className="text-lg font-medium text-gray-400 mb-2">No Job Selected</h2>
                <p className="text-sm text-gray-500 mb-4">
                  Select a job from the sidebar or create a demo job
                </p>
                <button
                  onClick={handleCreateDemo}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors"
                >
                  Create Demo Job
                </button>
              </div>
            </div>
          )}
        </main>

        {/* Right Sidebar - Task Details & Chaos Panel */}
        <aside className="w-80 border-l border-gray-700 p-4 overflow-y-auto space-y-4">
          {selectedTask ? (
            <TaskDetails
              task={selectedTask}
              onClose={() => setSelectedTask(null)}
              onKillWorker={
                selectedTask.status === 'running' || selectedTask.status === 'claimed'
                  ? () => handleKillWorker(selectedTask.id)
                  : undefined
              }
            />
          ) : (
            <div className="bg-gray-800 rounded-lg p-4 text-center text-gray-500 text-sm">
              Click a task node to view details
            </div>
          )}

          <ChaosPanel
            tasks={tasks}
            onKillWorker={handleKillWorker}
            onTriggerReclaim={handleTriggerReclaim}
          />
        </aside>
      </div>
    </div>
  );
}
