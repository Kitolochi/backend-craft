/**
 * Structured Request Logging Example
 *
 * Demonstrates production-grade logging with Pino: request IDs, custom
 * serializers that redact secrets, child loggers for module context,
 * pretty printing in dev, and JSON output in production.
 *
 * Run: npx tsx server.ts
 * Test: curl http://localhost:3000/users
 *       curl http://localhost:3000/auth/login -X POST \
 *         -H "Content-Type: application/json" \
 *         -d '{"email":"test@example.com","password":"secret123"}'
 */

import express, { type Request, type Response, type NextFunction } from "express";
import pino from "pino";
import pinoHttp from "pino-http";
import { v4 as uuidv4 } from "uuid";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = 3000;
const IS_DEVELOPMENT = process.env.NODE_ENV !== "production";
const LOG_LEVEL = process.env.LOG_LEVEL ?? (IS_DEVELOPMENT ? "debug" : "info");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Extend Express Request with a typed request ID. */
declare global {
  namespace Express {
    interface Request {
      id: string;
    }
  }
}

// ---------------------------------------------------------------------------
// Sensitive field patterns — values matching these keys are redacted
// ---------------------------------------------------------------------------

/**
 * Set of field names whose values should never appear in logs.
 * Checked case-insensitively in the custom serializers below.
 */
const REDACTED_FIELDS = new Set([
  "password",
  "passwordHash",
  "token",
  "accessToken",
  "refreshToken",
  "authorization",
  "cookie",
  "secret",
  "creditCard",
  "ssn",
  "apiKey",
]);

/**
 * Recursively walk an object and replace any values whose keys match
 * the redacted set with "[REDACTED]". Returns a new object.
 */
