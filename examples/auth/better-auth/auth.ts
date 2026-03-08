import { randomUUID, randomBytes, createHash } from "node:crypto";

// ---- Types ----

interface User {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  passkeys: Passkey[];
  createdAt: Date;
}

interface Passkey {
  credentialId: string;
  publicKey: string;
  createdAt: Date;
}

interface Session {
  token: string;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
}

// ---- In-memory stores ----

const users = new Map<string, User>();
const sessions = new Map<string, Session>();
const emailIndex = new Map<string, string>(); // email -> userId
const passkeyIndex = new Map<string, string>(); // credentialId -> userId

// ---- Helpers ----

function hashPassword(password: string): string {
  return createHash("sha256").update(password).digest("hex");
}

// ---- Auth API ----

export function createAuth() {
  return {
    createUser(input: { email: string; password: string; name: string }): User {
      const user: User = {
        id: randomUUID(),
        email: input.email,
        name: input.name,
        passwordHash: hashPassword(input.password),
        passkeys: [],
        createdAt: new Date(),
      };
      users.set(user.id, user);
      emailIndex.set(user.email, user.id);
      return user;
    },

    findUserByEmail(email: string): User | undefined {
      const id = emailIndex.get(email);
      return id ? users.get(id) : undefined;
    },

    findUserById(id: string): User | undefined {
      return users.get(id);
    },

    verifyCredentials(email: string, password: string): User | undefined {
      const id = emailIndex.get(email);
      if (!id) return undefined;
      const user = users.get(id);
      if (!user) return undefined;
      if (user.passwordHash !== hashPassword(password)) return undefined;
      return user;
    },

    revokeSession(token: string): void {
      sessions.delete(token);
    },

    // ---- Passkey methods ----

    generatePasskeyRegistration(userId: string) {
      const user = users.get(userId);
      if (!user) throw new Error("User not found");

      // Simulated WebAuthn registration options
      return {
        challenge: randomBytes(32).toString("base64url"),
        rp: { name: "better-auth-demo", id: "localhost" },
        user: {
          id: Buffer.from(user.id).toString("base64url"),
          name: user.email,
          displayName: user.name,
        },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },   // ES256
          { type: "public-key", alg: -257 },  // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          userVerification: "required",
          residentKey: "required",
        },
      };
    },

    registerPasskey(userId: string, credentialId: string, publicKey: string): void {
      const user = users.get(userId);
      if (!user) throw new Error("User not found");

      user.passkeys.push({
        credentialId,
        publicKey,
        createdAt: new Date(),
      });
      passkeyIndex.set(credentialId, userId);
    },

    verifyPasskey(credentialId: string, _signature: string): User | undefined {
      const userId = passkeyIndex.get(credentialId);
      if (!userId) return undefined;

      const user = users.get(userId);
      if (!user) return undefined;

      // In production: verify the signature against the stored public key
      // using the WebAuthn verification algorithm
      return user;
    },
  };
}

// ---- Session management ----

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function createSession(userId: string): Session {
  const session: Session = {
    token: randomBytes(32).toString("base64url"),
    userId,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    createdAt: new Date(),
  };
  sessions.set(session.token, session);
  return session;
}

export function verifySession(token: string): Session | null {
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt < new Date()) {
    sessions.delete(token);
    return null;
  }
  return session;
}
