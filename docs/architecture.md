# AgentForge Multi-Tenant Architecture

## Overview

AgentForge is designed as a **shared-nothing** multi-tenant platform where:
- All tenants share the same worker pool
- Data is isolated at the row level (tenant_id on every table)
- Workers are stateless and can process any tenant's tasks
- Memory/learning is tenant-scoped (no cross-tenant data leakage)

---

## Security Layers

```
┌─────────────────────────────────────────────────────────────────────┐
│                         LAYER 1: API Gateway                        │
│  • JWT validation (tenant_id in claims)                            │
│  • Rate limiting per tenant (Redis)                                │
│  • API key validation                                               │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       LAYER 2: Application                          │
│  • Tenant context middleware (extracts & validates tenant_id)      │
│  • Query builder auto-injects tenant_id in all queries             │
│  • Secrets encrypted with tenant-specific keys                     │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       LAYER 3: Database                             │
│  • All tables have tenant_id column                                │
│  • Composite indexes start with tenant_id                          │
│  • Foreign keys within tenant (enforced by app)                    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Worker Isolation Model

### Problem
Workers process tasks from multiple tenants. How do we prevent:
1. Data leakage between tenants
2. One tenant's workload affecting another (noisy neighbor)
3. Credential/secret exposure

### Solution

```
                    ┌─────────────────────────────────────────┐
                    │           Task Queue (DB)               │
                    │  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐       │
                    │  │ T:A │ │ T:B │ │ T:A │ │ T:C │       │
                    │  └─────┘ └─────┘ └─────┘ └─────┘       │
                    └──────────────┬──────────────────────────┘
                                   │
                    ┌──────────────┴──────────────┐
                    ▼                              ▼
           ┌────────────────┐             ┌────────────────┐
           │   Worker 1     │             │   Worker 2     │
           │                │             │                │
           │ Claims: T:A    │             │ Claims: T:B    │
           │                │             │                │
           │ ┌────────────┐ │             │ ┌────────────┐ │
           │ │ Sandbox    │ │             │ │ Sandbox    │ │
           │ │ - tenant A │ │             │ │ - tenant B │ │
           │ │ - secrets  │ │             │ │ - secrets  │ │
           │ │ - repo     │ │             │ │ - repo     │ │
           │ └────────────┘ │             │ └────────────┘ │
           └────────────────┘             └────────────────┘
```

### Task Execution Sandbox

Each task runs in an isolated context:

```typescript
interface TaskContext {
  // Tenant isolation
  tenantId: string;

  // Scoped database client (auto-injects tenant_id)
  db: TenantScopedDB;

  // Tenant-specific secrets (decrypted at runtime)
  secrets: {
    githubToken: string;
    llmApiKey: string;
  };

  // Scoped memory (only this tenant's learnings)
  memory: TenantMemory;

  // Resource limits
  limits: {
    maxTokens: number;
    maxDurationMs: number;
    maxRetries: number;
  };
}
```

### Code Execution Isolation (for custom agents)

When running user-defined code:

```
┌─────────────────────────────────────────────┐
│              Worker Lambda                   │
│                                             │
│  ┌───────────────────────────────────────┐  │
│  │     Firecracker microVM / gVisor      │  │
│  │  ┌─────────────────────────────────┐  │  │
│  │  │    User's Agent Code            │  │  │
│  │  │    - No network (except API)    │  │  │
│  │  │    - No filesystem (except /tmp)│  │  │
│  │  │    - CPU/Memory limits          │  │  │
│  │  │    - Timeout enforcement        │  │  │
│  │  └─────────────────────────────────┘  │  │
│  └───────────────────────────────────────┘  │
│                                             │
└─────────────────────────────────────────────┘
```

Options for isolation:
1. **AWS Lambda** - Built-in isolation per invocation
2. **Firecracker microVMs** - Sub-second startup, strong isolation
3. **gVisor** - Container sandboxing (less overhead)
4. **Deno** - V8 isolates with permissions

---

## Rate Limiting & Quotas

### Multi-Layer Rate Limiting

```typescript
// Layer 1: Global rate limit (protect infrastructure)
const globalLimit = rateLimit({
  windowMs: 1000,
  max: 10000,  // 10k req/sec across all tenants
});

// Layer 2: Per-tenant rate limit
const tenantLimit = rateLimit({
  windowMs: 60000,
  max: (tenant) => PLAN_LIMITS[tenant.plan].requestsPerMinute,
  keyGenerator: (req) => req.tenantId,
});

