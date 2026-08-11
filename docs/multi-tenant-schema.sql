-- AgentForge Multi-Tenant Schema Design
-- CockroachDB optimized

--------------------------------------------------------------------------------
-- TENANT & AUTH LAYER
--------------------------------------------------------------------------------

-- Core tenant (organization) table
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name STRING NOT NULL,
    slug STRING NOT NULL UNIQUE,  -- URL-safe identifier (e.g., "acme-corp")

    -- Subscription & limits
    plan STRING NOT NULL DEFAULT 'free',  -- free, pro, team, enterprise
    task_limit_monthly INT DEFAULT 500,
    repo_limit INT DEFAULT 2,
    seat_limit INT DEFAULT 1,

    -- Billing (Stripe integration)
    stripe_customer_id STRING,
    stripe_subscription_id STRING,
    billing_email STRING,

    -- Settings
    settings JSONB DEFAULT '{}',

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),

    INDEX idx_tenants_slug (slug),
    INDEX idx_tenants_stripe (stripe_customer_id)
);

-- Users belong to tenants (many-to-many via memberships)
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email STRING NOT NULL UNIQUE,
    name STRING,
    avatar_url STRING,

    -- Auth (if not using external provider)
    password_hash STRING,

    -- OAuth connections
    github_id STRING UNIQUE,
    github_access_token STRING,  -- Encrypted at rest

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT now(),
    last_login_at TIMESTAMPTZ,

    INDEX idx_users_email (email),
    INDEX idx_users_github (github_id)
);

-- Tenant membership (which users belong to which orgs)
CREATE TABLE memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role STRING NOT NULL DEFAULT 'member',  -- owner, admin, member

    created_at TIMESTAMPTZ DEFAULT now(),

    UNIQUE (tenant_id, user_id),
    INDEX idx_memberships_user (user_id),
    INDEX idx_memberships_tenant (tenant_id)
);

-- API keys for programmatic access
CREATE TABLE api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,  -- Who created it

    name STRING NOT NULL,
    key_hash STRING NOT NULL UNIQUE,  -- SHA256 of the key (we never store raw)
    key_prefix STRING NOT NULL,       -- First 8 chars for identification (af_xxxx)

    scopes STRING[] DEFAULT ARRAY['read', 'write'],

    last_used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),

    INDEX idx_api_keys_tenant (tenant_id),
    INDEX idx_api_keys_hash (key_hash)
);

--------------------------------------------------------------------------------
-- CONNECTED RESOURCES
--------------------------------------------------------------------------------

-- GitHub repositories connected to tenant
CREATE TABLE repositories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    github_id BIGINT NOT NULL,
    github_full_name STRING NOT NULL,  -- "owner/repo"
    github_default_branch STRING DEFAULT 'main',

    -- Installation info
    github_installation_id BIGINT NOT NULL,

    -- Agent config for this repo
    agent_config JSONB DEFAULT '{}',

    -- Status
    is_active BOOLEAN DEFAULT true,

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),

    UNIQUE (tenant_id, github_id),
    INDEX idx_repos_tenant (tenant_id),
    INDEX idx_repos_installation (github_installation_id)
);

--------------------------------------------------------------------------------
-- JOBS & TASKS (Multi-tenant aware)
--------------------------------------------------------------------------------

-- Jobs now belong to tenants
CREATE TABLE jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    -- Optional: which repo/user triggered this
    repository_id UUID REFERENCES repositories(id) ON DELETE SET NULL,
    triggered_by UUID REFERENCES users(id) ON DELETE SET NULL,

    -- Job details
    name STRING NOT NULL,
    description STRING,
    job_type STRING NOT NULL DEFAULT 'task',  -- task, pr_review, chat, custom

    -- Status
    status STRING NOT NULL DEFAULT 'pending',
    priority INT DEFAULT 0,  -- Higher = more urgent

    -- Payloads
    input_payload JSONB NOT NULL DEFAULT '{}',
    result_payload JSONB,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,

    -- Tenant-first index for all queries
    INDEX idx_jobs_tenant_status (tenant_id, status, created_at DESC),
    INDEX idx_jobs_tenant_created (tenant_id, created_at DESC),
    INDEX idx_jobs_repo (repository_id)
);

-- Task nodes with tenant isolation
CREATE TABLE task_nodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,

    -- Task details
    task_type STRING NOT NULL,
    name STRING NOT NULL,

    -- Payloads
    input_payload JSONB NOT NULL DEFAULT '{}',
    output_payload JSONB,

    -- Execution state
    status STRING NOT NULL DEFAULT 'pending',
    claimed_by STRING,
    claimed_at TIMESTAMPTZ,
    heartbeat_at TIMESTAMPTZ,

    -- Retry handling
    attempt_count INT DEFAULT 0,
    max_attempts INT DEFAULT 3,
    error_message STRING,

    -- Dependencies (UUIDs of other task_nodes)
    depends_on UUID[] DEFAULT ARRAY[]::UUID[],

    -- Cost tracking
    tokens_used INT DEFAULT 0,
    llm_cost_cents INT DEFAULT 0,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    completed_at TIMESTAMPTZ,

    -- Critical: tenant-first indexes for isolation
    INDEX idx_tasks_tenant_claimable (tenant_id, status, created_at)
        WHERE status = 'pending',
    INDEX idx_tasks_tenant_stale (tenant_id, status, heartbeat_at)
        WHERE status = 'running',
    INDEX idx_tasks_job (job_id, status)
);

--------------------------------------------------------------------------------
-- MEMORY LAYER (Tenant-isolated learning)
--------------------------------------------------------------------------------

