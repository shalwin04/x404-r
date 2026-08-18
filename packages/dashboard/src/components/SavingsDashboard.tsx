'use client';

import React from 'react';
import useSWR from 'swr';
import { getRecoveryBenchmark, RecoveryBenchmark } from '@/lib/api';

function formatNumber(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
}

function formatTime(ms: number): string {
  if (ms >= 3600000) return `${(ms / 3600000).toFixed(1)}h`;
  if (ms >= 60000) return `${(ms / 60000).toFixed(1)}m`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

export default function SavingsDashboard() {
  const { data, error, isLoading } = useSWR<RecoveryBenchmark>(
    'recovery-benchmark',
    getRecoveryBenchmark,
    { refreshInterval: 30000 }
  );

  if (isLoading) {
    return (
      <div className="bg-gray-800 rounded-lg p-6 animate-pulse">
        <div className="h-6 bg-gray-700 rounded w-48 mb-4" />
        <div className="grid grid-cols-3 gap-4">
          <div className="h-24 bg-gray-700 rounded" />
          <div className="h-24 bg-gray-700 rounded" />
          <div className="h-24 bg-gray-700 rounded" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-gray-800 rounded-lg p-6">
        <p className="text-gray-400">Unable to load recovery benchmark</p>
      </div>
    );
  }

  const hasSavings = data.savings.tokensSaved > 0;

  return (
    <div className="bg-gray-800 rounded-lg p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-white">Recovery Value</h2>
          <p className="text-sm text-gray-400">What x404-r saved you</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-2 py-1 bg-green-900/50 text-green-400 text-xs rounded">
            {data.actual.crashes} crashes recovered
          </span>
        </div>
      </div>

      {/* Comparison Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {/* Without x404-r (the bad scenario) */}
        <div className="bg-red-900/20 border border-red-800/50 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-red-400 text-lg">&#x2717;</span>
            <h3 className="text-sm font-medium text-red-400">Without x404-r</h3>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-gray-400 text-sm">Tokens required</span>
              <span className="text-red-300 font-mono">
                {formatNumber(data.withoutX404r.tokensRequired)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400 text-sm">Cost</span>
              <span className="text-red-300 font-mono">
                ${data.withoutX404r.costUsd.toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400 text-sm">Tasks restarted</span>
              <span className="text-red-300 font-mono">
                {data.withoutX404r.tasksRestarted}
              </span>
            </div>
          </div>
        </div>

        {/* With x404-r (the good scenario) */}
        <div className="bg-green-900/20 border border-green-800/50 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-green-400 text-lg">&#x2713;</span>
            <h3 className="text-sm font-medium text-green-400">With x404-r</h3>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-gray-400 text-sm">Tokens used</span>
              <span className="text-green-300 font-mono">
                {formatNumber(data.actual.tokensUsed)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400 text-sm">Cost</span>
              <span className="text-green-300 font-mono">
                ${data.actual.costUsd.toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400 text-sm">Tasks completed</span>
              <span className="text-green-300 font-mono">
                {data.actual.tasksCompleted}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Savings Summary */}
      <div className="bg-gradient-to-r from-purple-900/30 to-blue-900/30 border border-purple-700/50 rounded-lg p-4 mb-6">
        <h3 className="text-sm font-medium text-purple-300 mb-3">Your Savings</h3>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <div className="text-2xl font-bold text-white">
              {formatNumber(data.savings.tokensSaved)}
            </div>
            <div className="text-xs text-gray-400">Tokens Saved</div>
            {hasSavings && (
              <div className="text-xs text-purple-400 mt-1">
                {data.savings.percentTokensSaved}% less
              </div>
            )}
          </div>
          <div>
            <div className="text-2xl font-bold text-white">
              ${data.savings.costSavedUsd.toFixed(2)}
            </div>
            <div className="text-xs text-gray-400">Cost Saved</div>
            {hasSavings && (
              <div className="text-xs text-purple-400 mt-1">
                {data.savings.percentCostSaved}% less
              </div>
            )}
          </div>
          <div>
            <div className="text-2xl font-bold text-white">
              {formatTime(data.savings.timeSavedMs)}
            </div>
            <div className="text-xs text-gray-400">Time Saved</div>
            {hasSavings && (
              <div className="text-xs text-purple-400 mt-1">
                {data.savings.percentTimeSaved}% faster
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Quality Metrics */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="bg-gray-700/50 rounded p-3 text-center">
          <div className="text-lg font-bold text-green-400">
            {data.quality.recoverySuccessRate}%
          </div>
          <div className="text-xs text-gray-400">Recovery Rate</div>
        </div>
        <div className="bg-gray-700/50 rounded p-3 text-center">
          <div className="text-lg font-bold text-blue-400">
            {data.quality.checkpointsAvailable}
          </div>
          <div className="text-xs text-gray-400">Checkpoints</div>
        </div>
        <div className="bg-gray-700/50 rounded p-3 text-center">
          <div className="text-lg font-bold text-yellow-400">
            {formatTime(data.quality.avgCheckpointAgeMs)}
          </div>
          <div className="text-xs text-gray-400">Avg Checkpoint Age</div>
        </div>
      </div>

      {/* Explanation */}
      <div className="bg-gray-700/30 rounded-lg p-4">
        <p className="text-sm text-gray-300">{data.explanation.savings}</p>
      </div>
    </div>
  );
}