function redactSensitive(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== "object") return obj;

  if (Array.isArray(obj)) {
    return obj.map(redactSensitive);
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (REDACTED_FIELDS.has(key.toLowerCase())) {
      result[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null) {
      result[key] = redactSensitive(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Root logger
// ---------------------------------------------------------------------------

/**
 * The root Pino logger.
 *
 * - In development: uses pino-pretty for colorized, human-readable output.
 * - In production: outputs newline-delimited JSON for log aggregators
 *   (Datadog, Elastic, CloudWatch, etc.).
 *
 * Custom serializers ensure request/response objects are logged with
 * only the fields we care about, and that sensitive headers are stripped.
 */
const logger = pino({
  level: LOG_LEVEL,

  // Base fields included in every log line
  base: {
    service: "request-logging-example",
    environment: IS_DEVELOPMENT ? "development" : "production",
  },

  // Custom timestamp format (ISO 8601)
  timestamp: pino.stdTimeFunctions.isoTime,

  // Serializers control how complex objects are represented in logs
  serializers: {
    // Request serializer: log method, url, headers (redacted), query
    req(req) {
      return {
        id: req.id,
        method: req.method,
        url: req.url,
        query: req.query,
        headers: redactSensitive({
          host: req.headers.host,
          "user-agent": req.headers["user-agent"],
          "content-type": req.headers["content-type"],
          authorization: req.headers.authorization,
        }),
        remoteAddress: req.remoteAddress,
      };
    },

    // Response serializer: log status code and headers
    res(res) {
      return {
        statusCode: res.statusCode,
        headers: {
          "content-type": res.getHeader?.("content-type"),
          "content-length": res.getHeader?.("content-length"),
        },
      };
    },

    // Error serializer: include message, code, and stack
    err(err) {
      return {
        type: err.constructor?.name ?? "Error",
        message: err.message,
        code: (err as Record<string, unknown>).code,
        stack: IS_DEVELOPMENT ? err.stack : undefined,
      };
    },
  },

  // Pretty-print transport in development
  ...(IS_DEVELOPMENT && {
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "HH:MM:ss.l",
        ignore: "pid,hostname",
        singleLine: false,
      },
    },
  }),
});

// ---------------------------------------------------------------------------
// Child loggers — scoped to specific modules
// ---------------------------------------------------------------------------

/**
 * Child loggers inherit all settings from the parent but add a `module`
 * field so you can filter logs by subsystem in your aggregator.
 *
 * Usage: authLogger.info({ userId }, "User authenticated")
 *   => { ..., module: "auth", userId: "abc", msg: "User authenticated" }
 */
const authLogger = logger.child({ module: "auth" });
const dbLogger = logger.child({ module: "database" });
const cacheLogger = logger.child({ module: "cache" });

// ---------------------------------------------------------------------------
// Request ID middleware
// ---------------------------------------------------------------------------

/**
 * Generates or forwards a request ID for every incoming request.
 *
 * If the client sends an `X-Request-ID` header (common in microservice
 * architectures for distributed tracing), we reuse it. Otherwise we
 * generate a new UUID v4.
 *
 * The ID is attached to `req.id` and returned in the `X-Request-ID`
 * response header so clients can correlate logs.
 */
function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const id = (req.headers["x-request-id"] as string) ?? uuidv4();
  req.id = id;
  res.setHeader("X-Request-ID", id);
  next();
}

// ---------------------------------------------------------------------------
// Pino HTTP middleware
// ---------------------------------------------------------------------------

/**
 * pino-http automatically logs every request/response pair with:
 * - method, url, status code, response time
 * - request ID (from our genReqId function)
 * - auto-detected log level based on status code
 */
const httpLogger = pinoHttp({
  logger,

  // Use our request ID instead of generating a new one
  genReqId: (req) => (req as Request).id,

  // Customize the log level based on response status
  customLogLevel(_req, res, err) {
    if (err || (res.statusCode && res.statusCode >= 500)) return "error";
    if (res.statusCode && res.statusCode >= 400) return "warn";
    return "info";
  },

  // Customize the "request completed" message
  customSuccessMessage(req, res) {
    return `${req.method} ${req.url} ${res.statusCode}`;
  },

  // Customize the "request failed" message
  customErrorMessage(_req, res) {
    return `Request failed with status ${res.statusCode}`;
  },

  // Add custom attributes to every log line
  customAttributeKeys: {
    req: "request",
    res: "response",
    err: "error",
    responseTime: "duration_ms",
  },

  // Don't log the full request/response objects for health checks
  autoLogging: {
    ignore(req) {
      return req.url === "/health";
    },
  },
});

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());
app.use(requestIdMiddleware);
app.use(httpLogger);

// ---------------------------------------------------------------------------
// Demo routes
// ---------------------------------------------------------------------------

/** Basic info-level log. */
app.get("/users", (req: Request, res: Response) => {
  logger.info({ requestId: req.id, count: 3 }, "Fetching users from database");

  // Simulate database query with child logger
  dbLogger.debug({ requestId: req.id, query: "SELECT * FROM users LIMIT 10" }, "Executing query");

  const users = [
    { id: 1, name: "Alice", email: "alice@example.com" },
    { id: 2, name: "Bob", email: "bob@example.com" },
    { id: 3, name: "Charlie", email: "charlie@example.com" },
  ];

  dbLogger.debug({ requestId: req.id, rows: users.length }, "Query completed");
  res.json({ users });
});

/** Demonstrates auth logging with redaction of sensitive fields. */
app.post("/auth/login", (req: Request, res: Response) => {
  const { email, password } = req.body;

  // The body is logged with sensitive fields redacted
  authLogger.info(
    { requestId: req.id, body: redactSensitive(req.body) },
    "Login attempt",
  );

  if (!email || !password) {
    authLogger.warn({ requestId: req.id, email }, "Login failed: missing credentials");
    res.status(400).json({ error: "Email and password are required" });
    return;
  }

  // Simulate checking credentials
  if (email === "test@example.com" && password === "secret123") {
    authLogger.info({ requestId: req.id, userId: "usr_123", email }, "Login successful");
    res.json({
      accessToken: "eyJ.fake.token",
      user: { id: "usr_123", email },
    });
  } else {
    authLogger.warn({ requestId: req.id, email }, "Login failed: invalid credentials");
    res.status(401).json({ error: "Invalid credentials" });
  }
});

