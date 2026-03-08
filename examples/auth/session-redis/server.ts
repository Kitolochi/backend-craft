/**
 * Session Authentication with Redis
 *
 * Express server using server-side sessions stored in Redis via connect-redis.
 * Demonstrates login, logout, session inspection, cookie security settings,
 * session regeneration to prevent fixation attacks, and in-memory user storage.
 *
 * Prerequisites:
 *   Redis running on localhost:6379 (docker run -p 6379:6379 redis)
 *
 * Run: npx tsx server.ts
 * Test: curl -c cookies.txt -b cookies.txt http://localhost:3000/auth/login \
 *         -X POST -H "Content-Type: application/json" \
 *         -d '{"email":"alice@example.com","password":"Password1"}'
 */

import express, { type Request, type Response, type NextFunction } from "express";
import session from "express-session";
import { RedisStore } from "connect-redis";
import IORedis from "ioredis";
import bcrypt from "bcryptjs";

// =============================================================================
// Types
// =============================================================================

interface User {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  createdAt: string;
}

interface UserResponse {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}

/**
 * Extend the express-session SessionData to include our custom fields.
 * After login, userId is set so downstream middleware can identify the user.
 */
declare module "express-session" {
  interface SessionData {
    userId?: string;
  }
}

// =============================================================================
// Configuration
// =============================================================================

const PORT = 3000;
const SESSION_SECRET = "change-this-to-a-long-random-string-in-production";
const BCRYPT_ROUNDS = 10;

// =============================================================================
// Redis Connection
// =============================================================================

/**
 * Shared Redis client for session storage.
 * maxRetriesPerRequest: null lets ioredis retry indefinitely
 * rather than throwing after a fixed count (important for long-lived servers).
 */
const redis = new IORedis({
  host: "127.0.0.1",
  port: 6379,
  maxRetriesPerRequest: null,
});

redis.on("connect", () => console.log("Connected to Redis"));
redis.on("error", (err) => console.error("Redis error:", err.message));

// =============================================================================
// In-Memory User Store
// =============================================================================

let nextId = 1;
function generateId(): string {
  return String(nextId++);
}

/** Strip sensitive fields from a user record. */
function toUserResponse(user: User): UserResponse {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt,
  };
}

/** Seed some demo users so the API is immediately testable. */
const users: User[] = [];

async function seedUsers(): Promise<void> {
  const seeds = [
    { name: "Alice Johnson", email: "alice@example.com", password: "Password1" },
    { name: "Bob Smith", email: "bob@example.com", password: "Password2" },
  ];

  for (const seed of seeds) {
    const passwordHash = await bcrypt.hash(seed.password, BCRYPT_ROUNDS);
    users.push({
      id: generateId(),
      email: seed.email,
      name: seed.name,
      passwordHash,
      createdAt: new Date().toISOString(),
    });
  }

  console.log(`Seeded ${users.length} users (passwords: Password1, Password2)`);
}

// =============================================================================
// Express App & Session Middleware
// =============================================================================

const app = express();
app.use(express.json());

/**
 * Session middleware backed by Redis.
 *
 * Cookie settings explained:
 * - httpOnly: true  — cookie is not accessible via document.cookie (XSS protection)
 * - secure: true    — cookie only sent over HTTPS (disabled in dev for localhost)
 * - sameSite: "lax" — cookie sent on top-level navigations but not cross-origin POSTs (CSRF protection)
 * - maxAge: 24h     — session expires after 24 hours of inactivity
 *
 * The session ID is the only thing stored in the cookie; all session data
 * lives in Redis. This means even if the cookie is intercepted, the attacker
 * only gets an opaque ID, not user data.
 */
app.use(
  session({
    store: new RedisStore({ client: redis, prefix: "sess:" }),
    secret: SESSION_SECRET,
    name: "sid",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 24 * 60 * 60 * 1000,
    },
  })
);

// =============================================================================
// Auth Middleware
// =============================================================================

/**
 * Protect routes that require authentication.
 * Checks session for a userId — if missing, the user hasn't logged in.
 */
function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.userId) {
    res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "You must be logged in" } });
    return;
  }

  const user = users.find((u) => u.id === req.session.userId);
  if (!user) {
    req.session.destroy(() => {});
    res.status(401).json({ error: { code: "USER_NOT_FOUND", message: "Session user no longer exists" } });
    return;
  }

  next();
}

// =============================================================================
// Routes
// =============================================================================

