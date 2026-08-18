#!/bin/bash
# ============================================
# x404-r Deployment Script
# ============================================

set -e

echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║                    x404-r Deployment                          ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check which deployment type
DEPLOY_TYPE=${1:-"all"}

case $DEPLOY_TYPE in
  "sdk")
    echo "📦 Publishing SDK to npm..."
    cd packages/sdk
    npm run build
    npm publish --access public
    echo -e "${GREEN}✓ SDK published to npm${NC}"
    ;;

  "docker")
    echo "🐳 Deploying with Docker Compose..."

    # Check if .env exists
    if [ ! -f .env ]; then
      echo -e "${YELLOW}⚠ No .env file found. Copying from .env.example...${NC}"
      cp .env.example .env
      echo -e "${YELLOW}⚠ Please edit .env with your API keys before running again${NC}"
      exit 1
    fi

    # Build and start
    docker-compose build
    docker-compose up -d

    echo ""
    echo -e "${GREEN}✓ Services started!${NC}"
    echo ""
    echo "  Dashboard: http://localhost:3000"
    echo "  API:       http://localhost:3001"
    echo "  CockroachDB: http://localhost:8080"
    echo ""
    echo "  View logs: docker-compose logs -f"
    echo "  Stop:      docker-compose down"
    ;;

  "local")
    echo "🖥  Starting local development..."

    # Start CockroachDB in background
    echo "Starting CockroachDB..."
    docker run -d --name x404r-cockroach \
      -p 26257:26257 -p 8080:8080 \
      cockroachdb/cockroach:v23.2.0 start-single-node --insecure || true

    # Wait for DB
    sleep 5

    # Initialize DB
    echo "Initializing database..."
    docker exec x404r-cockroach ./cockroach sql --insecure \
      -e "CREATE DATABASE IF NOT EXISTS x404r;" || true

    cat scripts/setup-db.sql | docker exec -i x404r-cockroach \
      ./cockroach sql --insecure --database=x404r || true

    echo ""
    echo -e "${GREEN}✓ CockroachDB ready!${NC}"
    echo ""
    echo "  Admin UI: http://localhost:8080"
    echo "  SQL:      postgresql://root@localhost:26257/x404r"
    echo ""
    echo "  Now run in separate terminals:"
    echo "    npm run dev:server    # Start API server"
    echo "    npm run dev:dashboard # Start dashboard"
    ;;

  "all")
    echo "Deploying everything..."
    $0 docker
    ;;

  *)
    echo "Usage: $0 [sdk|docker|local|all]"
    echo ""
    echo "  sdk    - Publish SDK to npm"
    echo "  docker - Deploy with Docker Compose"
    echo "  local  - Start local development (CockroachDB)"
    echo "  all    - Deploy everything"
    exit 1
    ;;
esac

echo ""
echo -e "${GREEN}✅ Deployment complete!${NC}"
