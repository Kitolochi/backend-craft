/**
 * OAuth 2.0 with Arctic — Google + GitHub Social Login
 *
 * Demonstrates the OAuth 2.0 authorization code flow using the Arctic library
 * for Google and GitHub providers. Includes session management with cookies,
 * PKCE for Google (required by Arctic v3), state parameter CSRF protection,
 * and user profile extraction from each provider's API.
 *
 * Prerequisites:
 *   1. Create a Google OAuth app at https://console.cloud.google.com/apis/credentials
 *      - Authorized redirect URI: http://localhost:3000/auth/callback/google
 *   2. Create a GitHub OAuth app at https://github.com/settings/developers
 *      - Authorization callback URL: http://localhost:3000/auth/callback/github
 *   3. Set environment variables:
 *      GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
 *      GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET
 *
 * Run: npx tsx src/server.ts
 * Test: Open http://localhost:3000/auth/google in a browser
 */

import express, { type Request, type Response } from "express";
import cookieParser from "cookie-parser";
import * as arctic from "arctic";

// =============================================================================
// Configuration
// =============================================================================

const PORT = 3000;
const BASE_URL = "http://localhost:3000";

/**
 * In production these come from environment variables or a secrets manager.
 * The placeholder values here let the code compile and start, but the OAuth
 * flow will fail until real credentials are provided.
 */
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "your-google-client-id";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "your-google-client-secret";
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID ?? "your-github-client-id";
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET ?? "your-github-client-secret";

/** Secret used to sign session cookies. Must be random and long in production. */
const SESSION_SECRET = "session-secret-change-in-production";

// =============================================================================
// Arctic Provider Instances
// =============================================================================

/**
 * Arctic v3 creates lightweight provider objects that know how to build
 * authorization URLs and exchange codes for tokens. Each provider follows
 * the same interface so adding a new provider (Discord, Apple, etc.) is
 * a one-liner plus its callback handler.
 */
const google = new arctic.Google(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  `${BASE_URL}/auth/callback/google`
);

const github = new arctic.GitHub(
  GITHUB_CLIENT_ID,
  GITHUB_CLIENT_SECRET,
  `${BASE_URL}/auth/callback/github`
);

// =============================================================================
// Types
// =============================================================================

/** Normalized user profile extracted from any provider. */
interface UserProfile {
  provider: "google" | "github";
  providerId: string;
  email: string;
  name: string;
  avatarUrl: string;
}

/** A simple session stored in memory and referenced by cookie. */
interface Session {
  id: string;
  user: UserProfile;
  createdAt: Date;
}

// =============================================================================
// In-Memory Stores
// =============================================================================

/**
 * Session store keyed by session ID. In production use Redis, a database,
 * or a dedicated session store like connect-redis.
 */
const sessions = new Map<string, Session>();

/**
 * Pending OAuth flows, keyed by state parameter.
 * Stores the PKCE code verifier (for Google) so we can pass it back
 * when exchanging the authorization code.
 */
const pendingFlows = new Map<string, { codeVerifier?: string; createdAt: number }>();

// =============================================================================
// Helpers
// =============================================================================

/** Generate a simple random ID. */
function generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/**
 * Set the session cookie.
 * - httpOnly prevents JavaScript access (XSS protection)
 * - sameSite: lax allows the cookie on OAuth redirects while blocking CSRF
 * - secure would be true in production (HTTPS only)
 */
function setSessionCookie(res: Response, sessionId: string): void {
  res.cookie("session", sessionId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    path: "/",
  });
}

/** Clear the session cookie. */
function clearSessionCookie(res: Response): void {
  res.clearCookie("session", { path: "/" });
}

/**
 * Clean up expired pending flows to prevent memory leaks.
 * Flows older than 10 minutes are removed.
 */
function cleanupPendingFlows(): void {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [state, flow] of pendingFlows) {
    if (flow.createdAt < cutoff) {
      pendingFlows.delete(state);
    }
  }
}

// =============================================================================
// Express App
// =============================================================================

const app = express();
app.use(express.json());
app.use(cookieParser());

// Clean up stale pending flows every 5 minutes
setInterval(cleanupPendingFlows, 5 * 60 * 1000);