// ---------------------------------------------------------------------------
// POST /auth/register — Create a new account and log in
// ---------------------------------------------------------------------------
app.post("/auth/register", async (req: Request, res: Response) => {
  const { email, password, name } = req.body;

  if (!email || !password || !name) {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Fields required: email, password, name" } });
    return;
  }

  if (password.length < 8) {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Password must be at least 8 characters" } });
    return;
  }

  if (users.find((u) => u.email === email)) {
    res.status(409).json({ error: { code: "EMAIL_EXISTS", message: "An account with this email already exists" } });
    return;
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const user: User = {
    id: generateId(),
    email,
    name,
    passwordHash,
    createdAt: new Date().toISOString(),
  };
  users.push(user);

  // Regenerate session after creating account to prevent session fixation.
  // An attacker who obtained a session ID before registration cannot
  // hijack the authenticated session because the ID changes here.
  req.session.regenerate((err) => {
    if (err) {
      res.status(500).json({ error: { code: "SESSION_ERROR", message: "Failed to create session" } });
      return;
    }

    req.session.userId = user.id;
    res.status(201).json({ user: toUserResponse(user) });
  });
});

// ---------------------------------------------------------------------------
// POST /auth/login — Authenticate with email + password
// ---------------------------------------------------------------------------
app.post("/auth/login", async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Fields required: email, password" } });
    return;
  }

  const user = users.find((u) => u.email === email);

  // Always hash to prevent timing attacks that reveal whether an email exists
  if (!user) {
    await bcrypt.hash(password, BCRYPT_ROUNDS);
    res.status(401).json({ error: { code: "INVALID_CREDENTIALS", message: "Email or password is incorrect" } });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: { code: "INVALID_CREDENTIALS", message: "Email or password is incorrect" } });
    return;
  }

  /**
   * Session regeneration on login (fixation protection).
   *
   * Without this, an attacker could:
   * 1. Visit the site and get a session ID
   * 2. Trick the victim into using that session ID (e.g., via a crafted link)
   * 3. After the victim logs in, the attacker's session ID is now authenticated
   *
   * regenerate() creates a new session ID and copies nothing from the old session,
   * breaking the attacker's reference to the pre-login session.
   */
  req.session.regenerate((err) => {
    if (err) {
      res.status(500).json({ error: { code: "SESSION_ERROR", message: "Failed to create session" } });
      return;
    }

    req.session.userId = user.id;
    res.json({ message: "Logged in", user: toUserResponse(user) });
  });
});

// ---------------------------------------------------------------------------
// POST /auth/logout — Destroy the session
// ---------------------------------------------------------------------------
app.post("/auth/logout", (req: Request, res: Response) => {
  req.session.destroy((err) => {
    if (err) {
      res.status(500).json({ error: { code: "SESSION_ERROR", message: "Failed to destroy session" } });
      return;
    }

    // Clear the session cookie from the client
    res.clearCookie("sid");
    res.json({ message: "Logged out" });
  });
});

// ---------------------------------------------------------------------------
// GET /auth/me — Return the currently authenticated user
// ---------------------------------------------------------------------------
app.get("/auth/me", requireAuth, (req: Request, res: Response) => {
  const user = users.find((u) => u.id === req.session.userId)!;
  res.json({ user: toUserResponse(user) });
});

// ---------------------------------------------------------------------------
// GET /auth/sessions — Debug endpoint: show current session info
// ---------------------------------------------------------------------------
app.get("/auth/session", requireAuth, (req: Request, res: Response) => {
  res.json({
    sessionId: req.sessionID,
    userId: req.session.userId,
    cookie: {
      maxAge: req.session.cookie.maxAge,
      httpOnly: req.session.cookie.httpOnly,
      secure: req.session.cookie.secure,
      sameSite: req.session.cookie.sameSite,
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

seedUsers().then(() => {
  app.listen(PORT, () => {
    console.log(`Session Auth server running on http://localhost:${PORT}`);
    console.log();
    console.log("Endpoints:");
    console.log("  POST /auth/register  — create account + auto-login");
    console.log("  POST /auth/login     — authenticate (sets session cookie)");
    console.log("  POST /auth/logout    — destroy session");
    console.log("  GET  /auth/me        — current user (protected)");
    console.log("  GET  /auth/session   — session debug info (protected)");
    console.log("  GET  /health         — health check");
    console.log();
    console.log("Make sure Redis is running on localhost:6379");
    console.log();
    console.log("Test with curl (use -c/-b to persist cookies):");
    console.log(`  curl -c cookies.txt -b cookies.txt http://localhost:${PORT}/auth/login \\`);
    console.log(`    -X POST -H "Content-Type: application/json" \\`);
    console.log(`    -d '{"email":"alice@example.com","password":"Password1"}'`);
    console.log(`  curl -c cookies.txt -b cookies.txt http://localhost:${PORT}/auth/me`);
  });
});
