/**
 * BullMQ Basic — Queue + Worker + Job Lifecycle
 *
 * Demonstrates background job processing with BullMQ and Redis.
 * Covers three job types (email, report generation, image processing),
 * the full job lifecycle (add, process, complete, fail, retry), and
 * an Express API for submitting and inspecting jobs.
 *
 * Prerequisites:
 *   Redis running on localhost:6379 (docker run -p 6379:6379 redis)
 *
 * Run: npx tsx src/server.ts
 * Test: curl -X POST http://localhost:3000/jobs/email \
 *         -H "Content-Type: application/json" \
 *         -d '{"to":"user@example.com","subject":"Hello","body":"Welcome!"}'
 *
 * Dashboard:
 *   For a production UI, add @bull-board/express + @bull-board/api:
 *     import { createBullBoard } from "@bull-board/api";
 *     import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
 *     import { ExpressAdapter } from "@bull-board/express";
 *   Then mount the board on /admin/queues. See bull-board docs for full setup.
 */

import express, { type Request, type Response } from "express";
import { Queue, Worker, type Job } from "bullmq";
import IORedis from "ioredis";

// =============================================================================
// Redis Connection
// =============================================================================

/**
 * Shared Redis connection options.
 * BullMQ uses ioredis under the hood. In production you would read
 * the connection string from an environment variable:
 *   const connection = new IORedis(process.env.REDIS_URL);
 *
 * maxRetriesPerRequest: null is required by BullMQ to prevent
 * ioredis from throwing after a fixed number of retries.
 */
const connection = new IORedis({
  host: "127.0.0.1",
  port: 6379,
  maxRetriesPerRequest: null,
});

// =============================================================================
// Types — Job Data & Results
// =============================================================================

/** Data for a "send email" job. */
interface EmailJobData {
  to: string;
  subject: string;
  body: string;
}

/** Data for a "generate report" job. */
interface ReportJobData {
  reportType: "daily" | "weekly" | "monthly";
  startDate: string;
  endDate: string;
}

/** Data for an "image processing" job. */
interface ImageJobData {
  imageUrl: string;
  operations: Array<"resize" | "compress" | "watermark">;
  outputFormat: "png" | "jpeg" | "webp";
}

/** Union of all job data types, discriminated by the job name. */
type JobDataMap = {
  email: EmailJobData;
  report: ReportJobData;
  image: ImageJobData;
};

/** Result returned by a completed job. */
interface JobResult {
  success: boolean;
  processedAt: string;
  details: string;
}

// =============================================================================
// Queue Setup
// =============================================================================

/**
 * A single queue handles all three job types. Jobs are distinguished by
 * their "name" field. In larger systems you might use separate queues
 * per domain (emailQueue, reportQueue, etc.) so they can scale independently.
 */
const taskQueue = new Queue<JobDataMap[keyof JobDataMap]>("tasks", {
  connection,
  defaultJobOptions: {
    // Retry failed jobs up to 3 times with exponential backoff.
    // Delay doubles each attempt: 1s, 2s, 4s.
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 1000,
    },
    // Keep the last 100 completed and 50 failed jobs for inspection.
    // Without this, completed jobs accumulate in Redis forever.
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  },
});

// =============================================================================
// Job Processors
// =============================================================================

/**
 * Simulate sending an email.
 * In production this would call Resend, SendGrid, SES, etc.
 */
async function processEmail(job: Job<EmailJobData>): Promise<JobResult> {
  const { to, subject } = job.data;

  // Simulate network latency
  await new Promise((resolve) => setTimeout(resolve, 800));

  // Simulate occasional failures (10% chance) to demonstrate retry
  if (Math.random() < 0.1) {
    throw new Error(`SMTP connection timeout sending to ${to}`);
  }

  console.log(`  [email] Sent "${subject}" to ${to}`);
  return {
    success: true,
    processedAt: new Date().toISOString(),
    details: `Email delivered to ${to}`,
  };
}

/**
 * Simulate generating a report.
 * Uses job.updateProgress() to report completion percentage —
 * clients can poll the job status to show a progress bar.
 */
async function processReport(job: Job<ReportJobData>): Promise<JobResult> {
  const { reportType, startDate, endDate } = job.data;

  // Simulate multi-step report generation with progress updates
  const steps = ["Fetching data", "Aggregating metrics", "Formatting output", "Saving PDF"];
  for (let i = 0; i < steps.length; i++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const progress = Math.round(((i + 1) / steps.length) * 100);
    await job.updateProgress(progress);
    console.log(`  [report] ${steps[i]}... ${progress}%`);
  }

  console.log(`  [report] Generated ${reportType} report (${startDate} → ${endDate})`);
  return {
    success: true,
    processedAt: new Date().toISOString(),
    details: `${reportType} report generated for ${startDate} to ${endDate}`,
  };
}

/**
 * Simulate image processing (resize, compress, watermark).
 * Each operation adds processing time.
 */
async function processImage(job: Job<ImageJobData>): Promise<JobResult> {
  const { imageUrl, operations, outputFormat } = job.data;

  for (const op of operations) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    console.log(`  [image] Applied ${op} to ${imageUrl}`);
  }

  console.log(`  [image] Output format: ${outputFormat}`);
  return {
    success: true,
    processedAt: new Date().toISOString(),
    details: `Processed ${imageUrl}: ${operations.join(", ")} → ${outputFormat}`,
  };
}

// =============================================================================
// Worker — Processes Jobs from the Queue
// =============================================================================

/**
 * The worker pulls jobs from Redis and dispatches to the correct processor
 * based on job.name. It runs in the same process here for simplicity,
 * but in production you would run workers in separate processes or containers
 * so they can scale independently of the API server.
 *
 * concurrency: 3 means up to 3 jobs are processed in parallel.
 */
