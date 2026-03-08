import express from "express";
import { createAuth, createSession, verifySession } from "./auth.js";

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json());

const auth = createAuth();

// ---- Auth routes ----

app.post("/auth/signup", async (req, res) => {
  const { email, password, name } = req.body;

  const existing = auth.findUserByEmail(email);
  if (existing) {
    res.status(409).json({ error: "Email already registered" });
    return;
  }

  const user = auth.createUser({ email, password, name });
  const session = createSession(user.id);

  res.status(201).json({
    user: { id: user.id, email: user.email, name: user.name },
    session: { token: session.token, expiresAt: session.expiresAt },
  });
});

app.post("/auth/login", async (req, res) => {
  const { email, password } = req.body;

  const user = auth.verifyCredentials(email, password);
  if (!user) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const session = createSession(user.id);
  res.json({
    user: { id: user.id, email: user.email, name: user.name },
    session: { token: session.token, expiresAt: session.expiresAt },
  });
});

app.post("/auth/logout", (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (token) {
    auth.revokeSession(token);
  }
  res.json({ message: "Logged out" });
});

// ---- Passkey routes (WebAuthn simulation) ----

app.post("/auth/passkey/register-options", (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  const session = token ? verifySession(token) : null;
  if (!session) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const options = auth.generatePasskeyRegistration(session.userId);
  res.json(options);
});

app.post("/auth/passkey/register", (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  const session = token ? verifySession(token) : null;
  if (!session) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const { credentialId, publicKey } = req.body;
  auth.registerPasskey(session.userId, credentialId, publicKey);
  res.json({ message: "Passkey registered" });
});

app.post("/auth/passkey/login", (req, res) => {
  const { credentialId, signature } = req.body;
  const user = auth.verifyPasskey(credentialId, signature);
  if (!user) {
    res.status(401).json({ error: "Invalid passkey" });
    return;
  }

  const session = createSession(user.id);
  res.json({
    user: { id: user.id, email: user.email, name: user.name },
    session: { token: session.token, expiresAt: session.expiresAt },
  });
});

// ---- Protected route ----

app.get("/me", (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  const session = token ? verifySession(token) : null;
  if (!session) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const user = auth.findUserById(session.userId);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    passkeys: user.passkeys.length,
    sessionExpiresAt: session.expiresAt,
  });
});

app.listen(PORT, () => {
  console.log(`better-auth demo on http://localhost:${PORT}`);
  console.log("\nRoutes:");
  console.log("  POST /auth/signup    { email, password, name }");
  console.log("  POST /auth/login     { email, password }");
  console.log("  POST /auth/logout    (Bearer token)");
  console.log("  POST /auth/passkey/register-options  (Bearer token)");
  console.log("  POST /auth/passkey/register          (Bearer token)");
  console.log("  POST /auth/passkey/login             { credentialId, signature }");
  console.log("  GET  /me             (Bearer token)");
});
