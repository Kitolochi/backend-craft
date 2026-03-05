/**
 * Production-Ready Express API with Docker
 *
 * This server demonstrates the patterns needed for a containerized Node.js
 * API that behaves well in orchestration environments (Docker Compose,
 * Kubernetes, ECS, etc.):
 *
 *   - Health check endpoint (liveness probe)
 *   - Readiness endpoint (readiness probe)
 *   - Graceful shutdown on SIGTERM/SIGINT
 *   - Connection draining with timeout
 *   - Uncaught exception and rejection handlers
 *
 * Liveness vs. Readiness:
 *   - /health (liveness): "Is the process alive?" — if this fails, restart it.
 *   - /ready (readiness): "Can it serve traffic?" — if this fails, stop
 *     routing traffic but don't restart. The process might be warming up,
 *     waiting for a database, or draining connections during shutdown.
 *
 * Environment variables:
 *   PORT              — server port (default: 3000)
 *   NODE_ENV          — environment name (default: "development")
 *   SHUTDOWN_TIMEOUT  — max seconds to wait for connections to drain (default: 30)
 */

import express, { Request, Response } from "express";
import { createServer, Server } from "http";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = Number(process.env.PORT) || 3000;
const NODE_ENV = process.env.NODE_ENV ?? "development";
const SHUTDOWN_TIMEOUT = Number(process.env.SHUTDOWN_TIMEOUT) || 30;

/** Application version — in production, inject this at build time. */
const APP_VERSION = process.env.APP_VERSION ?? "1.0.0";

/** Tracks whether the server is ready to accept traffic. */
let isReady = true;

/** Tracks whether shutdown has been initiated. */
let isShuttingDown = false;

/** Server start time — used to calculate uptime. */
const startedAt = Date.now();

// ---------------------------------------------------------------------------
// Express App
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());

// ---------------------------------------------------------------------------
// Middleware: reject requests during shutdown
// ---------------------------------------------------------------------------

/**
 * Once shutdown is initiated, return 503 for all new requests.
 * Existing in-flight requests are allowed to complete.
 */
app.use((req: Request, res: Response, next) => {
  if (isShuttingDown) {
    res.setHeader("Connection", "close");
    res.status(503).json({
      error: "Service is shutting down",
      retryAfter: SHUTDOWN_TIMEOUT,
    });
    return;
  }
  next();
});

// ---------------------------------------------------------------------------
// GET /health — Liveness probe
// ---------------------------------------------------------------------------

/**
 * Returns basic health information.
 *
 * This endpoint should be fast and not depend on external services.
 * If the process can respond to HTTP, it's alive.
 *
 * Docker HEALTHCHECK and Kubernetes livenessProbe should target this endpoint.
 */
app.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    uptime: Math.floor((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
    version: APP_VERSION,
    environment: NODE_ENV,
  });
});

// ---------------------------------------------------------------------------
// GET /ready — Readiness probe
// ---------------------------------------------------------------------------

/**
 * Indicates whether the service can accept traffic.
 *
 * Unlike /health, this endpoint checks external dependencies.
 * If any critical dependency is down, return 503 so the load balancer
 * stops routing traffic to this instance.
 *
 * Common checks:
 *   - Database connection pool is healthy
 *   - Redis is reachable
 *   - Required config/secrets are loaded
 *   - Startup initialization is complete
 */
app.get("/ready", async (_req: Request, res: Response) => {
  if (!isReady || isShuttingDown) {
    res.status(503).json({
      status: "not_ready",
      reason: isShuttingDown ? "shutting_down" : "dependencies_unavailable",
    });
    return;
  }

  // In a real application, check your dependencies here:
  const checks = await checkDependencies();

  if (!checks.healthy) {
    res.status(503).json({
      status: "not_ready",
      checks: checks.results,
    });
    return;
  }

  res.json({
    status: "ready",
    checks: checks.results,
  });
});

// ---------------------------------------------------------------------------
// GET /api/info — Sample API route
// ---------------------------------------------------------------------------

app.get("/api/info", (_req: Request, res: Response) => {
  res.json({
    name: "docker-api-example",
    version: APP_VERSION,
    environment: NODE_ENV,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    pid: process.pid,
    memory: {
      rss: `${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`,
      heapUsed: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
      heapTotal: `${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)}MB`,
    },
  });
});

// ---------------------------------------------------------------------------
// Dependency Checks (placeholder)
// ---------------------------------------------------------------------------

interface DependencyCheckResult {
  healthy: boolean;
  results: Record<string, { status: string; latencyMs?: number }>;
}

/**
 * Checks external dependencies.
 *
 * Replace these placeholders with real checks for your stack:
 *   - pg: pool.query('SELECT 1')
 *   - redis: client.ping()
 *   - external API: fetch health endpoint
 */
