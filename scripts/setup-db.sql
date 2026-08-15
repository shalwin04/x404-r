-- Crash-Proof Agent: CockroachDB Schema
-- Multi-Tenant SaaS Version
-- CockroachDB compatible version (no PL/pgSQL triggers)

-- Drop existing tables if they exist (for development)
DROP TABLE IF EXISTS usage_monthly CASCADE;
DROP TABLE IF EXISTS usage_events CASCADE;
DROP TABLE IF EXISTS memory_vectors CASCADE;
DROP TABLE IF EXISTS task_nodes CASCADE;
DROP TABLE IF EXISTS jobs CASCADE;
DROP TABLE IF EXISTS repositories CASCADE;
DROP TABLE IF EXISTS api_keys CASCADE;
DROP TABLE IF EXISTS memberships CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS tenants CASCADE;

-- ============ Multi-Tenant Core Tables ============

-- Tenants: Organization/workspace for grouping resources
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name STRING NOT NULL,
    slug STRING NOT NULL UNIQUE,
    plan STRING NOT NULL DEFAULT 'free',
    stripe_customer_id STRING,
    stripe_subscription_id STRING,
    task_limit_monthly INT DEFAULT 1000,
    concurrent_task_limit INT DEFAULT 5,
    memory_retention_days INT DEFAULT 30,
    settings JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    INDEX idx_tenants_slug (slug),
    INDEX idx_tenants_plan (plan),
    INDEX idx_tenants_stripe (stripe_customer_id)
);

-- Users: Individual user accounts (can belong to multiple tenants)
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email STRING NOT NULL UNIQUE,
    name STRING,
    github_id STRING UNIQUE,
    github_access_token STRING,
    avatar_url STRING,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    INDEX idx_users_email (email),
    INDEX idx_users_github (github_id)
);

-- Memberships: Links users to tenants with roles
CREATE TABLE memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role STRING NOT NULL DEFAULT 'member',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (tenant_id, user_id),
    INDEX idx_memberships_tenant (tenant_id),
    INDEX idx_memberships_user (user_id)
);

-- API Keys: Authentication tokens for tenants
CREATE TABLE api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name STRING NOT NULL,
    key_hash STRING NOT NULL UNIQUE,
    key_prefix STRING NOT NULL,
    scopes STRING[] NOT NULL DEFAULT ARRAY['jobs:read', 'jobs:write', 'tasks:read'],
    last_used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    INDEX idx_api_keys_tenant (tenant_id),
    INDEX idx_api_keys_hash (key_hash),
    INDEX idx_api_keys_prefix (key_prefix)
);

-- Repositories: GitHub repositories linked to tenants
CREATE TABLE repositories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    github_id STRING NOT NULL,
    github_full_name STRING NOT NULL,
    default_branch STRING DEFAULT 'main',
    webhook_secret STRING,
    settings JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (tenant_id, github_id),
    INDEX idx_repositories_tenant (tenant_id),
    INDEX idx_repositories_github (github_id)
);

-- ============ Core Task/Job Tables (with tenant_id) ============

-- Jobs table: Groups related tasks together
CREATE TABLE jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name STRING NOT NULL,
    description STRING,
    status STRING NOT NULL DEFAULT 'pending',
    priority INT NOT NULL DEFAULT 0,
    input_payload JSONB NOT NULL DEFAULT '{}',
    result_payload JSONB,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    completed_at TIMESTAMPTZ,
    INDEX idx_jobs_tenant_status (tenant_id, status, created_at DESC),
    INDEX idx_jobs_status (status),
    INDEX idx_jobs_created (created_at DESC)
);

-- Task nodes: Individual units of work within a job
CREATE TABLE task_nodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    task_type STRING NOT NULL,
    name STRING NOT NULL,
    input_payload JSONB NOT NULL DEFAULT '{}',
    output_payload JSONB,
    status STRING NOT NULL DEFAULT 'pending',
    claimed_by STRING,
    claimed_at TIMESTAMPTZ,
    heartbeat_at TIMESTAMPTZ,
    attempt_count INT DEFAULT 0,
    max_attempts INT DEFAULT 3,
    error_message STRING,
    depends_on UUID[] DEFAULT ARRAY[]::UUID[],
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    completed_at TIMESTAMPTZ,
    INDEX idx_tasks_tenant_claimable (tenant_id, status, created_at) WHERE status = 'pending',
    INDEX idx_claimable (status, created_at) WHERE status = 'pending',
    INDEX idx_stale (status, heartbeat_at) WHERE status = 'running',
    INDEX idx_job_tasks (job_id, status),
    INDEX idx_task_type (task_type)
);

-- Memory vectors: Learned patterns from past executions
-- Uses CockroachDB's native vector type with HNSW index for similarity search
CREATE TABLE memory_vectors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    task_id UUID REFERENCES task_nodes(id) ON DELETE SET NULL,
    event_type STRING NOT NULL,
    context_summary STRING NOT NULL,
    task_type STRING,
    error_category STRING,
    resolution STRING,
    -- Using FLOAT8[] for compatibility; CockroachDB supports vector operations
    embedding FLOAT8[] NOT NULL,
    embedding_model STRING DEFAULT 'text-embedding-3-small',
    embedding_dimensions INT DEFAULT 1536,
    similarity_score FLOAT8,
    created_at TIMESTAMPTZ DEFAULT now(),
    INDEX idx_memory_tenant (tenant_id),
    INDEX idx_memory_task_type (task_type),
    INDEX idx_memory_event_type (event_type),
    INDEX idx_memory_created (created_at DESC),
    INDEX idx_memory_tenant_type (tenant_id, task_type, event_type)
);

