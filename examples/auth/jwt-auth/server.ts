/**
 * JWT Authentication Example
 *
 * A complete JWT auth flow with access tokens, refresh tokens, role-based
 * access control, and in-memory user storage. Demonstrates production-ready
 * patterns for token lifecycle management.
 *
 * Run: npx tsx server.ts
 * Test: curl http://localhost:3000/auth/register -X POST \
 *         -H "Content-Type: application/json" \
 *         -d '{"email":"admin@test.com","password":"Secret123!","name":"Admin","role":"admin"}'
 */

import express, { type Request, type Response, type NextFunction } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import cookieParser from "cookie-parser";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = 3000;
const ACCESS_TOKEN_SECRET = "access-secret-change-in-production";
const REFRESH_TOKEN_SECRET = "refresh-secret-change-in-production";
const ACCESS_TOKEN_EXPIRY = "15m";
const REFRESH_TOKEN_EXPIRY = "7d";
const BCRYPT_ROUNDS = 10;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Roles available in the system. */
type Role = "user" | "admin";

/** Stored user record (password is a bcrypt hash). */
interface User {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  role: Role;
  createdAt: Date;
}

/** Public user data returned in API responses (no password hash). */
interface UserResponse {
  id: string;
  email: string;
  name: string;
  role: Role;
  createdAt: Date;
}

/** Payload embedded inside an access token. */
interface AccessTokenPayload {
  userId: string;
  role: Role;
}

/** Payload embedded inside a refresh token. */
interface RefreshTokenPayload {
  userId: string;
  tokenId: string;
}

/** Shape of the JSON body returned with tokens. */
interface TokenResponse {
  accessToken: string;
  expiresIn: string;
  user: UserResponse;
}

// Extend Express Request to carry the authenticated user after middleware.
declare global {
  namespace Express {
    interface Request {
      user?: UserResponse;
    }
  }
}

// ---------------------------------------------------------------------------
// In-memory stores
// ---------------------------------------------------------------------------

/** All registered users keyed by nothing — just an array for simplicity. */
const users: User[] = [];

/**
 * Blacklisted refresh-token IDs.
 * In production this would be Redis or a DB table with TTL expiry.
 */
const refreshTokenBlacklist = new Set<string>();

// ---------------------------------------------------------------------------
// Zod validation schemas
// ---------------------------------------------------------------------------

const registerSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Password must contain an uppercase letter")
    .regex(/[0-9]/, "Password must contain a number"),
  name: z.string().min(1, "Name is required").max(100),
  role: z.enum(["user", "admin"]).optional().default("user"),
});

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip sensitive fields from a User record. */
function toUserResponse(user: User): UserResponse {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    createdAt: user.createdAt,
  };
}

/** Generate a simple unique ID (good enough for a demo). */
function generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** Create a signed access token containing userId and role. */
function signAccessToken(user: User): string {
  const payload: AccessTokenPayload = { userId: user.id, role: user.role };
  return jwt.sign(payload, ACCESS_TOKEN_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
}

/** Create a signed refresh token with a unique tokenId for revocation. */
function signRefreshToken(user: User): { token: string; tokenId: string } {
  const tokenId = generateId();
  const payload: RefreshTokenPayload = { userId: user.id, tokenId };
  const token = jwt.sign(payload, REFRESH_TOKEN_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRY });
  return { token, tokenId };
}

/**
 * Set the refresh token as an httpOnly cookie.
 * - httpOnly: prevents JavaScript access (XSS protection)
 * - sameSite: lax prevents CSRF on cross-origin GET
 * - secure: would be true in production (HTTPS only)
 * - path restricted to /auth so it's only sent on auth endpoints
 */
function setRefreshCookie(res: Response, token: string): void {
  res.cookie("refreshToken", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/auth",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
  });
}

/** Clear the refresh token cookie. */
function clearRefreshCookie(res: Response): void {
  res.clearCookie("refreshToken", { path: "/auth" });
}

