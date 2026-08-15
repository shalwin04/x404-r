import type {
  Job,
  JobResponse,
  CreateJobResponse,
  TenantUsageResponse,
  CreateTenantResponse,
  CreateApiKeyResponse,
  ApiKeyInfo,
} from './types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

// Storage keys
const API_KEY_STORAGE_KEY = 'crash_proof_api_key';
const SESSION_STORAGE_KEY = 'crash_proof_session';

// ============ Auth Storage ============

/**
 * Get stored API key from localStorage
 */
export function getStoredApiKey(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(API_KEY_STORAGE_KEY);
}

/**
 * Store API key in localStorage
 */
export function setStoredApiKey(key: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(API_KEY_STORAGE_KEY, key);
}

/**
 * Clear stored API key
 */
export function clearStoredApiKey(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(API_KEY_STORAGE_KEY);
}

/**
 * Get stored session token from localStorage
 */
export function getStoredSession(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(SESSION_STORAGE_KEY);
}

/**
 * Store session token in localStorage
 */
export function setStoredSession(token: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(SESSION_STORAGE_KEY, token);
}

/**
 * Clear stored session token
 */
export function clearStoredSession(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(SESSION_STORAGE_KEY);
}

/**
 * Build headers with authorization if API key or session is available
 */
function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Prefer API key over session
  const apiKey = getStoredApiKey();
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
    return headers;
  }

  const session = getStoredSession();
  if (session) {
    headers['Authorization'] = `Session ${session}`;
  }

  return headers;
}

/**
 * Handle API response
 */
async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(error.error || 'Request failed', res.status, error.retryAfter);
  }
  return res.json();
}