-- Create a function for cosine similarity (CockroachDB compatible)
-- Note: CockroachDB doesn't support PL/pgSQL, so we use a view-based approach
-- For vector similarity search, use: 1 - (dot_product / (norm_a * norm_b))

-- Memory search helper view for common queries
CREATE VIEW memory_search_view AS
SELECT
    mv.*,
    -- Pre-compute array length for similarity calculations
    array_length(embedding, 1) as embedding_length
FROM memory_vectors mv;

-- ============ Checkpoints Table (for crash recovery & time travel) ============

-- Checkpoints: State snapshots for resuming crashed tasks and time travel debugging
CREATE TABLE checkpoints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES task_nodes(id) ON DELETE CASCADE,
    step_number INT NOT NULL,
    step_name STRING,
    state JSONB NOT NULL DEFAULT '{}',
    -- Token usage tracking for cost transparency
    input_tokens INT DEFAULT 0,
    output_tokens INT DEFAULT 0,
    model_used STRING,
    -- Time travel metadata
    is_replayable BOOL DEFAULT true,
    replayed_from UUID REFERENCES checkpoints(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (task_id, step_number),
    INDEX idx_checkpoints_task (task_id),
    INDEX idx_checkpoints_task_step (task_id, step_number DESC),
    INDEX idx_checkpoints_replayable (task_id, is_replayable) WHERE is_replayable = true
);

-- ============ Cost Tracking Table ============

-- AI cost tracking for transparency and billing
CREATE TABLE ai_cost_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
    task_id UUID REFERENCES task_nodes(id) ON DELETE SET NULL,
    checkpoint_id UUID REFERENCES checkpoints(id) ON DELETE SET NULL,
    model STRING NOT NULL,
    provider STRING NOT NULL,
    input_tokens INT NOT NULL DEFAULT 0,
    output_tokens INT NOT NULL DEFAULT 0,
    estimated_cost_usd DECIMAL(10, 6) NOT NULL DEFAULT 0,
    -- Recovery tracking
    was_recovery BOOL DEFAULT false,
    saved_by_recovery_usd DECIMAL(10, 6) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    INDEX idx_cost_tenant (tenant_id),
    INDEX idx_cost_job (job_id),
    INDEX idx_cost_created (created_at DESC),
    INDEX idx_cost_tenant_period (tenant_id, created_at)
);

-- Sessions: User sessions for dashboard auth
CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash STRING NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    INDEX idx_sessions_user (user_id),
    INDEX idx_sessions_token (token_hash),
    INDEX idx_sessions_expires (expires_at)
);

-- ============ Usage Tracking Tables ============

-- Usage events: Individual usage records for billing
CREATE TABLE usage_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    event_type STRING NOT NULL,
    quantity INT NOT NULL DEFAULT 1,
    billing_period STRING NOT NULL,
    job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
    task_id UUID REFERENCES task_nodes(id) ON DELETE SET NULL,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now(),
    INDEX idx_usage_tenant_period (tenant_id, billing_period),
    INDEX idx_usage_event_type (event_type),
    INDEX idx_usage_created (created_at DESC)
);

-- Usage monthly: Aggregated monthly usage for fast lookups
CREATE TABLE usage_monthly (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    billing_period STRING NOT NULL,
    tasks_created INT NOT NULL DEFAULT 0,
    tasks_completed INT NOT NULL DEFAULT 0,
    tasks_failed INT NOT NULL DEFAULT 0,
    jobs_created INT NOT NULL DEFAULT 0,
    api_calls INT NOT NULL DEFAULT 0,
    ai_tokens_used INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (tenant_id, billing_period),
    INDEX idx_usage_monthly_tenant (tenant_id),
    INDEX idx_usage_monthly_period (billing_period)
);

-- ============ Views ============

-- Job progress view (includes tenant_id)
CREATE VIEW job_progress AS
SELECT
    j.id,
    j.tenant_id,
    j.name,
    j.status,
    COUNT(t.id) as total_tasks,
    COUNT(*) FILTER (WHERE t.status = 'done') as completed_tasks,
    COUNT(*) FILTER (WHERE t.status IN ('claimed', 'running')) as running_tasks,
    COUNT(*) FILTER (WHERE t.status = 'failed') as failed_tasks,
    COUNT(*) FILTER (WHERE t.status = 'pending') as pending_tasks,
    j.created_at,
    j.updated_at
FROM jobs j
LEFT JOIN task_nodes t ON j.id = t.job_id
GROUP BY j.id, j.tenant_id, j.name, j.status, j.created_at, j.updated_at;

-- ============ Default Demo Tenant ============

-- Insert the demo tenant for development/unauthenticated access
INSERT INTO tenants (id, name, slug, plan, task_limit_monthly, concurrent_task_limit, memory_retention_days)
VALUES (
    '00000000-0000-0000-0000-000000000000',
    'Demo',
    'demo',
    'free',
    999999,
    100,
    365
);

-- Insert initial demo usage record
INSERT INTO usage_monthly (tenant_id, billing_period)
VALUES (
    '00000000-0000-0000-0000-000000000000',
    TO_CHAR(now(), 'YYYY-MM')
);