/** Demonstrates debug-level logging. */
app.get("/cache/stats", (req: Request, res: Response) => {
  cacheLogger.debug({ requestId: req.id }, "Cache stats requested");

  const stats = { hits: 1542, misses: 89, hitRate: "94.5%", size: "12MB" };
  cacheLogger.trace({ requestId: req.id, stats }, "Cache statistics computed");

  res.json(stats);
});

/** Demonstrates warning-level logging. */
app.get("/demo/slow-query", async (req: Request, res: Response) => {
  const start = Date.now();

  dbLogger.info({ requestId: req.id }, "Starting potentially slow query");

  // Simulate a slow operation
  await new Promise((resolve) => setTimeout(resolve, 200));
  const duration = Date.now() - start;

  // Warn if query takes too long
  if (duration > 100) {
    dbLogger.warn(
      { requestId: req.id, duration_ms: duration, threshold_ms: 100 },
      "Slow query detected",
    );
  }

  res.json({ result: "data", duration_ms: duration });
});

/** Demonstrates error-level logging with stack traces. */
app.get("/demo/error", (req: Request, res: Response) => {
  try {
    // Simulate an operation that throws
    const data: Record<string, unknown> = {};
    JSON.parse((data as any).invalid);
  } catch (err) {
    logger.error(
      { requestId: req.id, err, operation: "data_parse" },
      "Failed to parse data",
    );
    res.status(500).json({ error: "Internal server error", requestId: req.id });
  }
});

/** Demonstrates fatal-level logging (process will continue in this demo). */
app.get("/demo/fatal", (req: Request, res: Response) => {
  logger.fatal(
    { requestId: req.id, service: "payment-gateway", lastResponse: "timeout" },
    "Critical dependency unavailable — payment processing is down",
  );
  res.status(503).json({ error: "Service temporarily unavailable", requestId: req.id });
});

/** Demonstrates structured context with multiple fields. */
app.post("/orders", (req: Request, res: Response) => {
  const orderId = `ord_${Date.now()}`;
  const orderLogger = logger.child({ module: "orders", orderId });

  orderLogger.info({ requestId: req.id }, "Order creation started");
  orderLogger.debug({ items: req.body?.items ?? [] }, "Processing order items");
  orderLogger.info({ total: 99.99, currency: "USD" }, "Order total calculated");
  orderLogger.info("Order created successfully");

  res.status(201).json({ orderId, status: "created" });
});

/** Health check — not logged by pino-http (see autoLogging.ignore). */
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

// ---------------------------------------------------------------------------
// Global error handler with logging
// ---------------------------------------------------------------------------

app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  logger.error(
    {
      requestId: req.id,
      err,
      method: req.method,
      url: req.url,
    },
    "Unhandled error in request pipeline",
  );

  res.status(500).json({
    error: "Internal server error",
    requestId: req.id,
  });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

app.listen(PORT, () => {
  logger.info({ port: PORT, logLevel: LOG_LEVEL }, "Request logging server started");

  // These use console so they appear regardless of log level/format
  console.log();
  console.log("Demo routes:");
  console.log("  GET  /users           — info + debug logging");
  console.log("  POST /auth/login      — auth logging with redaction");
  console.log("  GET  /cache/stats     — debug + trace logging");
  console.log("  GET  /demo/slow-query — warning on slow operations");
  console.log("  GET  /demo/error      — error with stack trace");
  console.log("  GET  /demo/fatal      — fatal level log");
  console.log("  POST /orders          — child logger with order context");
  console.log("  GET  /health          — excluded from request logs");
  console.log();
  console.log(`Log level: ${LOG_LEVEL} | Format: ${IS_DEVELOPMENT ? "pretty" : "JSON"}`);
  console.log("Set LOG_LEVEL=trace to see all log levels");
});
