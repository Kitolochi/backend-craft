/**
 * Centralized Error Handling Example
 *
 * Demonstrates a production-grade pattern for consistent error responses
 * across an Express API. Includes a custom error hierarchy, async handler
 * wrapper, and a centralized middleware that normalizes all error types
 * (Zod, JWT, duplicates, unknown) into a single response shape.
 *
 * Run: npx tsx server.ts
 * Test: curl http://localhost:3000/demo/not-found
 */

import express, { type Request, type Response, type NextFunction } from "express";
import { z, ZodError } from "zod";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = 3000;
const IS_DEVELOPMENT = process.env.NODE_ENV !== "production";

// ---------------------------------------------------------------------------
// Error code enum — every error the API can return
// ---------------------------------------------------------------------------

/**
 * String-based error codes that clients can match on reliably.
 * Prefer these over HTTP status codes for programmatic handling.
 */
const ErrorCode = {
  NOT_FOUND: "NOT_FOUND",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  CONFLICT: "CONFLICT",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  TOKEN_EXPIRED: "TOKEN_EXPIRED",
  TOKEN_INVALID: "TOKEN_INVALID",
  DUPLICATE_KEY: "DUPLICATE_KEY",
} as const;

type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

// ---------------------------------------------------------------------------
// Consistent error response shape
// ---------------------------------------------------------------------------

/** The JSON body returned for every error response. */
interface ErrorResponse {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
    stack?: string; // included only in development
  };
}

// ---------------------------------------------------------------------------
// Custom error hierarchy
// ---------------------------------------------------------------------------

/**
 * Base application error.
 *
 * - `statusCode` maps to the HTTP response status.
 * - `code` is the machine-readable string code.
 * - `isOperational` distinguishes expected errors (bad input, not found)
 *   from unexpected programming bugs. Operational errors are safe to expose
 *   to the client; non-operational errors get a generic 500 message.
 */
class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: ErrorCode;
  public readonly isOperational: boolean;
  public readonly details?: unknown;

  constructor(
    message: string,
    statusCode: number,
    code: ErrorCode,
    isOperational = true,
    details?: unknown,
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;
    this.details = details;

    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}

/** 404 — resource does not exist. */
class NotFoundError extends AppError {
  constructor(resource = "Resource") {
    super(`${resource} not found`, 404, ErrorCode.NOT_FOUND);
  }
}

/** 400 — input failed validation. `details` carries field-level errors. */
class ValidationError extends AppError {
  constructor(message = "Validation failed", details?: unknown) {
    super(message, 400, ErrorCode.VALIDATION_ERROR, true, details);
  }
}

/** 401 — caller is not authenticated. */
class UnauthorizedError extends AppError {
  constructor(message = "Authentication required") {
    super(message, 401, ErrorCode.UNAUTHORIZED);
  }
}

/** 403 — caller is authenticated but lacks permission. */
class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to access this resource") {
    super(message, 403, ErrorCode.FORBIDDEN);
  }
}

/** 409 — resource already exists or state conflict. */
class ConflictError extends AppError {
  constructor(message = "Resource already exists") {
    super(message, 409, ErrorCode.CONFLICT);
  }
}

// ---------------------------------------------------------------------------
// asyncHandler — catches rejected promises in route handlers
// ---------------------------------------------------------------------------

/**
 * Wraps an async Express route handler so that any thrown or rejected error
 * is forwarded to the centralized error middleware via `next(err)`.
 *
 * Without this, unhandled promise rejections crash the process or hang
 * the request (Express 4 does not catch them automatically).
 */
function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}

// ---------------------------------------------------------------------------
// Centralized error handler middleware
// ---------------------------------------------------------------------------

/**
 * The single error middleware registered at the bottom of the middleware stack.
 * It normalizes any error — AppError, ZodError, JWT errors, or raw Error —
 * into the consistent `ErrorResponse` shape.
 */
function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  // ---- AppError (our own hierarchy) ------------------------------------
  if (err instanceof AppError) {
    logError(err);
    const body: ErrorResponse = {
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
        ...(IS_DEVELOPMENT && { stack: err.stack }),
      },
    };
    res.status(err.statusCode).json(body);
    return;
  }

  // ---- ZodError (validation library) -----------------------------------
  if (err instanceof ZodError) {
    const fieldErrors = err.flatten().fieldErrors;
    logError(err, "Zod validation error");
    const body: ErrorResponse = {
      error: {
        code: ErrorCode.VALIDATION_ERROR,
        message: "Request validation failed",
        details: fieldErrors,
        ...(IS_DEVELOPMENT && { stack: err.stack }),
      },
    };
    res.status(400).json(body);
    return;
  }

  // ---- JWT errors (jsonwebtoken library) -------------------------------
  if (err.name === "TokenExpiredError") {
    const body: ErrorResponse = {
      error: {
        code: ErrorCode.TOKEN_EXPIRED,
        message: "Token has expired",
      },
    };
    res.status(401).json(body);
    return;
  }

  if (err.name === "JsonWebTokenError" || err.name === "NotBeforeError") {
    const body: ErrorResponse = {
      error: {
        code: ErrorCode.TOKEN_INVALID,
        message: "Token is invalid or malformed",
      },
    };
    res.status(401).json(body);
    return;
  }

  // ---- Duplicate key (MongoDB / Postgres unique constraint) ------------
  // MongoDB duplicate key error code is 11000; Postgres is '23505'
  const mongoCode = (err as Record<string, unknown>).code;
  if (mongoCode === 11000 || mongoCode === "23505") {
    const body: ErrorResponse = {
      error: {
        code: ErrorCode.DUPLICATE_KEY,
        message: "A record with this value already exists",
      },
    };
    res.status(409).json(body);
    return;
  }

  // ---- Unknown / programming error -------------------------------------
  logError(err, "UNEXPECTED ERROR");

  const body: ErrorResponse = {
    error: {
      code: ErrorCode.INTERNAL_ERROR,
      // In production, hide internals
      message: IS_DEVELOPMENT ? err.message : "An unexpected error occurred",
      ...(IS_DEVELOPMENT && { stack: err.stack }),
    },
  };
  res.status(500).json(body);
}

