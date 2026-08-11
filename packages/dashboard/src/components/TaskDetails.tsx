'use client';

import React from 'react';
import { TaskNode, statusColors, statusLabels } from '@/lib/types';

interface TaskDetailsProps {
  task: TaskNode;
  onClose: () => void;
  onKillWorker?: () => void;
}

export default function TaskDetails({ task, onClose, onKillWorker }: TaskDetailsProps) {
  const colors = statusColors[task.status];
  const isRunning = task.status === 'running' || task.status === 'claimed';

  return (
    <div className="bg-gray-800 rounded-lg p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">Task Details</h2>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="space-y-4">
        {/* Status */}
        <div className="flex items-center gap-2">
          <span
            className={`px-2 py-1 text-xs font-semibold rounded ${colors.bg} ${colors.text} ${colors.border} border`}
          >
            {statusLabels[task.status]}
          </span>
          {isRunning && (
            <span className="text-xs text-gray-400">
              Processing...
            </span>
          )}
        </div>

        {/* Basic Info */}
        <div>
          <h3 className="text-sm font-medium text-gray-400 mb-1">Name</h3>
          <p className="text-white">{task.name}</p>
        </div>

        <div>
          <h3 className="text-sm font-medium text-gray-400 mb-1">Type</h3>
          <p className="text-white font-mono text-sm">{task.task_type}</p>
        </div>

        {/* Worker Info */}
        {task.claimed_by && (
          <div>
            <h3 className="text-sm font-medium text-gray-400 mb-1">Worker</h3>
            <p className="text-white font-mono text-sm">{task.claimed_by}</p>
          </div>
        )}

        {/* Attempts */}
        <div>
          <h3 className="text-sm font-medium text-gray-400 mb-1">Attempts</h3>
          <p className="text-white">
            {task.attempt_count} / {task.max_attempts}
          </p>
        </div>

        {/* Dependencies */}
        {task.depends_on.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-gray-400 mb-1">Dependencies</h3>
            <div className="flex flex-wrap gap-1">
              {task.depends_on.map(depId => (
                <span
                  key={depId}
                  className="px-2 py-0.5 text-xs bg-gray-700 text-gray-300 rounded"
                >
                  {depId.slice(0, 8)}...
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Input Payload */}
        <div>
          <h3 className="text-sm font-medium text-gray-400 mb-1">Input</h3>
          <pre className="text-xs text-gray-300 bg-gray-900 p-2 rounded overflow-auto max-h-32">
            {JSON.stringify(task.input_payload, null, 2)}
          </pre>
        </div>

        {/* Output Payload */}
        {task.output_payload && (
          <div>
            <h3 className="text-sm font-medium text-gray-400 mb-1">Output</h3>
            <pre className="text-xs text-gray-300 bg-gray-900 p-2 rounded overflow-auto max-h-32">
              {JSON.stringify(task.output_payload, null, 2)}
            </pre>
          </div>
        )}

        {/* Error Message */}
        {task.error_message && (
          <div>
            <h3 className="text-sm font-medium text-red-400 mb-1">Error</h3>
            <p className="text-red-300 text-sm">{task.error_message}</p>
          </div>
        )}

        {/* Timestamps */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <span className="text-gray-500">Created:</span>
            <span className="text-gray-300 ml-1">
              {new Date(task.created_at).toLocaleTimeString()}
            </span>
          </div>
          {task.claimed_at && (
            <div>
              <span className="text-gray-500">Claimed:</span>
              <span className="text-gray-300 ml-1">
                {new Date(task.claimed_at).toLocaleTimeString()}
              </span>
            </div>
          )}
          {task.completed_at && (
            <div>
              <span className="text-gray-500">Completed:</span>
              <span className="text-gray-300 ml-1">
                {new Date(task.completed_at).toLocaleTimeString()}
              </span>
            </div>
          )}
          {task.heartbeat_at && (
            <div>
              <span className="text-gray-500">Heartbeat:</span>
              <span className="text-gray-300 ml-1">
                {new Date(task.heartbeat_at).toLocaleTimeString()}
              </span>
            </div>
          )}
        </div>

        {/* Kill Worker Button */}
        {isRunning && onKillWorker && (
          <button
            onClick={onKillWorker}
            className="w-full mt-4 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md transition-colors flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            Simulate Worker Crash
          </button>
        )}
      </div>
    </div>
  );
}
