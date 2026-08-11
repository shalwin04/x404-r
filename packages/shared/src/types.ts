// Task status types
export type TaskStatus = 'pending' | 'claimed' | 'running' | 'done' | 'failed' | 'needs_human';
export type JobStatus = 'pending' | 'running' | 'completed' | 'failed';
export type MemoryEventType = 'failure' | 'success' | 'human_resolved';
export type TenantPlan = 'free' | 'pro' | 'team' | 'enterprise';
export type MembershipRole = 'owner' | 'admin' | 'member' | 'viewer';

// Multi-tenant entities
export interface Tenant {
  id: string;
  name: string;
  slug: string;
  plan: TenantPlan;
  stripe_customer_id?: string;
  stripe_subscription_id?: string;
  task_limit_monthly: number;
  concurrent_task_limit: number;
  memory_retention_days: number;
  settings: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface TenantContext {
  tenantId: string;
  userId?: string;
  plan: TenantPlan;
  scopes: string[];
}

export interface User {
  id: string;
  email: string;
  name?: string;
  github_id?: string;
  github_access_token?: string;
  avatar_url?: string;
  created_at: Date;
  updated_at: Date;
}

export interface Membership {
  id: string;
  tenant_id: string;
  user_id: string;
  role: MembershipRole;
  created_at: Date;
  updated_at: Date;
}

export interface ApiKey {
  id: string;
  tenant_id: string;
  name: string;
  key_hash: string;
  key_prefix: string;
  scopes: string[];
  last_used_at?: Date;
  expires_at?: Date;
  created_by?: string;
  created_at: Date;
}

export interface Repository {
  id: string;
  tenant_id: string;
  github_id: string;
  github_full_name: string;
  default_branch: string;
  webhook_secret?: string;
  settings: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

// Core entities (with tenant_id)
export interface Job {
  id: string;
  tenant_id: string;
  name: string;
  description?: string;
  status: JobStatus;
  priority: number;
  input_payload: Record<string, unknown>;
  result_payload?: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  completed_at?: Date;
}

export interface TaskNode {
  id: string;
  tenant_id: string;
  job_id: string;
  task_type: string;
  name: string;
  input_payload: Record<string, unknown>;
  output_payload?: Record<string, unknown>;
  status: TaskStatus;
  claimed_by?: string;
  claimed_at?: Date;
  heartbeat_at?: Date;
  attempt_count: number;
  max_attempts: number;
  error_message?: string;
  depends_on: string[];
  created_at: Date;
  updated_at: Date;
  completed_at?: Date;
}

export interface MemoryVector {
  id: string;
  tenant_id: string;
  task_id?: string;
  event_type: MemoryEventType;
  context_summary: string;
  task_type?: string;
  error_category?: string;
  resolution?: string;
  embedding: number[];
  created_at: Date;
}

// Usage tracking
export interface UsageEvent {
  id: string;
  tenant_id: string;
  event_type: string;
  quantity: number;
  billing_period: string;
  job_id?: string;
  task_id?: string;
  metadata: Record<string, unknown>;
  created_at: Date;
}

export interface UsageMonthly {
  id: string;
  tenant_id: string;
  billing_period: string;
  tasks_created: number;
  tasks_completed: number;
  tasks_failed: number;
  jobs_created: number;
  api_calls: number;
  ai_tokens_used: number;
  created_at: Date;
  updated_at: Date;
}

export interface UsageLimits {
  allowed: boolean;
  remaining: number;
  limit: number;
  used: number;
  resetAt: Date;
}

// API types
export interface CreateJobInput {
  name: string;
  description?: string;
  input_payload: Record<string, unknown>;
  priority?: number;
}

export interface CreateTaskInput {
  job_id: string;
  task_type: string;
  name: string;
  input_payload: Record<string, unknown>;
  depends_on?: string[];
  max_attempts?: number;
}

export interface ClaimResult {
  task: TaskNode | null;
  claimed: boolean;
}

export interface TaskExecutionResult {
  success: boolean;
  output?: Record<string, unknown>;
  error?: string;
  needsHuman?: boolean;
}

// Worker types
export interface WorkerContext {
  workerId: string;
  task: TaskNode;
  memories: MemoryVector[];
  tenantContext?: TenantContext;
}

// DAG decomposition
export interface TaskDefinition {
  task_type: string;
  name: string;
  input_payload: Record<string, unknown>;
  depends_on_names?: string[]; // References by name before IDs are assigned
}

export interface DecompositionResult {
  tasks: TaskDefinition[];
}

// Dashboard types
export interface JobProgress {
  id: string;
  tenant_id: string;
  name: string;
  status: JobStatus;
  total_tasks: number;
  completed_tasks: number;
  running_tasks: number;
  failed_tasks: number;
  pending_tasks: number;
  created_at: Date;
  updated_at: Date;
}

export interface DashboardTask extends TaskNode {
  // Additional fields for visualization
  position?: { x: number; y: number };
  dependents?: string[]; // Tasks that depend on this one
}

// Event types for real-time updates
export interface TaskEvent {
  type: 'task_claimed' | 'task_started' | 'task_completed' | 'task_failed' | 'heartbeat';
  task_id: string;
  worker_id?: string;
  timestamp: Date;
  data?: Record<string, unknown>;
}

// API Response types with tenant info
export interface TenantUsageResponse {
  tenant: Pick<Tenant, 'id' | 'name' | 'plan'>;
  usage: UsageMonthly;
  limits: UsageLimits;
}

export interface CreateTenantInput {
  name: string;
  slug: string;
  plan?: TenantPlan;
}

export interface CreateApiKeyInput {
  name: string;
  scopes?: string[];
  expires_at?: Date;
}

export interface CreateApiKeyResponse {
  id: string;
  key: string; // Only returned once at creation time
  key_prefix: string;
  name: string;
  scopes: string[];
}