// ---------------------------------------------------------------------------
// GET /auth/google — Start Google OAuth flow
// ---------------------------------------------------------------------------

app.get("/auth/google", (_req: Request, res: Response) => {
  const state = arctic.generateState();

  // Google requires PKCE (Proof Key for Code Exchange) in Arctic v3.
  // We generate a code verifier here and store it so we can pass it
  // back when exchanging the authorization code.
  const codeVerifier = arctic.generateCodeVerifier();

  // Store the verifier associated with this state for the callback
  pendingFlows.set(state, { codeVerifier, createdAt: Date.now() });

  // Request openid, profile, and email scopes.
  // "openid" enables ID token; "profile" gives name/avatar; "email" gives email.
  const url = google.createAuthorizationURL(state, codeVerifier, ["openid", "profile", "email"]);

  // Set access_type to "offline" to receive a refresh token
  url.searchParams.set("access_type", "offline");

  // Store the state in a cookie so we can verify it on callback
  res.cookie("oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 10 * 60 * 1000, // 10 minutes
    path: "/",
  });

  res.redirect(url.toString());
});

// ---------------------------------------------------------------------------
// GET /auth/github — Start GitHub OAuth flow
// ---------------------------------------------------------------------------

app.get("/auth/github", (_req: Request, res: Response) => {
  const state = arctic.generateState();

  // GitHub does not require PKCE, so no code verifier is needed
  pendingFlows.set(state, { createdAt: Date.now() });

  // Request user:email scope to access the user's email addresses
  const url = github.createAuthorizationURL(state, ["user:email"]);

  res.cookie("oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 10 * 60 * 1000,
    path: "/",
  });

  res.redirect(url.toString());
});

// ---------------------------------------------------------------------------
// GET /auth/callback/google — Handle Google OAuth callback
// ---------------------------------------------------------------------------

app.get("/auth/callback/google", async (req: Request, res: Response) => {
  const { code, state } = req.query as { code?: string; state?: string };
  const storedState = req.cookies?.oauth_state;

  // Verify the state parameter to prevent CSRF attacks.
  // The state we stored in the cookie must match what the provider sent back.
  if (!code || !state || state !== storedState) {
    res.status(400).json({ error: { message: "Invalid OAuth state — possible CSRF attack" } });
    return;
  }

  // Retrieve the stored code verifier for this flow
  const flow = pendingFlows.get(state);
  if (!flow?.codeVerifier) {
    res.status(400).json({ error: { message: "OAuth flow expired or missing PKCE verifier" } });
    return;
  }

  // Clean up the pending flow and state cookie
  pendingFlows.delete(state);
  res.clearCookie("oauth_state", { path: "/" });

  try {
    // Exchange the authorization code for tokens
    const tokens = await google.validateAuthorizationCode(code, flow.codeVerifier);
    const accessToken = tokens.accessToken();

    // Fetch user profile from Google's OpenID Connect userinfo endpoint
    const userResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!userResponse.ok) {
      res.status(502).json({ error: { message: "Failed to fetch Google user profile" } });
      return;
    }

    const googleUser = (await userResponse.json()) as {
      sub: string;
      email: string;
      name: string;
      picture: string;
    };

    // Normalize the profile into our standard shape
    const profile: UserProfile = {
      provider: "google",
      providerId: googleUser.sub,
      email: googleUser.email,
      name: googleUser.name,
      avatarUrl: googleUser.picture,
    };

    // Create a session
    const sessionId = generateId();
    sessions.set(sessionId, { id: sessionId, user: profile, createdAt: new Date() });
    setSessionCookie(res, sessionId);

    res.json({
      message: "Google login successful",
      user: profile,
    });
  } catch (err) {
    console.error("Google OAuth error:", err);
    res.status(500).json({ error: { message: "Google authentication failed" } });
  }
});

// ---------------------------------------------------------------------------
// GET /auth/callback/github — Handle GitHub OAuth callback
// ---------------------------------------------------------------------------