-- Each tenant has their own memory space
CREATE TABLE memory_vectors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    -- Context
    task_id UUID REFERENCES task_nodes(id) ON DELETE SET NULL,
    repository_id UUID REFERENCES repositories(id) ON DELETE SET NULL,

    -- Memory content
    event_type STRING NOT NULL,  -- failure, success, human_override
    task_type STRING,
    context_summary STRING NOT NULL,
    error_category STRING,
    resolution STRING,

    -- Vector embedding (for similarity search)
    embedding FLOAT8[] NOT NULL,

    -- Metadata
    metadata JSONB DEFAULT '{}',

    created_at TIMESTAMPTZ DEFAULT now(),

    -- Tenant-first for all memory queries
    INDEX idx_memory_tenant_type (tenant_id, task_type, event_type),
    INDEX idx_memory_tenant_repo (tenant_id, repository_id),
    INDEX idx_memory_tenant_created (tenant_id, created_at DESC)
);

--------------------------------------------------------------------------------
-- USAGE & BILLING
--------------------------------------------------------------------------------

-- Track every billable event
CREATE TABLE usage_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    -- What happened
    event_type STRING NOT NULL,  -- task_completed, pr_reviewed, tokens_used

    -- Quantities
    quantity INT NOT NULL DEFAULT 1,
    tokens_input INT DEFAULT 0,
    tokens_output INT DEFAULT 0,

    -- Cost (in cents, calculated at time of event)
    cost_cents INT DEFAULT 0,

    -- Context
    job_id UUID,
    task_id UUID,

    -- For billing periods
    billing_period STRING NOT NULL,  -- "2024-01" format

    created_at TIMESTAMPTZ DEFAULT now(),

    -- Efficient aggregation queries
    INDEX idx_usage_tenant_period (tenant_id, billing_period, event_type),
    INDEX idx_usage_tenant_created (tenant_id, created_at DESC)
);

-- Monthly aggregates (materialized for fast billing queries)
CREATE TABLE usage_monthly (
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    billing_period STRING NOT NULL,

    tasks_completed INT DEFAULT 0,
    prs_reviewed INT DEFAULT 0,
    tokens_input BIGINT DEFAULT 0,
    tokens_output BIGINT DEFAULT 0,
    total_cost_cents INT DEFAULT 0,

    updated_at TIMESTAMPTZ DEFAULT now(),

    PRIMARY KEY (tenant_id, billing_period)
);

--------------------------------------------------------------------------------
-- AGENT DEFINITIONS (Custom agents)
--------------------------------------------------------------------------------

-- User-defined agent workflows
CREATE TABLE agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    name STRING NOT NULL,
    slug STRING NOT NULL,
    description STRING,

    -- Workflow definition (JSON-based DSL)
    workflow_definition JSONB NOT NULL,

    -- Which repos can use this agent
    allowed_repositories UUID[] DEFAULT ARRAY[]::UUID[],

    -- Versioning
    version INT DEFAULT 1,
    is_published BOOLEAN DEFAULT false,

    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),

    UNIQUE (tenant_id, slug),
    INDEX idx_agents_tenant (tenant_id)
);

--------------------------------------------------------------------------------
-- ROW-LEVEL SECURITY POLICIES (for additional safety)
--------------------------------------------------------------------------------

-- Note: These would be enforced at the application layer in CockroachDB
-- but documented here for the security model

-- All queries MUST include tenant_id in WHERE clause
-- Application middleware validates tenant_id from JWT matches query

--------------------------------------------------------------------------------
-- HELPER VIEWS
--------------------------------------------------------------------------------

-- Claimable tasks (respects tenant isolation)
-- Workers claim tasks across all tenants but process them in isolation
CREATE VIEW claimable_tasks AS
SELECT
    t.*,
    j.priority as job_priority,
    ten.plan as tenant_plan
FROM task_nodes t
JOIN jobs j ON t.job_id = j.id
JOIN tenants ten ON t.tenant_id = ten.id
WHERE t.status = 'pending'
  AND NOT EXISTS (
    SELECT 1 FROM task_nodes dep
    WHERE dep.id = ANY(t.depends_on)
    AND dep.status NOT IN ('completed', 'skipped')
  )
ORDER BY
    CASE ten.plan
        WHEN 'enterprise' THEN 0
        WHEN 'team' THEN 1
        WHEN 'pro' THEN 2
        ELSE 3
    END,
    j.priority DESC,
    t.created_at ASC;

-- Job progress view
CREATE VIEW job_progress AS
SELECT
    j.id,
    j.tenant_id,
    j.name,
    j.status,
    COUNT(t.id) as total_tasks,
    COUNT(CASE WHEN t.status = 'completed' THEN 1 END) as completed_tasks,
    COUNT(CASE WHEN t.status = 'running' THEN 1 END) as running_tasks,
    COUNT(CASE WHEN t.status = 'failed' THEN 1 END) as failed_tasks,
    SUM(t.tokens_used) as total_tokens,
    SUM(t.llm_cost_cents) as total_cost_cents
FROM jobs j
LEFT JOIN task_nodes t ON t.job_id = j.id
GROUP BY j.id, j.tenant_id, j.name, j.status;

-- Tenant usage summary
CREATE VIEW tenant_usage_summary AS
SELECT
    t.id as tenant_id,
    t.name as tenant_name,
    t.plan,
    t.task_limit_monthly,
    COALESCE(u.tasks_completed, 0) as tasks_used,
    t.task_limit_monthly - COALESCE(u.tasks_completed, 0) as tasks_remaining,
    COALESCE(u.total_cost_cents, 0) as cost_cents_this_month
FROM tenants t
LEFT JOIN usage_monthly u ON u.tenant_id = t.id
    AND u.billing_period = to_char(now(), 'YYYY-MM');
