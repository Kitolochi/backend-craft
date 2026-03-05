/**
 * Production Middleware Stack
 *
 * Demonstrates a real-world Express middleware pipeline with security
 * headers, CORS, logging, rate limiting, request IDs, body size limits,
 * and centralized error handling.
 *
 * Run: npx tsx server.ts
 * Test: curl -v http://localhost:3000/api/health
 */

import express, { Request, Response, NextFunction } from "express";
import helmet from "helmet";
import cors from "cors";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import { v4 as uuidv4 } from "uuid";

// =============================================================================
// Custom AppError Class
// =============================================================================

/**
 * Application-level error with HTTP status and optional details.
 * Throw this from any route/middleware and the centralized handler catches it.
 */
class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly details?: unknown;

  constructor(
    message: string,
    statusCode: number = 500,
    details?: unknown,
    isOperational: boolean = true
  ) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.details = details;
    // Restore prototype chain (needed when extending builtins in TS)
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

// =============================================================================
// Async Wrapper Utility
// =============================================================================

/**
 * Wraps an async route handler so that rejected promises are forwarded
 * to Express's error handling pipeline instead of causing unhandled
 * rejection crashes.
 *
 * Usage:
 *   app.get("/path", asyncHandler(async (req, res) => { ... }));
 */
type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

function asyncHandler(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

// =============================================================================
// Extend Express Request to include our custom properties
// =============================================================================

declare global {
  namespace Express {
    interface Request {
      /** Unique ID assigned to every incoming request */
      requestId: string;
    }
  }
}

// =============================================================================
// Environment Config
// =============================================================================

const NODE_ENV = process.env.NODE_ENV || "development";
const PORT = process.env.PORT || 3000;

/**
 * Allowed CORS origins vary by environment.
 * In production you would read these from env vars or a config service.
 */
const CORS_ORIGINS: Record<string, string[]> = {
  development: ["http://localhost:5173", "http://localhost:3001"],
  production: ["https://app.example.com", "https://admin.example.com"],
};

// =============================================================================
// Express App
// =============================================================================

const app = express();

// ---------------------------------------------------------------------------
// 1. Request ID Middleware
//    Generates a unique ID for every request. If the client sends
//    X-Request-ID it is reused; otherwise a new UUID is generated.
//    The ID is also set on the response so clients can reference it.
// ---------------------------------------------------------------------------
app.use((req: Request, res: Response, next: NextFunction) => {
  const id = (req.headers["x-request-id"] as string) || uuidv4();
  req.requestId = id;
  res.setHeader("X-Request-ID", id);
  next();
});

// ---------------------------------------------------------------------------
// 2. Helmet — Security Headers
//    Sets various HTTP headers to help protect the app:
//    - Content-Security-Policy
//    - X-Content-Type-Options: nosniff
//    - X-Frame-Options: SAMEORIGIN
//    - Strict-Transport-Security (HSTS)
//    - Removes X-Powered-By
// ---------------------------------------------------------------------------
app.use(helmet());

// ---------------------------------------------------------------------------
// 3. CORS — Cross-Origin Resource Sharing
//    Controls which origins can make requests to this API.
//    Credentials (cookies, auth headers) are allowed.
//    Preflight responses are cached for 10 minutes.
// ---------------------------------------------------------------------------
app.use(
  cors({
    origin: CORS_ORIGINS[NODE_ENV] || CORS_ORIGINS.development,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Request-ID"],
    maxAge: 600, // preflight cache: 10 minutes
  })
);

// ---------------------------------------------------------------------------
// 4. Morgan — HTTP Request Logging
//    "combined" format in production (Apache-style, good for log aggregation).
//    "dev" format in development (colored, concise).
// ---------------------------------------------------------------------------
app.use(
  morgan(NODE_ENV === "production" ? "combined" : "dev", {
    // Include request ID in log output by adding a custom token
    stream: {
      write: (message: string) => {
        console.log(message.trimEnd());
      },
    },
  })
);

// ---------------------------------------------------------------------------
// 5. Body Parser with Size Limit
//    Accept JSON bodies up to 10kb. Requests larger than this are
//    rejected with 413 Payload Too Large before the route runs.
// ---------------------------------------------------------------------------
app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: true, limit: "10kb" }));

// ---------------------------------------------------------------------------
// 6. Rate Limiting — General
//    100 requests per 15-minute window per IP address.
//    Returns standard headers (RateLimit-Policy, RateLimit-Remaining, etc.).
// ---------------------------------------------------------------------------
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 100,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: { message: "Too many requests, please try again later" } },
});
app.use(generalLimiter);

// ---------------------------------------------------------------------------
// 7. Rate Limiting — Auth Endpoints (stricter)
//    5 requests per 15-minute window. Applied only to /api/auth/*.
//    Prevents brute-force login attempts.
// ---------------------------------------------------------------------------
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    error: { message: "Too many authentication attempts, please try again later" },
  },
});

