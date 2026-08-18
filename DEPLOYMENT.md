# x404-r Deployment Guide

## Quick Start (Local)

```bash
# Start backend API
npm run dev:server    # http://localhost:3001

# Start dashboard (new terminal)
npm run dev:dashboard # http://localhost:3000
```

## SDK Publishing

### 1. Login to npm
```bash
npm login
```

### 2. Publish SDK
```bash
cd packages/sdk
npm publish --access public
```

The SDK will be available as `@x404-r/sdk` on npm.

## Docker Deployment

### Prerequisites
- Docker and Docker Compose installed
- `.env` file configured

### Deploy
```bash
# Build and start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop
docker-compose down
```

Services:
- **Dashboard**: http://localhost:3000
- **API**: http://localhost:3001
- **CockroachDB Admin**: http://localhost:8080

## Cloud Deployment Options

### Option 1: AWS (EC2 + Docker)

```bash
# On EC2 instance
git clone <your-repo>
cd x404-r
cp .env.example .env
# Edit .env with your credentials

docker-compose up -d
```

### Option 2: Vercel (Dashboard) + AWS Lambda (API)

**Dashboard to Vercel:**
```bash
cd packages/dashboard
vercel deploy --prod
```

**API to Lambda (CDK):**
```bash
cd infrastructure
npm install
npx cdk deploy
```

### Option 3: Railway/Render (Easiest)

1. Connect your GitHub repo
2. Set environment variables
3. Deploy

## Environment Variables

Required in `.env`:
```bash
# Database
DATABASE_URL=postgresql://user:pass@host:26257/x404r

# AI Provider
GEMINI_API_KEY=your-key

# Optional
DEMO_MODE=true
```

## CockroachDB Setup

### Local (Docker)
```bash
docker run -d --name cockroach \
  -p 26257:26257 -p 8080:8080 \
  cockroachdb/cockroach:v23.2.0 start-single-node --insecure
```

### Cloud (CockroachDB Cloud)
1. Go to https://cockroachlabs.cloud
2. Create free cluster
3. Get connection string
4. Update `DATABASE_URL` in `.env`

## Hackathon Submission Checklist

- [x] SDK with dual mode (embedded/cloud)
- [x] Dashboard for visualization
- [x] CockroachDB integration (2+ tools)
  - FOR UPDATE SKIP LOCKED
  - Vector storage
  - Distributed transactions
- [x] AWS integration (Lambda ready)
- [x] Docker deployment ready
- [x] MIT License
- [ ] npm publish
- [ ] Live demo URL
- [ ] Video demo (< 3 min)

## URLs After Deployment

| Service | Local | Production |
|---------|-------|------------|
| Dashboard | http://localhost:3000 | https://x404r.vercel.app |
| API | http://localhost:3001 | https://api.x404r.io |
| SDK | npm pack (local) | npm install @x404-r/sdk |