// Layer 3: Per-endpoint rate limit
const endpointLimit = rateLimit({
  windowMs: 60000,
  max: 100,
  keyGenerator: (req) => `${req.tenantId}:${req.path}`,
});
```

### Quota Enforcement

```typescript
async function checkQuota(tenantId: string, action: string): Promise<boolean> {
  const tenant = await getTenant(tenantId);
  const usage = await getMonthlyUsage(tenantId);

  switch (action) {
    case 'create_task':
      if (usage.tasks >= tenant.taskLimitMonthly) {
        throw new QuotaExceededError('Monthly task limit reached');
      }
      break;
    case 'connect_repo':
      const repoCount = await countRepositories(tenantId);
      if (repoCount >= tenant.repoLimit) {
        throw new QuotaExceededError('Repository limit reached');
      }
      break;
  }

  return true;
}
```

---

## Priority & Fair Scheduling

Workers claim tasks based on:
1. **Tenant plan** (enterprise > team > pro > free)
2. **Job priority** (user-set priority within tenant)
3. **FIFO** (within same priority)

```sql
-- Task claiming query with fair scheduling
WITH next_task AS (
  SELECT t.id
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
    -- Plan priority
    CASE ten.plan
      WHEN 'enterprise' THEN 0
      WHEN 'team' THEN 1
      WHEN 'pro' THEN 2
      ELSE 3
    END,
    -- Job priority within plan
    j.priority DESC,
    -- FIFO within priority
    t.created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
UPDATE task_nodes
SET status = 'running',
    claimed_by = $1,
    claimed_at = now(),
    heartbeat_at = now()
FROM next_task
WHERE task_nodes.id = next_task.id
RETURNING *;
```

### Anti-Starvation

Free tier tasks don't starve forever:

```typescript
// If a free-tier task has been waiting > 30 seconds, boost priority
const STARVATION_BOOST_MS = 30000;

// In claiming query, add age factor
ORDER BY
  CASE
    WHEN ten.plan = 'free'
      AND t.created_at < now() - INTERVAL '30 seconds'
    THEN 1  -- Boost starving free tasks
    ELSE plan_priority
  END,
  ...
```

---

## Data Residency & Compliance

### For Enterprise Tenants

```
┌─────────────────────────────────────────────────────────────────┐
│                    Multi-Region Architecture                     │
│                                                                  │
│   US Region (us-east-1)          EU Region (eu-west-1)          │
│   ┌─────────────────┐            ┌─────────────────┐            │
│   │  CockroachDB    │            │  CockroachDB    │            │
│   │  (US tenants)   │◀──sync────▶│  (EU tenants)   │            │
│   └─────────────────┘            └─────────────────┘            │
│          │                              │                        │
│          ▼                              ▼                        │
│   ┌─────────────────┐            ┌─────────────────┐            │
│   │  Worker Pool    │            │  Worker Pool    │            │
│   │  (US)           │            │  (EU)           │            │
│   └─────────────────┘            └─────────────────┘            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Tenant Configuration

```sql
-- Add region preference to tenants
ALTER TABLE tenants ADD COLUMN data_region STRING DEFAULT 'us';

-- Workers only process tasks from their region
WHERE ten.data_region = $WORKER_REGION
```

---

## Secrets Management

### Secret Storage

```
┌─────────────────────────────────────────────────────────────┐
│                   Secrets Architecture                       │
│                                                              │
│   ┌─────────────┐     ┌─────────────┐     ┌─────────────┐   │
│   │   Tenant    │     │   AWS KMS   │     │  Database   │   │
│   │   Secret    │────▶│   Encrypt   │────▶│   Store     │   │
│   └─────────────┘     └─────────────┘     └─────────────┘   │
│                              │                               │
│                    ┌─────────┴─────────┐                    │
│                    │  Per-Tenant Key   │                    │
│                    │  (DEK encrypted   │                    │
│                    │   by master KEK)  │                    │
│                    └───────────────────┘                    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

```typescript
// Secrets table (encrypted at rest)
interface TenantSecret {
  tenantId: string;
  name: string;  // 'github_token', 'openai_key', etc.
  encryptedValue: string;  // AES-256-GCM encrypted
  keyVersion: number;  // For key rotation
}

// At runtime, decrypt only what's needed
async function getSecretForTask(tenantId: string, secretName: string) {
  const encrypted = await db.getSecret(tenantId, secretName);
  const dekKey = await kms.decrypt(encrypted.dekCiphertext);
  return decrypt(encrypted.value, dekKey);
}
```

---

## Audit Logging

Every action logged for compliance:

```sql
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,

    -- Who
    actor_type STRING NOT NULL,  -- user, api_key, system, worker
    actor_id STRING,

    -- What
    action STRING NOT NULL,  -- job.create, task.complete, repo.connect
    resource_type STRING NOT NULL,
    resource_id STRING,

    -- Context
    ip_address INET,
    user_agent STRING,
    request_id STRING,

    -- Details
    metadata JSONB DEFAULT '{}',

    created_at TIMESTAMPTZ DEFAULT now(),

    INDEX idx_audit_tenant_time (tenant_id, created_at DESC),
    INDEX idx_audit_tenant_action (tenant_id, action, created_at DESC)
);
```

---

## Metrics & Observability

### Hybrid Metrics Flow

The system uses a hybrid approach combining derived metrics (from database state) with SDK-persisted snapshots:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Metrics Architecture                               │
│                                                                              │
│   SDK User Application                                                       │
│   ┌─────────────────────────────────────────────────────────┐               │
│   │  const metrics = new MetricsCollector();                │               │
│   │  metrics.setDatabase({ pool, tenantId, flushIntervalMs: 30000 });       │
│   │                                                         │               │
│   │  // In-memory tracking                                  │               │
│   │  metrics.taskStarted(id, type, workflowId);            │               │
│   │  metrics.taskCompleted(id, type, workflowId);          │               │
│   │  metrics.aiTokensUsed('gemini', 500, 200);             │               │
│   │                                                         │               │
│   │  // Automatic flush every 30s → CockroachDB            │               │
│   └────────────────────────┬────────────────────────────────┘               │
│                            │ flush()                                         │
│                            ▼                                                 │
│   ┌─────────────────────────────────────────────────────────┐               │
│   │                    CockroachDB                          │               │
│   │  ┌─────────────────┐  ┌─────────────────────────────┐  │               │
│   │  │ metrics_snapshots│  │ task_nodes, jobs, checkpoints│  │               │
│   │  │ (SDK snapshots) │  │ (live state)                │  │               │
│   │  └────────┬────────┘  └──────────────┬──────────────┘  │               │
│   │           │                          │                  │               │
│   └───────────┼──────────────────────────┼──────────────────┘               │
│               │                          │                                   │
│               ▼                          ▼                                   │
│   ┌─────────────────────────────────────────────────────────┐               │
│   │                    API Server                            │               │
│   │  GET /metrics         → Derived from live state         │               │
│   │  GET /metrics/history → SDK snapshots (time-series)     │               │
│   └────────────────────────┬────────────────────────────────┘               │
│                            │                                                 │
│                            ▼                                                 │
│   ┌─────────────────────────────────────────────────────────┐               │
│   │                    Dashboard                             │               │
│   │  • Real-time metrics (derived)                          │               │
│   │  • Historical trends (SDK snapshots)                    │               │
│   │  • Per-task latency, AI costs, reliability             │               │
│   └─────────────────────────────────────────────────────────┘               │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### SDK Usage for Metrics

```typescript
import { MetricsCollector } from '@x404-r/sdk';
import { Pool } from 'pg';

