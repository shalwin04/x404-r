# x404-r Production Plan

> **Hackathon Deadline: August 18, 2026 @ 5:00pm EDT**
> **Days Remaining: 3**

## Hackathon Alignment

### Required: CockroachDB Tools (min 2)
- [x] **CockroachDB Cloud** - Primary database
- [ ] **Distributed Vector Indexing** - For memory/embeddings (upgrade from SQL cosine)
- [ ] **Cloud MCP Server** - Direct agent-to-database connections
- [ ] **ccloud CLI** - Control plane access for agents

### Required: AWS Services (min 1)
- [x] **AWS Lambda** - Worker and Supervisor handlers ready
- [ ] **Amazon Bedrock** - Add as AI provider option
- [ ] **S3** - Checkpoint blob storage for large states

### Judging Criteria Alignment
| Criteria | Current | Target |
|----------|---------|--------|
| Agentic Memory Design | ✅ Strong | ✅ Excellent |
| Technical Implementation | ✅ Good | ✅ Excellent |
| Real-World Impact | ⚠️ Demo only | ✅ Multiple use cases |
| Production Readiness | ⚠️ 70% | ✅ 100% |
| Creativity | ⚠️ Standard | ✅ Time Travel + Cost Transparency |

---

## Phase 1: Core Production Readiness (Day 1)

### 1.1 Testing Infrastructure
- [ ] Jest setup for all packages
- [ ] Unit tests for SDK (client, workflow, worker)
- [ ] Integration tests for task claiming
- [ ] E2E test for full workflow lifecycle

### 1.2 Fix Critical Gaps
- [ ] Persistent sessions (move from memory to DB)
- [ ] Job cancellation endpoint
- [ ] Step-level timeouts
- [ ] Proper error boundaries

### 1.3 Observability
- [ ] Structured logging (JSON format)
- [ ] Metrics collection (task duration, success rate, retries)
- [ ] Health check endpoints
- [ ] Error tracking integration ready

---

## Phase 2: Differentiation Features (Day 1-2)

### 2.1 Time Travel Debugging
```typescript
// API: Replay workflow from any checkpoint
POST /jobs/:id/replay
{
  "fromCheckpoint": "checkpoint-uuid",
  "newInput": { ... }  // optional override
}

// Dashboard: Timeline view of checkpoints
// Click any checkpoint to see state, replay from there
```

### 2.2 Cost Transparency
```typescript
// Track per-task:
interface TaskCost {
  inputTokens: number;
  outputTokens: number;
  embeddingTokens: number;
  estimatedCost: number;  // USD
}

// Dashboard: Show per-workflow cost breakdown
// "This workflow cost $0.23"
// "Crash recovery saved you $0.18 (avoided re-running 4 tasks)"
```

### 2.3 Learning Memory Dashboard
```typescript
// Expose memory system in dashboard:
// - "Similar past errors" panel
// - "Resolution suggestions" from successful recoveries
// - "Your agents learned X patterns this week"
```

### 2.4 One-Line Durability API
```typescript
// New simplified API alongside existing
import { durable } from '@x404-r/sdk';

const result = await durable('my-task', async (ctx) => {
  await ctx.checkpoint('step-1');
  const data = await fetchData();
  await ctx.checkpoint('step-2');
  return processData(data);
});
```

### 2.5 Chaos Engineering Mode
```typescript
// Built-in failure injection
const workflow = runtime.workflow('test', {
  chaos: {
    enabled: process.env.CHAOS_MODE === 'true',
    failureRate: 0.3,  // 30% of tasks fail randomly
    failAtCheckpoints: ['step-2', 'step-4'],
  }
});
```

---

## Phase 3: Dashboard Completion (Day 2)

### 3.1 Missing Pages
- [ ] `/settings` - API keys, tenant config
- [ ] `/usage` - Usage metrics, cost breakdown
- [ ] `/memory` - Learning memory explorer
- [ ] `/docs` - Embedded documentation

### 3.2 Enhanced Visualizations
- [ ] Time travel timeline component
- [ ] Cost breakdown charts
- [ ] Memory similarity graph
- [ ] Real-time log streaming

### 3.3 API Key Management UI
- [ ] Create/revoke API keys
- [ ] Scope selection
- [ ] Usage per key

---

## Phase 4: CockroachDB Deep Integration (Day 2)

### 4.1 Vector Indexing
```sql
-- Upgrade from SQL cosine to native vector index
CREATE INDEX memory_vectors_embedding_idx
ON memory_vectors USING vectorindex (embedding vector_cosine_ops);

-- Query becomes:
SELECT * FROM memory_vectors
ORDER BY embedding <=> $1
LIMIT 10;
```

### 4.2 MCP Server Integration
```typescript
// Agent can query CockroachDB directly via MCP
const mcp = new CockroachMCPClient({
  cluster: process.env.COCKROACH_CLUSTER_ID,
});

// In workflow step:
const schema = await mcp.describeTable('task_nodes');
const insights = await mcp.query('SELECT * FROM job_progress');
```