// ---------------------------------------------------------------------------
// Middleware: authenticateToken
// ---------------------------------------------------------------------------

/**
 * Verifies the Authorization header carries a valid, non-expired access token.
 * On success, attaches `req.user` with the public user data.
 */
function authenticateToken(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    res.status(401).json({ error: { code: "MISSING_TOKEN", message: "Authorization header is required" } });
    return;
  }

  // Expect "Bearer <token>"
  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    res.status(401).json({ error: { code: "INVALID_FORMAT", message: "Authorization header must be: Bearer <token>" } });
    return;
  }

  const token = parts[1];

  try {
    const payload = jwt.verify(token, ACCESS_TOKEN_SECRET) as AccessTokenPayload;
    const user = users.find((u) => u.id === payload.userId);

    if (!user) {
      res.status(401).json({ error: { code: "USER_NOT_FOUND", message: "User no longer exists" } });
      return;
    }

    req.user = toUserResponse(user);
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: { code: "TOKEN_EXPIRED", message: "Access token has expired — use /auth/refresh" } });
      return;
    }
    if (err instanceof jwt.JsonWebTokenError) {
      res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Access token is malformed or tampered" } });
      return;
    }
    res.status(500).json({ error: { code: "AUTH_ERROR", message: "Authentication failed" } });
  }
}

// ---------------------------------------------------------------------------
// Middleware: authorize (role-based)
// ---------------------------------------------------------------------------

/**
 * Factory that returns middleware restricting access to the listed roles.
 * Must be used after `authenticateToken` so `req.user` is populated.
 *
 * Usage: app.get("/admin/thing", authenticateToken, authorize("admin"), handler)
 */
function authorize(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Must be logged in" } });
      return;
    }

    if (!roles.includes(req.user.role as Role)) {
      res.status(403).json({
        error: {
          code: "FORBIDDEN",
          message: `This route requires one of: ${roles.join(", ")}. Your role: ${req.user.role}`,
        },
      });
      return;
    }

    next();
  };
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());
app.use(cookieParser());

// ---------------------------------------------------------------------------
// POST /auth/register — create a new user account
// ---------------------------------------------------------------------------

app.post("/auth/register", async (req: Request, res: Response) => {
  // Validate input with Zod
  const result = registerSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid registration data",
        details: result.error.flatten().fieldErrors,
      },
    });
    return;
  }

  const { email, password, name, role } = result.data;

  // Check for duplicate email
  if (users.find((u) => u.email === email)) {
    res.status(409).json({ error: { code: "EMAIL_EXISTS", message: "An account with this email already exists" } });
    return;
  }

  // Hash password and store user
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const user: User = {
    id: generateId(),
    email,
    name,
    passwordHash,
    role,
    createdAt: new Date(),
  };
  users.push(user);

  // Issue tokens
  const accessToken = signAccessToken(user);
  const { token: refreshToken } = signRefreshToken(user);
  setRefreshCookie(res, refreshToken);

  const body: TokenResponse = {
    accessToken,
    expiresIn: ACCESS_TOKEN_EXPIRY,
    user: toUserResponse(user),
  };
  res.status(201).json(body);
});

// ---------------------------------------------------------------------------
// POST /auth/login — authenticate with email + password
// ---------------------------------------------------------------------------

app.post("/auth/login", async (req: Request, res: Response) => {
  const result = loginSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid login data",
        details: result.error.flatten().fieldErrors,
      },
    });
    return;
  }

  const { email, password } = result.data;
  const user = users.find((u) => u.email === email);

  // Constant-time-ish: always hash even if user not found to prevent timing attacks
  if (!user) {
    await bcrypt.hash(password, BCRYPT_ROUNDS); // waste time to match timing
    res.status(401).json({ error: { code: "INVALID_CREDENTIALS", message: "Email or password is incorrect" } });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: { code: "INVALID_CREDENTIALS", message: "Email or password is incorrect" } });
    return;
  }

  // Issue tokens
  const accessToken = signAccessToken(user);
  const { token: refreshToken } = signRefreshToken(user);
  setRefreshCookie(res, refreshToken);

  const body: TokenResponse = {
    accessToken,
    expiresIn: ACCESS_TOKEN_EXPIRY,
    user: toUserResponse(user),
  };
  res.json(body);
});