const worker = new Worker<JobDataMap[keyof JobDataMap], JobResult>(
  "tasks",
  async (job) => {
    console.log(`Processing job ${job.id} [${job.name}] (attempt ${job.attemptsMade + 1})`);

    switch (job.name) {
      case "email":
        return processEmail(job as Job<EmailJobData>);
      case "report":
        return processReport(job as Job<ReportJobData>);
      case "image":
        return processImage(job as Job<ImageJobData>);
      default:
        throw new Error(`Unknown job type: ${job.name}`);
    }
  },
  {
    connection,
    concurrency: 3,
  }
);

// ---------------------------------------------------------------------------
// Worker Event Listeners — Job Lifecycle Hooks
// ---------------------------------------------------------------------------

/** Fires when a job completes successfully. */
worker.on("completed", (job: Job<JobDataMap[keyof JobDataMap], JobResult> | undefined) => {
  if (job) {
    console.log(`Job ${job.id} [${job.name}] completed:`, job.returnvalue?.details);
  }
});

/** Fires when a job fails (may still be retried if attempts remain). */
worker.on("failed", (job: Job<JobDataMap[keyof JobDataMap]> | undefined, err: Error) => {
  if (job) {
    const remaining = (job.opts.attempts ?? 1) - job.attemptsMade;
    console.error(`Job ${job.id} [${job.name}] failed: ${err.message} (${remaining} retries left)`);
  }
});

/** Fires when a worker error occurs (connection issues, etc.). */
worker.on("error", (err: Error) => {
  console.error("Worker error:", err.message);
});

// =============================================================================
// Express API
// =============================================================================

const app = express();
app.use(express.json());

const PORT = 3000;

// ---------------------------------------------------------------------------
// POST /jobs/email — Submit an email job
// ---------------------------------------------------------------------------
app.post("/jobs/email", async (req: Request, res: Response) => {
  const { to, subject, body } = req.body as EmailJobData;

  if (!to || !subject || !body) {
    res.status(400).json({ error: { message: "Fields required: to, subject, body" } });
    return;
  }

  const job = await taskQueue.add("email", { to, subject, body });

  res.status(201).json({
    data: {
      jobId: job.id,
      type: "email",
      status: "queued",
      message: `Email job queued for ${to}`,
    },
  });
});

// ---------------------------------------------------------------------------
// POST /jobs/report — Submit a report generation job
// ---------------------------------------------------------------------------
app.post("/jobs/report", async (req: Request, res: Response) => {
  const { reportType, startDate, endDate } = req.body as ReportJobData;

  if (!reportType || !startDate || !endDate) {
    res.status(400).json({ error: { message: "Fields required: reportType, startDate, endDate" } });
    return;
  }

  // Reports are lower priority (higher number = lower priority in BullMQ)
  const job = await taskQueue.add("report", { reportType, startDate, endDate }, { priority: 5 });

  res.status(201).json({
    data: {
      jobId: job.id,
      type: "report",
      status: "queued",
      message: `${reportType} report job queued`,
    },
  });
});

// ---------------------------------------------------------------------------
// POST /jobs/image — Submit an image processing job
// ---------------------------------------------------------------------------
app.post("/jobs/image", async (req: Request, res: Response) => {
  const { imageUrl, operations, outputFormat } = req.body as ImageJobData;

  if (!imageUrl || !operations?.length || !outputFormat) {
    res.status(400).json({ error: { message: "Fields required: imageUrl, operations, outputFormat" } });
    return;
  }

  const job = await taskQueue.add("image", { imageUrl, operations, outputFormat });

  res.status(201).json({
    data: {
      jobId: job.id,
      type: "image",
      status: "queued",
      message: `Image processing job queued for ${imageUrl}`,
    },
  });
});

// ---------------------------------------------------------------------------
// GET /jobs/:id — Check job status, progress, and result
// ---------------------------------------------------------------------------
app.get("/jobs/:id", async (req: Request, res: Response) => {
  const job = await taskQueue.getJob(req.params.id);

  if (!job) {
    res.status(404).json({ error: { message: `Job ${req.params.id} not found` } });
    return;
  }

  const state = await job.getState();

  res.json({
    data: {
      jobId: job.id,
      type: job.name,
      state,
      progress: job.progress,
      attemptsMade: job.attemptsMade,
      data: job.data,
      result: job.returnvalue,
      failedReason: job.failedReason,
      timestamps: {
        created: job.timestamp,
        processed: job.processedOn,
        finished: job.finishedOn,
      },
    },
  });
});

// ---------------------------------------------------------------------------
// GET /queues/stats — Queue-level statistics
// ---------------------------------------------------------------------------
app.get("/queues/stats", async (_req: Request, res: Response) => {
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    taskQueue.getWaitingCount(),
    taskQueue.getActiveCount(),
    taskQueue.getCompletedCount(),
    taskQueue.getFailedCount(),
    taskQueue.getDelayedCount(),
  ]);

  res.json({
    data: {
      queue: "tasks",
      counts: { waiting, active, completed, failed, delayed },
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

app.listen(PORT, () => {
  console.log(`BullMQ server running on http://localhost:${PORT}`);
  console.log();
  console.log("Endpoints:");
  console.log("  POST /jobs/email   — queue an email job");
  console.log("  POST /jobs/report  — queue a report generation job");
  console.log("  POST /jobs/image   — queue an image processing job");
  console.log("  GET  /jobs/:id     — check job status and result");
  console.log("  GET  /queues/stats — queue-level counts");
  console.log("  GET  /health       — health check");
  console.log();
  console.log("Make sure Redis is running on localhost:6379");
});
