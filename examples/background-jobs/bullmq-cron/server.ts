/**
 * BullMQ Cron Jobs — Repeatable Scheduled Tasks
 *
 * Demonstrates repeatable (cron-based) jobs with BullMQ and Redis.
 * Three scheduled jobs run automatically: a daily report, an hourly
 * cleanup, and a health check every 5 minutes. Includes an Express
 * API for listing, adding, and removing repeatable jobs at runtime.
 *
 * Prerequisites:
 *   Redis running on localhost:6379 (docker run -p 6379:6379 redis)
 *
 * Run: npx tsx server.ts
 * Test: curl http://localhost:3000/cron
 */

import express, { type Request, type Response } from "express";
import { Queue, Worker, type Job } from "bullmq";
import IORedis from "ioredis";

// =============================================================================
// Redis Connection
// =============================================================================

/**
 * Shared Redis connection.
 * maxRetriesPerRequest: null is required by BullMQ to prevent ioredis
 * from throwing after a fixed number of retries.
 */
const connection = new IORedis({
  host: "127.0.0.1",
  port: 6379,
  maxRetriesPerRequest: null,
});

// =============================================================================
// Types
// =============================================================================

/** Data attached to each cron job. The type field identifies the handler. */
interface CronJobData {
  type: string;
  description: string;
  runAt: string;
}

/** Result returned after a cron job finishes processing. */
interface CronJobResult {
  type: string;
  processedAt: string;
  summary: string;
}

// =============================================================================
// Queue Setup
// =============================================================================

/**
 * A dedicated queue for cron jobs. Using a separate queue from ad-hoc tasks
 * keeps repeatable job management (list, remove) isolated and predictable.
 */
const cronQueue = new Queue<CronJobData, CronJobResult>("cron-jobs", {
  connection,
  defaultJobOptions: {
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 20 },
  },
});

// =============================================================================
// Job Processors
// =============================================================================

/** Simulate generating a daily report (e.g., aggregate metrics, email to team). */
async function processDailyReport(job: Job<CronJobData>): Promise<CronJobResult> {
  const start = Date.now();

  // Simulate report generation work
  await new Promise((resolve) => setTimeout(resolve, 500));

  const duration = Date.now() - start;
  console.log(`  [daily-report] Generated report in ${duration}ms`);

  return {
    type: "daily-report",
    processedAt: new Date().toISOString(),
    summary: `Daily report generated (${duration}ms)`,
  };
}

/** Simulate cleaning up stale data (e.g., expired sessions, temp files). */
async function processHourlyCleanup(job: Job<CronJobData>): Promise<CronJobResult> {
  // Simulate scanning and deleting stale records
  const deletedCount = Math.floor(Math.random() * 20);
  await new Promise((resolve) => setTimeout(resolve, 200));

  console.log(`  [hourly-cleanup] Removed ${deletedCount} stale records`);

  return {
    type: "hourly-cleanup",
    processedAt: new Date().toISOString(),
    summary: `Cleaned up ${deletedCount} stale records`,
  };
}

/** Simulate a health check (e.g., ping external services, check disk space). */
async function processHealthCheck(job: Job<CronJobData>): Promise<CronJobResult> {
  // Simulate checking external dependencies
  const checks = {
    database: Math.random() > 0.05 ? "ok" : "degraded",
    cache: Math.random() > 0.02 ? "ok" : "down",
    disk: Math.random() > 0.01 ? "ok" : "full",
  };

  await new Promise((resolve) => setTimeout(resolve, 100));

  const allOk = Object.values(checks).every((v) => v === "ok");
  const status = allOk ? "healthy" : "degraded";
  console.log(`  [health-check] Status: ${status}`, checks);

  return {
    type: "health-check",
    processedAt: new Date().toISOString(),
    summary: `Health: ${status} (db=${checks.database}, cache=${checks.cache}, disk=${checks.disk})`,
  };
}

// =============================================================================
// Worker
// =============================================================================

/**
 * The worker dispatches to the correct processor based on the job name.
 * BullMQ uses the job name to identify repeatable jobs, so each cron
 * schedule gets its own name.
 */
const worker = new Worker<CronJobData, CronJobResult>(
  "cron-jobs",
  async (job) => {
    console.log(`[cron] Processing "${job.name}" (id=${job.id})`);

    switch (job.name) {
      case "daily-report":
        return processDailyReport(job);
      case "hourly-cleanup":
        return processHourlyCleanup(job);
      case "health-check":
        return processHealthCheck(job);
      default:
        throw new Error(`Unknown cron job type: ${job.name}`);
    }
  },
  { connection, concurrency: 2 }
);

worker.on("completed", (job) => {
  if (job) console.log(`[cron] "${job.name}" completed:`, job.returnvalue?.summary);
});

worker.on("failed", (job, err) => {
  if (job) console.error(`[cron] "${job.name}" failed:`, err.message);
});

worker.on("error", (err) => {
  console.error("Worker error:", err.message);
});

// =============================================================================
// Register Default Cron Jobs
// =============================================================================

