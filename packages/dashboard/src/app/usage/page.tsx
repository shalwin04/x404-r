'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import * as api from '@/lib/api';
import type { Job, TenantUsageResponse } from '@/lib/types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

const fetcher = async (url: string) => {
  const headers: Record<string, string> = {};
  const apiKey = api.getStoredApiKey();
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error('Failed to fetch');
  return res.json();
};

export default function UsagePage() {
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  const { data: usageData } = useSWR<TenantUsageResponse>(
    `${API_BASE}/usage`,
    fetcher,
    { refreshInterval: 30000 }
  );

  const { data: jobsData } = useSWR<{ jobs: Job[] }>(
    `${API_BASE}/jobs`,
    fetcher,
    { refreshInterval: 10000 }
  );

  const { data: costData } = useSWR<api.JobCostResponse>(
    selectedJobId ? `${API_BASE}/jobs/${selectedJobId}/cost` : null,
    fetcher
  );

  const jobs = jobsData?.jobs || [];
  const completedJobs = jobs.filter(j => j.status === 'completed' || j.status === 'failed');

  // Calculate total cost across all jobs
  const totalEstimatedCost = costData?.summary.estimatedCostUsd || 0;
  const totalSaved = costData?.summary.savedByRecoveryUsd || 0;

  // Usage percentage
  const usagePercent = usageData
    ? Math.round((usageData.usage.used / usageData.usage.limit) * 100)
    : 0;

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-primary)' }}>
      {/* Header */}
      <header className="border-b glass" style={{ borderColor: 'var(--border-subtle)' }}>
        <div className="h-14 px-6 flex items-center justify-between max-w-5xl mx-auto">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-lg font-semibold" style={{ color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
              x404-r
            </Link>
            <span className="text-xs px-1.5 py-0.5 rounded font-mono" style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
              usage
            </span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/settings" className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Settings
            </Link>
            <Link href="/dashboard" className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Dashboard
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="p-6 max-w-5xl mx-auto space-y-6 animate-fade-in">
        {/* Usage Overview */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Task Usage */}
          <div className="rounded-2xl p-6" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
            <h3 className="text-sm font-medium uppercase mb-4" style={{ color: 'var(--text-muted)', letterSpacing: '0.05em' }}>
              Monthly Tasks
            </h3>
            <div className="text-3xl font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
              {usageData?.usage.used.toLocaleString() || '—'}
              <span className="text-lg font-normal" style={{ color: 'var(--text-muted)' }}>
                {' '}/ {usageData?.usage.limit.toLocaleString() || '—'}
              </span>
            </div>
            <div className="h-2 rounded-full overflow-hidden mb-2" style={{ background: 'var(--bg-elevated)' }}>
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.min(usagePercent, 100)}%`,
                  background: usagePercent > 90 ? 'var(--error)' : usagePercent > 70 ? 'var(--warning)' : 'var(--accent)',
                }}
              />
            </div>
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {usageData?.usage.remaining.toLocaleString()} remaining
              {usageData?.usage.resetAt && (
                <> · Resets {new Date(usageData.usage.resetAt).toLocaleDateString()}</>
              )}
            </div>
          </div>

          {/* Plan */}
          <div className="rounded-2xl p-6" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
            <h3 className="text-sm font-medium uppercase mb-4" style={{ color: 'var(--text-muted)', letterSpacing: '0.05em' }}>
              Current Plan
            </h3>
            <div className="text-3xl font-semibold mb-2 capitalize" style={{ color: 'var(--text-primary)' }}>
              {usageData?.tenant.plan || '—'}
            </div>
            <div className="text-sm" style={{ color: 'var(--text-muted)' }}>
              {usageData?.tenant.name}
            </div>
            <Link
              href="/settings"
              className="inline-block mt-3 text-xs"
              style={{ color: 'var(--accent)' }}
            >
              Upgrade Plan →
            </Link>
          </div>

          {/* Cost Savings */}
          <div className="rounded-2xl p-6" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
            <h3 className="text-sm font-medium uppercase mb-4" style={{ color: 'var(--text-muted)', letterSpacing: '0.05em' }}>
              Crash Recovery Savings
            </h3>
            <div className="text-3xl font-semibold mb-2" style={{ color: 'var(--success)' }}>
              ${totalSaved.toFixed(4)}
            </div>
            <div className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Saved by not re-running tasks after crashes
            </div>
          </div>
        </div>

        {/* Job Cost Breakdown */}
        <div className="rounded-2xl p-6" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
          <h2 className="text-sm font-medium uppercase mb-4" style={{ color: 'var(--text-muted)', letterSpacing: '0.05em' }}>
            Job Cost Breakdown
          </h2>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Job List */}
            <div>
              <div className="text-xs uppercase mb-2" style={{ color: 'var(--text-muted)' }}>Select a job</div>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {jobs.length === 0 ? (
                  <div className="text-sm" style={{ color: 'var(--text-muted)' }}>No jobs yet</div>
                ) : (
                  jobs.map(job => (
                    <button
                      key={job.id}
                      onClick={() => setSelectedJobId(job.id)}
                      className="w-full text-left p-3 rounded-lg transition-colors"
                      style={{
                        background: selectedJobId === job.id ? 'var(--bg-elevated)' : 'transparent',
                        border: selectedJobId === job.id ? '1px solid var(--border-default)' : '1px solid transparent',
                      }}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>
                          {job.name}
                        </span>
                        <span className={`text-xs px-1.5 py-0.5 rounded ${
                          job.status === 'completed' ? 'bg-green-500/20 text-green-400' :
                          job.status === 'failed' ? 'bg-red-500/20 text-red-400' :
                          job.status === 'running' ? 'bg-blue-500/20 text-blue-400' :
                          'bg-zinc-500/20 text-zinc-400'
                        }`}>
                          {job.status}
                        </span>
                      </div>
                      <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {new Date(job.created_at).toLocaleString()}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>

            {/* Cost Details */}
            <div>
              {costData ? (
                <div className="space-y-4">
                  {/* Summary */}
                  <div className="p-4 rounded-lg" style={{ background: 'var(--bg-elevated)' }}>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Total Cost</div>
                        <div className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
                          ${costData.summary.estimatedCostUsd.toFixed(4)}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Saved by Recovery</div>
                        <div className="text-xl font-semibold" style={{ color: 'var(--success)' }}>
                          ${costData.summary.savedByRecoveryUsd.toFixed(4)}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Total Tokens</div>
                        <div className="text-lg font-mono" style={{ color: 'var(--text-primary)' }}>
                          {costData.summary.tokens.total.toLocaleString()}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Crash Recoveries</div>
                        <div className="text-lg font-mono" style={{ color: 'var(--text-primary)' }}>
                          {costData.summary.crashRecoveries}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Task breakdown */}
                  <div>
                    <div className="text-xs uppercase mb-2" style={{ color: 'var(--text-muted)' }}>
                      Tasks ({costData.tasks.length})
                    </div>
                    <div className="space-y-1 max-h-64 overflow-y-auto">
                      {costData.tasks.map(task => (
                        <div
                          key={task.taskId}
                          className="flex items-center justify-between px-3 py-2 rounded text-sm"
                          style={{ background: 'var(--bg-primary)' }}
                        >
                          <div className="flex items-center gap-2">
                            <span className={`w-2 h-2 rounded-full ${
                              task.status === 'done' ? 'bg-green-500' :
                              task.status === 'failed' ? 'bg-red-500' :
                              task.status === 'running' ? 'bg-blue-500' :
                              'bg-zinc-500'
                            }`} />
                            <span style={{ color: 'var(--text-primary)' }}>{task.taskName}</span>
                          </div>
                          <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                            <span>{task.tokens.input + task.tokens.output} tokens</span>
                            <span className="font-mono">${task.estimatedCostUsd.toFixed(4)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Pricing info */}
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    Model: {costData.pricing.model} · Input: ${costData.pricing.inputPer1MTokens}/1M · Output: ${costData.pricing.outputPer1MTokens}/1M
                  </div>
                </div>
              ) : selectedJobId ? (
                <div className="flex items-center justify-center h-64" style={{ color: 'var(--text-muted)' }}>
                  Loading cost data...
                </div>
              ) : (
                <div className="flex items-center justify-center h-64 text-center" style={{ color: 'var(--text-muted)' }}>
                  <div>
                    <div className="text-2xl mb-2">📊</div>
                    <div>Select a job to view cost breakdown</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Cost Transparency Info */}
        <div className="rounded-2xl p-6" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
          <h2 className="text-sm font-medium uppercase mb-4" style={{ color: 'var(--text-muted)', letterSpacing: '0.05em' }}>
            How Cost Savings Work
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-sm" style={{ color: 'var(--text-muted)' }}>
            <div>
              <div className="text-lg mb-2">1️⃣</div>
              <div className="font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Checkpoint Progress</div>
              <div>Tasks save their state at checkpoints. If a crash occurs, work isn't lost.</div>
            </div>
            <div>
              <div className="text-lg mb-2">2️⃣</div>
              <div className="font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Resume from Last State</div>
              <div>When a worker picks up a crashed task, it resumes from the last checkpoint - not from scratch.</div>
            </div>
            <div>
              <div className="text-lg mb-2">3️⃣</div>
              <div className="font-medium mb-1" style={{ color: 'var(--text-primary)' }}>No Duplicate API Calls</div>
              <div>Completed LLM calls aren't repeated. You save tokens and money on every recovery.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
