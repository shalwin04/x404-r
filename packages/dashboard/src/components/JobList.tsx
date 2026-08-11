'use client';

import React from 'react';
import { Job, JobStatus } from '@/lib/types';

interface JobListProps {
  jobs: Job[];
  selectedJobId?: string;
  onSelectJob: (jobId: string) => void;
  onCreateDemo: () => void;
}

const statusColors: Record<JobStatus, string> = {
  pending: 'bg-gray-500',
  running: 'bg-blue-500',
  completed: 'bg-green-500',
  failed: 'bg-red-500',
};

const statusLabels: Record<JobStatus, string> = {
  pending: 'Pending',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
};

export default function JobList({ jobs, selectedJobId, onSelectJob, onCreateDemo }: JobListProps) {
  return (
    <div className="bg-gray-800 rounded-lg p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">Jobs</h2>
        <button
          onClick={onCreateDemo}
          className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors"
        >
          + Demo Job
        </button>
      </div>

      {jobs.length === 0 ? (
        <div className="text-gray-400 text-sm text-center py-8">
          No jobs yet. Create a demo job to get started.
        </div>
      ) : (
        <div className="space-y-2">
          {jobs.map(job => (
            <button
              key={job.id}
              onClick={() => onSelectJob(job.id)}
              className={`w-full text-left p-3 rounded-md transition-colors ${
                selectedJobId === job.id
                  ? 'bg-gray-700 ring-2 ring-blue-500'
                  : 'bg-gray-750 hover:bg-gray-700'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium text-white truncate">{job.name}</span>
                <span
                  className={`px-2 py-0.5 text-xs rounded-full text-white ${statusColors[job.status]}`}
                >
                  {statusLabels[job.status]}
                </span>
              </div>
              <div className="text-xs text-gray-400">
                {new Date(job.created_at).toLocaleString()}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
