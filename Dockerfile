# ============================================
# x404-r Production Dockerfile
# ============================================
# Multi-stage build for optimal image size

# Stage 1: Dependencies
FROM node:20-alpine AS deps
WORKDIR /app

# Install build dependencies for native modules
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/sdk/package.json ./packages/sdk/
COPY packages/worker/package.json ./packages/worker/
COPY packages/supervisor/package.json ./packages/supervisor/

# Install dependencies
RUN npm ci --only=production

# Stage 2: Builder
FROM node:20-alpine AS builder
WORKDIR /app

# Copy deps from previous stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/packages/sdk/node_modules ./packages/sdk/node_modules
COPY --from=deps /app/packages/worker/node_modules ./packages/worker/node_modules
COPY --from=deps /app/packages/supervisor/node_modules ./packages/supervisor/node_modules

# Copy source code
COPY . .

# Build all packages
RUN npm run build --workspaces --if-present

# Stage 3: Production runtime
FROM node:20-alpine AS runner
WORKDIR /app

# Security: run as non-root
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 x404r
USER x404r

# Copy built artifacts
COPY --from=builder --chown=x404r:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=x404r:nodejs /app/packages ./packages
COPY --from=builder --chown=x404r:nodejs /app/scripts ./scripts
COPY --from=builder --chown=x404r:nodejs /app/package.json ./package.json
COPY --from=builder --chown=x404r:nodejs /app/tsconfig.base.json ./tsconfig.base.json

# Environment
ENV NODE_ENV=production
ENV PORT=3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/ready || exit 1

# Expose port
EXPOSE 3001

# Start server
CMD ["npx", "tsx", "scripts/local-server.ts"]