### 4.3 Change Data Capture
```sql
-- Real-time task status updates via CDC
CREATE CHANGEFEED FOR TABLE task_nodes
INTO 'webhook-url'
WITH updated, resolved;
```

---

## Phase 5: AWS Deep Integration (Day 2-3)

### 5.1 Bedrock AI Provider
```typescript
// Add Bedrock alongside Gemini/OpenAI/Anthropic
import { BedrockProvider } from '@x404-r/sdk/ai/bedrock';

const runtime = new AgentDB({
  ai: await BedrockProvider.create({
    region: 'us-east-1',
    model: 'anthropic.claude-3-sonnet',
  }),
});
```

### 5.2 Lambda Deployment
```yaml
# SAM/CDK template for production deployment
Resources:
  WorkerFunction:
    Type: AWS::Lambda::Function
    Properties:
      Runtime: nodejs20.x
      Handler: handler.handler
      Timeout: 900  # 15 minutes max
      MemorySize: 1024
      Environment:
        Variables:
          DATABASE_URL: !Ref CockroachDBUrl
          AI_PROVIDER: bedrock
```

### 5.3 S3 Checkpoint Storage
```typescript
// For large checkpoint states (>1MB)
const checkpoint = {
  small: state,  // stored in DB
  large: await s3.upload(largeBlob),  // S3 reference
};
```

---

## Phase 6: Documentation & Demo (Day 3)

### 6.1 Documentation
- [ ] README with quick start
- [ ] Architecture diagram
- [ ] API reference
- [ ] Use case examples (code review, data pipeline, support bot)

### 6.2 Demo Video (3 min)
1. **Problem** (30s): Show an agent crashing, losing all progress
2. **Solution** (30s): Introduce x404-r concept
3. **Demo** (90s):
   - Create workflow
   - Watch execution
   - Simulate crash
   - See automatic recovery
   - Show time travel debugging
   - Show cost savings
4. **Architecture** (30s): CockroachDB + AWS diagram

### 6.3 Live Demo URL
- [ ] Deploy to production (Lambda + CockroachDB Cloud)
- [ ] Public dashboard at x404r.dev or similar
- [ ] Demo credentials for judges

---

## File Structure (Final)

```
x404-r/
├── packages/
│   ├── sdk/                    # @x404-r/sdk
│   │   ├── src/
│   │   │   ├── index.ts        # Main exports
│   │   │   ├── client.ts       # AgentDB client
│   │   │   ├── workflow.ts     # WorkflowBuilder
│   │   │   ├── worker.ts       # Worker
│   │   │   ├── context.ts      # StepContext
│   │   │   ├── durable.ts      # NEW: One-line API
│   │   │   ├── chaos.ts        # NEW: Chaos engineering
│   │   │   ├── ai/
│   │   │   │   ├── index.ts
│   │   │   │   ├── gemini.ts
│   │   │   │   ├── openai.ts
│   │   │   │   ├── anthropic.ts
│   │   │   │   └── bedrock.ts  # NEW
│   │   │   └── mcp/            # NEW: MCP integration
│   │   ├── tests/              # NEW
│   │   └── examples/
│   ├── shared/                 # Shared DB/types
│   ├── worker/                 # Lambda worker
│   ├── supervisor/             # Lambda supervisor
│   └── dashboard/              # Next.js dashboard
├── infrastructure/             # CDK/SAM templates
├── scripts/
│   ├── setup-db.sql
│   ├── local-server.ts
│   └── deploy.ts               # NEW
├── docs/
│   ├── README.md
│   ├── ARCHITECTURE.md
│   ├── API.md
│   └── USE_CASES.md
└── demo/                       # Demo assets
    ├── video/
    └── screenshots/
```

---

## Priority Execution Order

### Critical Path (Must Complete)
1. ✅ Core SDK working
2. ✅ Backend working
3. [ ] Tests (confidence for judges)
4. [ ] Vector indexing upgrade
5. [ ] Dashboard completion
6. [ ] Bedrock integration
7. [ ] Demo video
8. [ ] Live deployment

### Differentiation (High Impact)
1. [ ] Time travel debugging
2. [ ] Cost transparency
3. [ ] One-line durability API

### Nice-to-Have
1. [ ] MCP server integration
2. [ ] Chaos engineering mode
3. [ ] Learning memory dashboard

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Test coverage | >80% |
| Demo uptime | 99.9% |
| Video length | <3 min |
| Documentation pages | 4+ |
| CockroachDB features used | 3+ |
| AWS services used | 2+ |
| Differentiation features | 3+ |

---

## Team Allocation (if applicable)

| Person | Focus |
|--------|-------|
| Dev 1 | SDK + Tests + Differentiation |
| Dev 2 | Dashboard + UI |
| Dev 3 | Infrastructure + Deployment |

---

*Last Updated: August 15, 2026*