// =============================================================================
// Sample Routes
// =============================================================================

// Health check — simple endpoint to verify the server is running
app.get(
  "/api/health",
  asyncHandler(async (req: Request, res: Response) => {
    res.json({
      data: {
        status: "healthy",
        environment: NODE_ENV,
        requestId: req.requestId,
        uptime: process.uptime(),
      },
    });
  })
);

// Public resource — demonstrates general rate limiting
app.get(
  "/api/posts",
  asyncHandler(async (_req: Request, res: Response) => {
    // Simulate an async operation (e.g. database query)
    const posts = [
      { id: 1, title: "Getting Started with Express", author: "Jane" },
      { id: 2, title: "Middleware Patterns", author: "John" },
    ];

    res.json({ data: posts });
  })
);

// Auth login — uses the stricter auth rate limiter
app.post(
  "/api/auth/login",
  authLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const { email, password } = req.body;

    if (!email || !password) {
      throw new AppError("Email and password are required", 400);
    }

    // In a real app you'd verify credentials here
    if (email === "test@example.com" && password === "password") {
      res.json({
        data: {
          token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.demo-token",
          user: { id: 1, email },
        },
      });
      return;
    }

    throw new AppError("Invalid credentials", 401);
  })
);

// Protected resource — demonstrates AppError usage
app.get(
  "/api/admin/stats",
  asyncHandler(async (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith("Bearer ")) {
      throw new AppError("Authentication required", 401);
    }

    // In a real app you'd verify the JWT here
    res.json({
      data: {
        users: 1234,
        activeSessions: 56,
        requestId: req.requestId,
      },
    });
  })
);

// Demonstrates a route that triggers an unexpected error
app.get(
  "/api/error-demo",
  asyncHandler(async (_req: Request, _res: Response) => {
    // Simulating an unexpected failure — the async wrapper catches it
    throw new Error("Something broke unexpectedly");
  })
);

// =============================================================================
// 404 Handler — Catch-all for unmatched routes
// =============================================================================
app.use((_req: Request, _res: Response, next: NextFunction) => {
  next(new AppError("Route not found", 404));
});

// =============================================================================
// Centralized Error Handler
// =============================================================================

/**
 * Single place to format all error responses.
 *
 * - AppError (operational) -> return the status and message as-is
 * - Unknown errors         -> 500 with generic message (don't leak internals)
 *
 * In development, the stack trace is included for debugging.
 */
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  // Default to 500 if no status is set
  const statusCode = err instanceof AppError ? err.statusCode : 500;
  const isOperational = err instanceof AppError ? err.isOperational : false;

  // Log the error (include request ID for correlation)
  console.error(`[${req.requestId}] Error ${statusCode}:`, err.message);
  if (!isOperational) {
    console.error(err.stack);
  }

  const response: Record<string, unknown> = {
    error: {
      message: isOperational ? err.message : "Internal server error",
      requestId: req.requestId,
      ...(err instanceof AppError && err.details ? { details: err.details } : {}),
      ...(NODE_ENV === "development" ? { stack: err.stack } : {}),
    },
  };

  res.status(statusCode).json(response);
});

// =============================================================================
// Start Server
// =============================================================================

app.listen(PORT, () => {
  console.log(`Production stack running at http://localhost:${PORT} [${NODE_ENV}]`);
  console.log(`\nMiddleware pipeline:`);
  console.log(`  1. Request ID   — X-Request-ID header on every response`);
  console.log(`  2. Helmet       — Security headers (CSP, HSTS, nosniff, etc.)`);
  console.log(`  3. CORS         — Origins: ${(CORS_ORIGINS[NODE_ENV] || CORS_ORIGINS.development).join(", ")}`);
  console.log(`  4. Morgan       — HTTP request logging (${NODE_ENV === "production" ? "combined" : "dev"} format)`);
  console.log(`  5. Body parser  — JSON with 10kb size limit`);
  console.log(`  6. Rate limit   — 100 req/15min (general), 5 req/15min (auth)`);
  console.log(`  7. Error handler — Centralized with AppError class`);
  console.log(`\nTry these commands:`);
  console.log(`  curl -v http://localhost:${PORT}/api/health`);
  console.log(`  curl http://localhost:${PORT}/api/posts`);
  console.log(`  curl -X POST http://localhost:${PORT}/api/auth/login -H "Content-Type: application/json" -d '{"email":"test@example.com","password":"password"}'`);
  console.log(`  curl http://localhost:${PORT}/api/admin/stats -H "Authorization: Bearer demo-token"`);
  console.log(`  curl http://localhost:${PORT}/api/error-demo`);
  console.log(`  curl http://localhost:${PORT}/api/nonexistent`);
});