// ---------------------------------------------------------------------------
// POST /auth/refresh — exchange a valid refresh token for a new token pair
// ---------------------------------------------------------------------------

app.post("/auth/refresh", (req: Request, res: Response) => {
  const token: string | undefined = req.cookies?.refreshToken;

  if (!token) {
    res.status(401).json({ error: { code: "MISSING_REFRESH_TOKEN", message: "No refresh token cookie found" } });
    return;
  }

  try {
    const payload = jwt.verify(token, REFRESH_TOKEN_SECRET) as RefreshTokenPayload;

    // Check blacklist (handles logout-then-refresh race)
    if (refreshTokenBlacklist.has(payload.tokenId)) {
      clearRefreshCookie(res);
      res.status(401).json({ error: { code: "TOKEN_REVOKED", message: "Refresh token has been revoked" } });
      return;
    }

    const user = users.find((u) => u.id === payload.userId);
    if (!user) {
      clearRefreshCookie(res);
      res.status(401).json({ error: { code: "USER_NOT_FOUND", message: "User no longer exists" } });
      return;
    }

    // Rotate: blacklist old token, issue new pair
    refreshTokenBlacklist.add(payload.tokenId);

    const accessToken = signAccessToken(user);
    const { token: newRefreshToken } = signRefreshToken(user);
    setRefreshCookie(res, newRefreshToken);

    const body: TokenResponse = {
      accessToken,
      expiresIn: ACCESS_TOKEN_EXPIRY,
      user: toUserResponse(user),
    };
    res.json(body);
  } catch (err) {
    clearRefreshCookie(res);
    if (err instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: { code: "REFRESH_EXPIRED", message: "Refresh token has expired — please log in again" } });
      return;
    }
    res.status(401).json({ error: { code: "INVALID_REFRESH_TOKEN", message: "Refresh token is invalid" } });
  }
});

// ---------------------------------------------------------------------------
// POST /auth/logout — invalidate the current refresh token
// ---------------------------------------------------------------------------

app.post("/auth/logout", (req: Request, res: Response) => {
  const token: string | undefined = req.cookies?.refreshToken;

  if (token) {
    try {
      const payload = jwt.verify(token, REFRESH_TOKEN_SECRET) as RefreshTokenPayload;
      refreshTokenBlacklist.add(payload.tokenId);
    } catch {
      // Token is already invalid/expired — no action needed
    }
  }

  clearRefreshCookie(res);
  res.json({ message: "Logged out successfully" });
});

// ---------------------------------------------------------------------------
// GET /auth/me — return current authenticated user
// ---------------------------------------------------------------------------

app.get("/auth/me", authenticateToken, (req: Request, res: Response) => {
  res.json({ user: req.user });
});

// ---------------------------------------------------------------------------
// GET /admin/users — admin-only route demonstrating RBAC
// ---------------------------------------------------------------------------

app.get("/admin/users", authenticateToken, authorize("admin"), (_req: Request, res: Response) => {
  res.json({
    users: users.map(toUserResponse),
    total: users.length,
  });
});

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`JWT Auth server running on http://localhost:${PORT}`);
  console.log();
  console.log("Endpoints:");
  console.log("  POST /auth/register  — create account");
  console.log("  POST /auth/login     — get tokens");
  console.log("  POST /auth/refresh   — rotate tokens");
  console.log("  POST /auth/logout    — revoke refresh token");
  console.log("  GET  /auth/me        — current user (protected)");
  console.log("  GET  /admin/users    — list users (admin only)");
  console.log("  GET  /health         — health check");
});
