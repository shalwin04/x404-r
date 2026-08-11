// Task status types
export type TaskStatus = 'pending' | 'claimed' | 'running' | 'done' | 'failed' | 'needs_human';
export type JobStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface Job {
  id: string;
  name: string;
  description?: string;
  status: JobStatus;
  input_payload: Record<string, unknown>;
  result_payload?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  completed_at?: string;
}

export interface TaskNode {
  id: string;
  job_id: string;
  task_type: string;
  name: string;
  input_payload: Record<string, unknown>;
  output_payload?: Record<string, unknown>;
  status: TaskStatus;
  claimed_by?: string;
  claimed_at?: string;
  heartbeat_at?: string;
  attempt_count: number;
  max_attempts: number;
  error_message?: string;
  depends_on: string[];
  created_at: string;
  updated_at: string;
  completed_at?: string;
}

export interface JobStats {
  total: number;
  done: number;
  failed: number;
  pending: number;
  running: number;
}

export interface JobResponse {
  job: Job;
  tasks: TaskNode[];
  stats: JobStats;
}

export interface CreateJobResponse {
  jobId: string;
  taskCount: number;
  tasks: Array<{ id: string; name: string; type: string }>;
  usage?: {
    used: number;
    limit: number;
    remaining: number;
  };
}

// Multi-tenant types
export type TenantPlan = 'free' | 'pro' | 'team' | 'enterprise';

export interface TenantInfo {
  id: string;
  name: string;
  plan: TenantPlan;
}

export interface UsageInfo {
  used: number;
  limit: number;
  remaining: number;
  resetAt: string;
}

export interface TenantUsageResponse {
  tenant: TenantInfo;
  usage: UsageInfo;
}

export interface CreateTenantResponse {
  id: string;
  name: string;
  slug: string;
  plan: TenantPlan;
  limits: {
    task_limit_monthly: number;
    concurrent_task_limit: number;
  };
}

export interface CreateApiKeyResponse {
  id: string;
  key: string;
  prefix: string;
  name: string;
  scopes: string[];
  warning: string;
}

export interface ApiKeyInfo {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  last_used_at?: string;
  created_at: string;
}

// Color mapping for task statuses
export const statusColors: Record<TaskStatus, { bg: string; border: string; text: string }> = {
  pending: { bg: 'bg-gray-700', border: 'border-gray-500', text: 'text-gray-300' },
  claimed: { bg: 'bg-yellow-900', border: 'border-yellow-500', text: 'text-yellow-300' },
  running: { bg: 'bg-blue-900', border: 'border-blue-500', text: 'text-blue-300' },
  done: { bg: 'bg-green-900', border: 'border-green-500', text: 'text-green-300' },
  failed: { bg: 'bg-red-900', border: 'border-red-500', text: 'text-red-300' },
  needs_human: { bg: 'bg-purple-900', border: 'border-purple-500', text: 'text-purple-300' },
};

export const statusLabels: Record<TaskStatus, string> = {
  pending: 'Pending',
  claimed: 'Claimed',
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
  needs_human: 'Needs Human',
};