app.get("/auth/callback/github", async (req: Request, res: Response) => {
  const { code, state } = req.query as { code?: string; state?: string };
  const storedState = req.cookies?.oauth_state;

  if (!code || !state || state !== storedState) {
    res.status(400).json({ error: { message: "Invalid OAuth state — possible CSRF attack" } });
    return;
  }

  const flow = pendingFlows.get(state);
  if (!flow) {
    res.status(400).json({ error: { message: "OAuth flow expired" } });
    return;
  }

  pendingFlows.delete(state);
  res.clearCookie("oauth_state", { path: "/" });

  try {
    // Exchange the authorization code for tokens (no PKCE for GitHub)
    const tokens = await github.validateAuthorizationCode(code);
    const accessToken = tokens.accessToken();

    // Fetch the user's profile from GitHub's API
    const userResponse = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": "backend-craft-oauth-example",
      },
    });

    if (!userResponse.ok) {
      res.status(502).json({ error: { message: "Failed to fetch GitHub user profile" } });
      return;
    }

    const githubUser = (await userResponse.json()) as {
      id: number;
      login: string;
      name: string | null;
      email: string | null;
      avatar_url: string;
    };

    // If the user's email is private, fetch it from the emails endpoint.
    // The "user:email" scope grants access to this endpoint.
    let email = githubUser.email;
    if (!email) {
      const emailsResponse = await fetch("https://api.github.com/user/emails", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "User-Agent": "backend-craft-oauth-example",
        },
      });

      if (emailsResponse.ok) {
        const emails = (await emailsResponse.json()) as Array<{
          email: string;
          primary: boolean;
          verified: boolean;
        }>;
        // Pick the primary verified email
        const primary = emails.find((e) => e.primary && e.verified);
        email = primary?.email ?? emails[0]?.email ?? "unknown";
      }
    }

    const profile: UserProfile = {
      provider: "github",
      providerId: String(githubUser.id),
      email: email ?? "unknown",
      name: githubUser.name ?? githubUser.login,
      avatarUrl: githubUser.avatar_url,
    };

    const sessionId = generateId();
    sessions.set(sessionId, { id: sessionId, user: profile, createdAt: new Date() });
    setSessionCookie(res, sessionId);

    res.json({
      message: "GitHub login successful",
      user: profile,
    });
  } catch (err) {
    console.error("GitHub OAuth error:", err);
    res.status(500).json({ error: { message: "GitHub authentication failed" } });
  }
});

// ---------------------------------------------------------------------------
// GET /auth/me — Return the current session's user profile
// ---------------------------------------------------------------------------

app.get("/auth/me", (req: Request, res: Response) => {
  const sessionId = req.cookies?.session;

  if (!sessionId) {
    res.status(401).json({ error: { message: "Not authenticated — no session cookie" } });
    return;
  }

  const session = sessions.get(sessionId);
  if (!session) {
    clearSessionCookie(res);
    res.status(401).json({ error: { message: "Session expired or invalid" } });
    return;
  }

  res.json({ user: session.user });
});

// ---------------------------------------------------------------------------
// POST /auth/logout — Destroy session and clear cookie
// ---------------------------------------------------------------------------

app.post("/auth/logout", (req: Request, res: Response) => {
  const sessionId = req.cookies?.session;

  if (sessionId) {
    sessions.delete(sessionId);
  }

  clearSessionCookie(res);
  res.json({ message: "Logged out successfully" });
});

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", activeSessions: sessions.size, uptime: process.uptime() });
});

// =============================================================================
// Start
// =============================================================================

app.listen(PORT, () => {
  console.log(`OAuth server running on http://localhost:${PORT}`);
  console.log();
  console.log("Endpoints:");
  console.log("  GET  /auth/google            — start Google OAuth flow");
  console.log("  GET  /auth/github            — start GitHub OAuth flow");
  console.log("  GET  /auth/callback/google   — Google callback (automatic)");
  console.log("  GET  /auth/callback/github   — GitHub callback (automatic)");
  console.log("  GET  /auth/me                — current user (requires session)");
  console.log("  POST /auth/logout            — destroy session");
  console.log("  GET  /health                 — health check");
  console.log();
  console.log("Set these environment variables before testing:");
  console.log("  GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET");
  console.log("  GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET");
});