/** Log an error with context. Operational errors are warnings; bugs are errors. */
function logError(err: Error, label?: string): void {
  const prefix = label ? `[${label}] ` : "";

  if (err instanceof AppError && err.isOperational) {
    console.warn(`${prefix}${err.code} — ${err.message}`);
  } else {
    console.error(`${prefix}${err.message}`);
    console.error(err.stack);
  }
}

// ---------------------------------------------------------------------------
// Express app + demo routes
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());

// ---- Zod schema used in the validation demo route ----------------------
const createUserSchema = z.object({
  email: z.string().email(),
  age: z.number().int().min(13, "Must be at least 13"),
  name: z.string().min(1).max(100),
});

// ---- Demo routes -------------------------------------------------------

/** Triggers a NotFoundError. */
app.get("/demo/not-found", (_req, _res) => {
  throw new NotFoundError("Widget");
});

/** Triggers a ValidationError from Zod. */
app.post(
  "/demo/validate",
  asyncHandler(async (req, _res) => {
    // This will throw ZodError if body is invalid
    const data = createUserSchema.parse(req.body);
    // If we get here, data is valid — but we never respond, so this is
    // purely to demonstrate the error path.
    _res.json({ user: data });
  }),
);

/** Triggers an UnauthorizedError. */
app.get("/demo/unauthorized", (_req, _res) => {
  throw new UnauthorizedError("You must log in to see this");
});

/** Triggers a ForbiddenError. */
app.get("/demo/forbidden", (_req, _res) => {
  throw new ForbiddenError("Admin role required");
});

/** Triggers a ConflictError. */
app.get("/demo/conflict", (_req, _res) => {
  throw new ConflictError("User with this email already exists");
});

/** Triggers an async error (simulates a DB failure). */
app.get(
  "/demo/async-error",
  asyncHandler(async (_req, _res) => {
    // Simulate an async operation that fails
    await new Promise((resolve) => setTimeout(resolve, 50));
    throw new Error("Database connection lost");
  }),
);

/** Triggers a custom AppError with details. */
app.get("/demo/custom", (_req, _res) => {
  throw new AppError(
    "Rate limit exceeded",
    429,
    ErrorCode.VALIDATION_ERROR,
    true,
    { retryAfter: 60, limit: 100 },
  );
});

/** Simulates a JWT TokenExpiredError. */
app.get("/demo/token-expired", (_req, _res) => {
  const err = new Error("jwt expired");
  err.name = "TokenExpiredError";
  throw err;
});

/** Simulates a MongoDB duplicate key error. */
app.get("/demo/duplicate-key", (_req, _res) => {
  const err = new Error("E11000 duplicate key error") as Error & { code: number };
  err.code = 11000;
  throw err;
});

/** Simulates an unexpected programming error (non-operational). */
app.get("/demo/bug", (_req, _res) => {
  // This is a "programming error" — not something we anticipated.
  // In production the client sees a generic message.
  const obj: Record<string, unknown> = {};
  // Intentionally access a nested property that doesn't exist
  (obj as any).nested.property.access;
});

/** Success route for comparison. */
app.get("/demo/success", (_req, res) => {
  res.json({ message: "Everything is fine", timestamp: new Date().toISOString() });
});

// ---- Health check ------------------------------------------------------
app.get("/health", (_req, res) => {
  res.json({ status: "ok", environment: IS_DEVELOPMENT ? "development" : "production" });
});

// ---- Register the centralized error handler (must be last) -------------
app.use(errorHandler);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`Error Handler demo running on http://localhost:${PORT}`);
  console.log(`Environment: ${IS_DEVELOPMENT ? "development (stack traces visible)" : "production"}`);
  console.log();
  console.log("Demo routes:");
  console.log("  GET  /demo/not-found      — 404 NotFoundError");
  console.log("  POST /demo/validate       — 400 ZodError (send bad JSON body)");
  console.log("  GET  /demo/unauthorized   — 401 UnauthorizedError");
  console.log("  GET  /demo/forbidden      — 403 ForbiddenError");
  console.log("  GET  /demo/conflict       — 409 ConflictError");
  console.log("  GET  /demo/async-error    — 500 async rejection");
  console.log("  GET  /demo/custom         — 429 custom AppError");
  console.log("  GET  /demo/token-expired  — 401 JWT expired");
  console.log("  GET  /demo/duplicate-key  — 409 duplicate key");
  console.log("  GET  /demo/bug            — 500 programming error");
  console.log("  GET  /demo/success        — 200 success");
});