async function checkDependencies(): Promise<DependencyCheckResult> {
  const results: DependencyCheckResult["results"] = {};

  // Placeholder: database check
  try {
    const start = Date.now();
    // await db.query('SELECT 1');
    await new Promise((resolve) => setTimeout(resolve, 1)); // Simulated
    results.database = { status: "ok", latencyMs: Date.now() - start };
  } catch {
    results.database = { status: "error" };
  }

  // Placeholder: Redis check
  try {
    const start = Date.now();
    // await redis.ping();
    await new Promise((resolve) => setTimeout(resolve, 1)); // Simulated
    results.redis = { status: "ok", latencyMs: Date.now() - start };
  } catch {
    results.redis = { status: "error" };
  }

  const healthy = Object.values(results).every((r) => r.status === "ok");
  return { healthy, results };
}

// ---------------------------------------------------------------------------
// Graceful Shutdown
// ---------------------------------------------------------------------------

/**
 * Graceful shutdown sequence:
 *
 *   1. Mark the server as "not ready" — load balancers stop sending traffic
 *   2. Stop accepting new connections
 *   3. Wait for in-flight requests to complete (up to SHUTDOWN_TIMEOUT)
 *   4. Close database/cache connections
 *   5. Exit cleanly with code 0
 *
 * This prevents dropped requests during deployments and scaling events.
 * Kubernetes sends SIGTERM, waits terminationGracePeriodSeconds, then SIGKILL.
 * Docker Compose sends SIGTERM, waits stop_grace_period, then SIGKILL.
 */
function gracefulShutdown(server: Server, signal: string): void {
  if (isShuttingDown) return; // Prevent double-shutdown
  isShuttingDown = true;
  isReady = false;

  console.log(`\n[${signal}] Shutdown initiated. Draining connections...`);

  // Force-close after the timeout expires.
  const forceCloseTimer = setTimeout(() => {
    console.error(
      `Shutdown timed out after ${SHUTDOWN_TIMEOUT}s. Forcing exit.`
    );
    process.exit(1);
  }, SHUTDOWN_TIMEOUT * 1000);

  // Don't let the timer keep the process alive if everything else finishes.
  forceCloseTimer.unref();

  // Stop accepting new connections and wait for existing ones to finish.
  server.close(async () => {
    console.log("All connections drained.");

    // Close external connections (database pools, Redis clients, etc.)
    try {
      await closeDependencies();
      console.log("Dependencies closed. Exiting cleanly.");
    } catch (err) {
      console.error("Error closing dependencies:", err);
    }

    process.exit(0);
  });
}

/**
 * Close external connections.
 *
 * Replace these placeholders with your real cleanup:
 *   - await db.end()
 *   - await redis.quit()
 *   - await queue.close()
 */
async function closeDependencies(): Promise<void> {
  // Placeholder: close database pool
  // await db.end();

  // Placeholder: close Redis client
  // await redis.quit();

  console.log("  Database pool closed (placeholder).");
  console.log("  Redis client closed (placeholder).");
}

// ---------------------------------------------------------------------------
// Process Event Handlers
// ---------------------------------------------------------------------------

/**
 * Uncaught exceptions indicate a bug — the process state may be corrupt.
 * Log the error and exit. The container orchestrator will restart the process.
 *
 * Do NOT try to "recover" from uncaught exceptions — that leads to
 * undefined behavior (half-written transactions, leaked resources, etc.).
 */
process.on("uncaughtException", (err: Error) => {
  console.error("UNCAUGHT EXCEPTION — shutting down:", err);
  process.exit(1);
});

/**
 * Unhandled promise rejections are bugs too (usually a missing await or catch).
 * Starting in Node 15+, these cause the process to exit by default.
 * We log and exit explicitly for clarity.
 */
process.on("unhandledRejection", (reason: unknown) => {
  console.error("UNHANDLED REJECTION — shutting down:", reason);
  process.exit(1);
});

// ---------------------------------------------------------------------------
// Start Server
// ---------------------------------------------------------------------------

const server = createServer(app);

// Register signal handlers AFTER the server is created.
process.on("SIGTERM", () => gracefulShutdown(server, "SIGTERM"));
process.on("SIGINT", () => gracefulShutdown(server, "SIGINT"));

server.listen(PORT, () => {
  console.log(`API server running on http://localhost:${PORT}`);
  console.log(`Environment: ${NODE_ENV} | Version: ${APP_VERSION}`);
  console.log(`Shutdown timeout: ${SHUTDOWN_TIMEOUT}s`);
  console.log();
  console.log("Endpoints:");
  console.log("  GET /health     — liveness probe");
  console.log("  GET /ready      — readiness probe");
  console.log("  GET /api/info   — application info");
});