// Create collector with database persistence
const metrics = new MetricsCollector();

metrics.setDatabase({
  pool: new Pool({ connectionString: process.env.DATABASE_URL }),
  tenantId: 'your-tenant-id',
  flushIntervalMs: 30000,  // Flush every 30 seconds
  enabled: true,
});

// Track metrics during execution
metrics.taskStarted(taskId, taskType, workflowId);
metrics.aiTokensUsed('gemini-2.5-flash', inputTokens, outputTokens);
metrics.taskCompleted(taskId, taskType, workflowId);

// Get in-memory summary
const summary = metrics.getSummary();

// Query historical metrics
const history = await metrics.getHistory({ hours: 24 });
const hourly = await metrics.getHourlyMetrics(24);

// Graceful shutdown
await metrics.shutdown();
```

### Metrics Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /metrics` | Real-time derived metrics from database state |
| `GET /metrics/history?hours=24&granularity=hourly` | Aggregated hourly metrics |
| `GET /metrics/history?hours=1&granularity=raw` | Raw SDK snapshots |

### Metrics Schema

```sql
CREATE TABLE metrics_snapshots (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    snapshot_type STRING,  -- 'periodic', 'flush', 'shutdown'

    -- Execution metrics
    tasks_completed INT,
    tasks_failed INT,
    success_rate DECIMAL,
    throughput_per_min DECIMAL,

    -- Cost metrics
    total_cost_usd DECIMAL,
    tokens_input INT,
    tokens_output INT,

    -- Performance metrics
    latency_p50_ms DECIMAL,
    latency_p95_ms DECIMAL,
    latency_p99_ms DECIMAL,
    ai_latency_ms DECIMAL,

    -- Full snapshot for detailed analysis
    full_snapshot JSONB,

    created_at TIMESTAMPTZ DEFAULT now()
);
```

---

## Summary: Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Isolation** | Row-level (tenant_id) | Cost-effective, simple ops |
| **Worker model** | Shared pool | Better utilization, simpler scaling |
| **Secrets** | Per-tenant encryption keys | Compliance, key rotation |
| **Scheduling** | Plan-based priority | Revenue alignment |
| **Code execution** | Firecracker/Lambda | Strong isolation for custom agents |
| **Data residency** | Region-tagged tenants | EU compliance ready |