/**
 * Register repeatable jobs on startup.
 *
 * BullMQ deduplicates repeatable jobs by (name + cron pattern + jobId).
 * If a job with the same key already exists in Redis, add() is a no-op.
 * This means restarting the server won't create duplicate schedules.
 *
 * Cron expressions (standard 5-field):
 *   minute  hour  day-of-month  month  day-of-week
 *   0       8     *             *      *          = every day at 08:00
 *   0       *     *             *      *          = every hour at :00
 *   *\/5    *     *             *      *          = every 5 minutes
 */
async function registerCronJobs(): Promise<void> {
  // Daily report at 8:00 AM
  await cronQueue.add(
    "daily-report",
    { type: "daily-report", description: "Generate and email daily metrics report", runAt: "08:00" },
    {
      repeat: { pattern: "0 8 * * *" },
      // jobId ensures deduplication — same name + same jobId = same repeatable job
      jobId: "daily-report-cron",
    }
  );

  // Hourly cleanup at the top of every hour
  await cronQueue.add(
    "hourly-cleanup",
    { type: "hourly-cleanup", description: "Remove expired sessions and temp files", runAt: "every hour" },
    {
      repeat: { pattern: "0 * * * *" },
      jobId: "hourly-cleanup-cron",
    }
  );

  // Health check every 5 minutes
  await cronQueue.add(
    "health-check",
    { type: "health-check", description: "Ping external services and check system health", runAt: "every 5 minutes" },
    {
      repeat: { pattern: "*/5 * * * *" },
      jobId: "health-check-cron",
    }
  );

  console.log("Registered 3 repeatable cron jobs");
}

// =============================================================================
// Express API
// =============================================================================

const app = express();
app.use(express.json());

const PORT = 3000;

// ---------------------------------------------------------------------------
// GET /cron — List all repeatable jobs
// ---------------------------------------------------------------------------
app.get("/cron", async (_req: Request, res: Response) => {
  const repeatableJobs = await cronQueue.getRepeatableJobs();

  const jobs = repeatableJobs.map((job) => ({
    key: job.key,
    name: job.name,
    pattern: job.pattern,
    next: job.next ? new Date(job.next).toISOString() : null,
    endDate: job.endDate ?? null,
  }));

  res.json({ data: jobs, total: jobs.length });
});

// ---------------------------------------------------------------------------
// POST /cron — Add a new repeatable job at runtime
// ---------------------------------------------------------------------------
app.post("/cron", async (req: Request, res: Response) => {
  const { name, pattern, description } = req.body;

  if (!name || !pattern) {
    res.status(400).json({ error: { message: "Fields required: name, pattern" } });
    return;
  }

  // Basic cron pattern validation (5 fields separated by spaces)
  const cronFields = pattern.trim().split(/\s+/);
  if (cronFields.length !== 5) {
    res.status(400).json({ error: { message: "Invalid cron pattern. Expected 5 fields: min hour dom month dow" } });
    return;
  }

  await cronQueue.add(
    name,
    { type: name, description: description ?? `Custom cron: ${name}`, runAt: pattern },
    {
      repeat: { pattern },
      jobId: `${name}-cron`,
    }
  );

  res.status(201).json({ data: { name, pattern, message: `Repeatable job "${name}" registered` } });
});

// ---------------------------------------------------------------------------
// DELETE /cron/:key — Remove a repeatable job by its key
// ---------------------------------------------------------------------------
app.delete("/cron/:key", async (req: Request, res: Response) => {
  const repeatableJobs = await cronQueue.getRepeatableJobs();
  const job = repeatableJobs.find((j) => j.key === req.params.key);

  if (!job) {
    res.status(404).json({ error: { message: `Repeatable job with key "${req.params.key}" not found` } });
    return;
  }

  await cronQueue.removeRepeatableByKey(req.params.key);

  res.json({ data: { key: req.params.key, message: `Repeatable job "${job.name}" removed` } });
});

// ---------------------------------------------------------------------------
// GET /cron/stats — Queue-level statistics
// ---------------------------------------------------------------------------
app.get("/cron/stats", async (_req: Request, res: Response) => {
  const [waiting, active, completed, failed, delayed, repeatable] = await Promise.all([
    cronQueue.getWaitingCount(),
    cronQueue.getActiveCount(),
    cronQueue.getCompletedCount(),
    cronQueue.getFailedCount(),
    cronQueue.getDelayedCount(),
    cronQueue.getRepeatableJobs(),
  ]);

  res.json({
    data: {
      queue: "cron-jobs",
      counts: { waiting, active, completed, failed, delayed },
      repeatableJobs: repeatable.length,
    },
  });
});

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

// =============================================================================
// Start
// =============================================================================

registerCronJobs().then(() => {
  app.listen(PORT, () => {
    console.log(`BullMQ Cron server running on http://localhost:${PORT}`);
    console.log();
    console.log("Endpoints:");
    console.log("  GET    /cron       — list all repeatable jobs");
    console.log("  POST   /cron       — add a new repeatable job");
    console.log("  DELETE /cron/:key  — remove a repeatable job");
    console.log("  GET    /cron/stats — queue statistics");
    console.log("  GET    /health     — health check");
    console.log();
    console.log("Make sure Redis is running on localhost:6379");
  });
});