/**
 * Custom error class for API errors
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public retryAfter?: number
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get isAuthError(): boolean {
    return this.statusCode === 401;
  }

  get isRateLimitError(): boolean {
    return this.statusCode === 429;
  }
}

// ============ Job APIs ============

export async function listJobs(): Promise<{ jobs: Job[] }> {
  const res = await fetch(`${API_BASE}/jobs`, {
    headers: getHeaders(),
  });
  return handleResponse(res);
}

export async function getJob(jobId: string): Promise<JobResponse> {
  const res = await fetch(`${API_BASE}/jobs/${jobId}`, {
    headers: getHeaders(),
  });
  return handleResponse(res);
}

export async function createJob(
  name: string,
  taskDescription: string,
  context?: Record<string, unknown>,
  priority?: number
): Promise<CreateJobResponse> {
  const res = await fetch(`${API_BASE}/jobs`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ name, taskDescription, context, priority }),
  });
  return handleResponse(res);
}

export async function createDemoJob(): Promise<CreateJobResponse> {
  const res = await fetch(`${API_BASE}/jobs/demo`, {
    method: 'POST',
    headers: getHeaders(),
  });
  return handleResponse(res);
}

// ============ Usage APIs ============

export async function getUsage(): Promise<TenantUsageResponse> {
  const res = await fetch(`${API_BASE}/usage`, {
    headers: getHeaders(),
  });
  return handleResponse(res);
}

// ============ Time Travel APIs ============

export interface Checkpoint {
  id: string;
  taskId: string;
  taskName: string;
  taskType: string;
  stepNumber: number;
  state: Record<string, unknown>;
  createdAt: string;
}

export interface CheckpointsResponse {
  jobId: string;
  checkpoints: Checkpoint[];
  count: number;
}

export async function getJobCheckpoints(jobId: string): Promise<CheckpointsResponse> {
  const res = await fetch(`${API_BASE}/jobs/${jobId}/checkpoints`, {
    headers: getHeaders(),
  });
  return handleResponse(res);
}

export interface ReplayOptions {
  checkpointId?: string;
  fromTaskId?: string;
  newInput?: Record<string, unknown>;
}

export interface ReplayResponse {
  replayJobId: string;
  originalJobId: string;
  fromTaskId: string;
  checkpointId?: string;
  tasksCreated: number;
  idMapping: Record<string, string>;
}

export async function replayFromCheckpoint(
  jobId: string,
  options: ReplayOptions
): Promise<ReplayResponse> {
  const res = await fetch(`${API_BASE}/jobs/${jobId}/replay`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(options),
  });
  return handleResponse(res);
}

// ============ Cost Tracking APIs ============

export interface TaskCost {
  taskId: string;
  taskName: string;
  taskType: string;
  status: string;
  attempts: number;
  tokens: {
    input: number;
    output: number;
  };
  estimatedCostUsd: number;
}

export interface JobCostResponse {
  jobId: string;
  jobName: string;
  status: string;
  summary: {
    totalTasks: number;
    completedTasks: number;
    totalAttempts: number;
    crashRecoveries: number;
    tokens: {
      input: number;
      output: number;
      total: number;
    };
    estimatedCostUsd: number;
    savedByRecoveryUsd: number;
  };
  tasks: TaskCost[];
  pricing: {
    model: string;
    inputPer1MTokens: number;
    outputPer1MTokens: number;
  };
}

export async function getJobCost(jobId: string): Promise<JobCostResponse> {
  const res = await fetch(`${API_BASE}/jobs/${jobId}/cost`, {
    headers: getHeaders(),
  });
  return handleResponse(res);
}

// ============ Tenant Management APIs ============

export async function createTenant(
  name: string,
  slug: string,
  plan?: string
): Promise<CreateTenantResponse> {
  const res = await fetch(`${API_BASE}/tenants`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, slug, plan }),
  });
  return handleResponse(res);
}

export async function createApiKey(
  tenantId: string,
  name: string,
  scopes?: string[]
): Promise<CreateApiKeyResponse> {
  const res = await fetch(`${API_BASE}/tenants/${tenantId}/api-keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, scopes }),
  });
  return handleResponse(res);
}

export async function listApiKeys(tenantId: string): Promise<{ keys: ApiKeyInfo[] }> {
  const res = await fetch(`${API_BASE}/tenants/${tenantId}/api-keys`, {
    headers: { 'Content-Type': 'application/json' },
  });
  return handleResponse(res);
}

// ============ User/Session APIs ============

export interface UserInfo {
  id: string;
  email: string;
  name?: string;
  avatar_url?: string;
  github_id?: string;
}

export interface MembershipInfo {
  tenant_id: string;
  role: string;
  tenant: {
    id: string;
    name: string;
    slug: string;
    plan: string;
  };
}

export interface MeResponse {
  user: UserInfo;
  memberships: MembershipInfo[];
}

export async function getMe(): Promise<MeResponse> {
  const res = await fetch(`${API_BASE}/auth/me`, {
    headers: getHeaders(),
  });
  return handleResponse(res);
}

export async function logout(): Promise<void> {
  try {
    await fetch(`${API_BASE}/auth/logout`, {
      method: 'POST',
      headers: getHeaders(),
    });
  } catch {
    // Ignore errors
  }
  clearStoredApiKey();
  clearStoredSession();
}

// ============ Chaos/Debug APIs ============

export async function killWorker(taskId: string): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${API_BASE}/chaos/kill-worker`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ taskId }),
  });
  return handleResponse(res);
}

export async function triggerWorker(): Promise<void> {
  const res = await fetch(`${API_BASE}/trigger-worker`, {
    method: 'POST',
    headers: getHeaders(),
  });
  if (!res.ok) throw new ApiError('Failed to trigger worker', res.status);
}

export async function triggerReclaim(): Promise<void> {
  const res = await fetch(`${API_BASE}/trigger-reclaim`, {
    method: 'POST',
    headers: getHeaders(),
  });
  if (!res.ok) throw new ApiError('Failed to trigger reclaim', res.status);
}

// ============ Auth Helpers ============

/**
 * Check if user is authenticated (has API key or session)
 */
export function isAuthenticated(): boolean {
  return getStoredApiKey() !== null || getStoredSession() !== null;
}

/**
 * Login with API key
 */
export function loginWithApiKey(apiKey: string): void {
  setStoredApiKey(apiKey);
}

/**
 * Get GitHub login URL
 */
export function getGitHubLoginUrl(): string {
  return `${API_BASE}/auth/github`;
}
