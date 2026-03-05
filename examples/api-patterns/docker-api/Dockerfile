# =============================================================================
# Multi-stage Dockerfile for a Node.js TypeScript API
#
# Stage 1 (build):  Install all deps, compile TypeScript
# Stage 2 (production): Copy compiled JS + production deps only
#
# This produces a small, secure image with no dev dependencies,
# no TypeScript source, and no build tools.
#
# Build:  docker build -t docker-api .
# Run:    docker run -p 3000:3000 docker-api
# =============================================================================

# ---------------------------------------------------------------------------
# Stage 1: Build
# ---------------------------------------------------------------------------
FROM node:20-alpine AS build

# Set working directory
WORKDIR /app

# Copy package files first (Docker layer caching — deps change less often
# than source code, so this layer is cached across builds).
COPY package.json package-lock.json* ./

# Install ALL dependencies (including devDependencies for TypeScript compiler).
RUN npm ci

# Copy source code and TypeScript config.
COPY tsconfig.json ./
COPY server.ts ./

# Compile TypeScript to JavaScript.
RUN npx tsc

# ---------------------------------------------------------------------------
# Stage 2: Production
# ---------------------------------------------------------------------------
FROM node:20-alpine AS production

# Metadata labels — useful for image registries and CI/CD.
LABEL maintainer="developer@example.com"
LABEL org.opencontainers.image.title="docker-api-example"
LABEL org.opencontainers.image.description="Production Node.js TypeScript API"
LABEL org.opencontainers.image.version="1.0.0"

# Set working directory
WORKDIR /app

# Copy package files and install production dependencies only.
# --omit=dev excludes devDependencies (TypeScript, tsx, types, etc.).
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled JavaScript from the build stage.
COPY --from=build /app/dist ./dist

# ---------------------------------------------------------------------------
# Security: Run as non-root user
#
# By default, Docker runs containers as root. This is a security risk —
# if an attacker exploits a vulnerability, they get root access inside
# the container (and potentially escape to the host).
#
# Create a dedicated user with no login shell and no home directory.
# ---------------------------------------------------------------------------
RUN addgroup --system --gid 1001 appgroup && \
    adduser --system --uid 1001 --ingroup appgroup appuser

USER appuser

# Expose the port (documentation — doesn't actually publish the port).
EXPOSE 3000

# Environment defaults
ENV NODE_ENV=production
ENV PORT=3000

# ---------------------------------------------------------------------------
# Health check
#
# Docker uses this to determine if the container is healthy.
# If the health check fails, Docker marks the container as "unhealthy"
# and orchestrators can restart it.
#
# --interval:    time between checks
# --timeout:     max time to wait for a response
# --start-period: grace period after container start (for slow-starting apps)
# --retries:     consecutive failures before marking unhealthy
# ---------------------------------------------------------------------------
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Start the application.
# Use "node" directly (not npm/npx) — it receives signals properly and
# avoids the overhead of an extra process.
CMD ["node", "dist/server.js"]
