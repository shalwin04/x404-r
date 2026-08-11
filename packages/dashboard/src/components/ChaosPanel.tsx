'use client';

import React, { useState } from 'react';
import { TaskNode } from '@/lib/types';

interface ChaosPanelProps {
  tasks: TaskNode[];
  onKillWorker: (taskId: string) => Promise<void>;
  onTriggerReclaim: () => Promise<void>;
}

export default function ChaosPanel({ tasks, onKillWorker, onTriggerReclaim }: ChaosPanelProps) {
  const [isKilling, setIsKilling] = useState(false);
  const [isReclaiming, setIsReclaiming] = useState(false);
  const [lastAction, setLastAction] = useState<string | null>(null);

  const runningTasks = tasks.filter(t => t.status === 'running' || t.status === 'claimed');

  const handleKillRandom = async () => {
    if (runningTasks.length === 0) return;

    const randomTask = runningTasks[Math.floor(Math.random() * runningTasks.length)];
    setIsKilling(true);
    try {
      await onKillWorker(randomTask.id);
      setLastAction(`Killed worker processing "${randomTask.name}"`);
    } catch (error) {
      setLastAction(`Failed to kill worker: ${error}`);
    } finally {
      setIsKilling(false);
    }
  };

  const handleReclaim = async () => {
    setIsReclaiming(true);
    try {
      await onTriggerReclaim();
      setLastAction('Triggered stale task reclaim');
    } catch (error) {
      setLastAction(`Failed to reclaim: ${error}`);
    } finally {
      setIsReclaiming(false);
    }
  };

  return (
    <div className="bg-gray-800 rounded-lg p-4">
      <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
        <span className="text-red-400">CHAOS</span>
        <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M13 10V3L4 14h7v7l9-11h-7z"
          />
        </svg>
      </h2>

      <div className="space-y-3">
        {/* Running Workers */}
        <div className="text-sm text-gray-400 mb-2">
          Active Workers: <span className="text-white font-mono">{runningTasks.length}</span>
        </div>

        {/* Kill Random Worker */}
        <button
          onClick={handleKillRandom}
          disabled={runningTasks.length === 0 || isKilling}
          className={`w-full px-4 py-2 rounded-md transition-colors flex items-center justify-center gap-2 ${
            runningTasks.length === 0 || isKilling
              ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
              : 'bg-red-600 hover:bg-red-700 text-white'
          }`}
        >
          {isKilling ? (
            <>
              <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              Killing...
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
                />
              </svg>
              Kill Random Worker
            </>
          )}
        </button>

        {/* Trigger Reclaim */}
        <button
          onClick={handleReclaim}
          disabled={isReclaiming}
          className={`w-full px-4 py-2 rounded-md transition-colors flex items-center justify-center gap-2 ${
            isReclaiming
              ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
              : 'bg-orange-600 hover:bg-orange-700 text-white'
          }`}
        >
          {isReclaiming ? (
            <>
              <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              Reclaiming...
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              Force Reclaim Stale Tasks
            </>
          )}
        </button>

        {/* Last Action */}
        {lastAction && (
          <div className="mt-4 p-2 bg-gray-900 rounded text-xs text-gray-400">
            Last action: {lastAction}
          </div>
        )}

        {/* Info */}
        <div className="mt-4 p-3 bg-gray-900 rounded text-xs text-gray-500">
          <p className="mb-2">
            <strong className="text-gray-400">Kill Worker:</strong> Simulates a worker crash by
            clearing its heartbeat. After 60s, the task will be reclaimed.
          </p>
          <p>
            <strong className="text-gray-400">Force Reclaim:</strong> Immediately reclaims stale
            tasks (normally runs every minute).
          </p>
        </div>
      </div>
    </div>
  );
}
