'use client';

import React from 'react';
import { JobStats } from '@/lib/types';

interface StatsBarProps {
  stats: JobStats;
}

export default function StatsBar({ stats }: StatsBarProps) {
  const progress = stats.total > 0 ? (stats.done / stats.total) * 100 : 0;

  return (
    <div className="bg-gray-800 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-gray-400">Progress</h3>
        <span className="text-sm text-white font-mono">
          {stats.done} / {stats.total}
        </span>
      </div>

      {/* Progress Bar */}
      <div className="w-full bg-gray-700 rounded-full h-2 mb-4">
        <div
          className="bg-green-500 h-2 rounded-full transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-4 gap-2 text-center">
        <div className="p-2 bg-gray-700 rounded">
          <div className="text-lg font-bold text-gray-400">{stats.pending}</div>
          <div className="text-xs text-gray-500">Pending</div>
        </div>
        <div className="p-2 bg-blue-900/50 rounded">
          <div className="text-lg font-bold text-blue-400">{stats.running}</div>
          <div className="text-xs text-blue-500">Running</div>
        </div>
        <div className="p-2 bg-green-900/50 rounded">
          <div className="text-lg font-bold text-green-400">{stats.done}</div>
          <div className="text-xs text-green-500">Done</div>
        </div>
        <div className="p-2 bg-red-900/50 rounded">
          <div className="text-lg font-bold text-red-400">{stats.failed}</div>
          <div className="text-xs text-red-500">Failed</div>
        </div>
      </div>
    </div>
  );
}
