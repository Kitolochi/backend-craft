# Security & Auth Reference — Node.js / TypeScript

Deep-dive reference for authentication, authorization, and API security patterns.

---

## 1. Auth Architecture Patterns

### Session vs JWT vs Hybrid

| Pattern | Stateless | Revocable | Horizontal Scale | Best For |
|---------|-----------|-----------|------------------|----------|
| **Sessions** | No | Instant | Needs shared store | Web apps, admin panels |
| **JWT** | Yes | At expiry only | Native | APIs, microservices, mobile |
| **Hybrid** | Both | Yes (sessions) | Yes (JWTs for API) | Modern apps (recommended) |

**Hybrid approach (recommended):**
- Sessions for web application authentication
- Short-lived JWTs (15-30 min) for API access
- Refresh tokens (7-14 days) with single-use rotation

### Refresh Token Rotation

**Critical rules:**
- Single-use tokens — replace after every use
- Detect reuse: if same token used twice → revoke entire session
- Store hashed (SHA-256), never plaintext
- Browser: HttpOnly + Secure + SameSite cookies
- Mobile: Keychain (iOS) / Keystore (Android)
- Never localStorage (XSS vulnerable)
- Redis for token metadata in distributed systems

### OAuth 2.0 + OIDC

**Library: Arctic (recommended)**
```bash
npm i arctic
```
- OAuth 2.0 clients for 50+ providers (Google, GitHub, Discord, etc.)
- Authorization code flow with PKCE
- Runtime-agnostic (Node 20+, Bun, Deno, Workers)
- Auto-uses OIDC when provider supports it

### Magic Link / Passwordless

**Rules:**
- `crypto.randomBytes(32)` minimum (128 bits entropy)
- Single-use (invalidate after first click)
- Short TTL (5-15 minutes)
- HTTPS only, send via Authorization header
- Good for: consumer apps, low-friction login
- Not for: high-risk / compliance-heavy environments

### Passkeys / WebAuthn

**Library: SimpleWebAuthn (recommended)**
```bash
npm i @simplewebauthn/server
```
- Phishing-resistant (authenticator verifies domain)
- No private key exposure (stays on device)
- Works on all runtimes
- Auth.js also has built-in WebAuthn support

### Multi-Factor Auth (TOTP)

**Library: otplib**
```bash
npm i otplib
```
- TOTP algorithm — works with Google Authenticator, Authy, etc.
- Generate secret → display QR code → validate codes
- Authenticator apps preferred over SMS (more secure)

---

## 2. Auth Library Decision

| Library | Status | Best For |
|---------|--------|----------|
| **Better Auth** | Active, rising | Modern TS apps, Lucia replacement |
| **Auth.js v5** | Active | Next.js, social auth |
| **Passport.js** | Mature | Express, 500+ strategies |
| **Arctic** | Active | Lightweight OAuth 2.0 |
| **Lucia** | **Deprecated** | Do not use for new projects |

### Managed Services

| Service | Free MAUs | Best For |
|---------|-----------|----------|
| **Clerk** | 10,000 | React/Next.js, fast setup |
| **Auth0** | 7,500 | Enterprise, complex flows |
| **Supabase Auth** | 50,000 | Supabase ecosystem |
| **WorkOS** | Per-connection | Enterprise SSO, SAML/SCIM |

**Decision:** DIY auth for learning/control, managed for speed/compliance.

---

## 3. Access Control

### RBAC (Role-Based)
- Permissions grouped into roles: Admin, Editor, Viewer
- Simple, predictable
- Best for: admin panels, CMS, most SaaS

### ABAC (Attribute-Based)
- Authorization based on: user identity, role, department, location, time
- Fine-grained, context-aware
- Best for: complex scenarios with contextual rules

### Hybrid (Most Common)
1. Check role-based access first
2. Apply attribute checks (ownerId, teamId, orgId)

**Libraries:** AccessControl, Casbin (node-casbin), Casl, Oso Cloud

---

## 4. Security Middleware Stack

### Must-Have (in order)

```
1. helmet          — Security headers (XSS, clickjacking, MIME sniffing)
2. cors            — Origin allowlisting (tiered: public/auth/admin)
3. rate-limit      — Brute force + abuse prevention
4. csrf protection — csrf-csrf (stateless) or csrf-sync (stateful)
5. input validation — Zod at route entry points
```

### Helmet
```bash
npm i helmet
```
- One line: `app.use(helmet())` sets 13+ security headers
- Content-Security-Policy, X-Frame-Options, X-Powered-By removal
- Start with defaults, customize as needed

### CORS

**Tiered configuration (best practice):**
1. Public endpoints: allow all origins, limited methods
2. Authenticated: exact origins only
3. Admin: strictest controls

**Rules:**
- Never `*` with `credentials: true` (browser blocks)
- CORS is NOT access control — any HTTP client bypasses it
- Use dynamic origin validation function, not static strings

### Rate Limiting
```bash
npm i express-rate-limit    # Express
npm i @fastify/rate-limit   # Fastify
```
- General: 100 req/15min
- Auth endpoints: 5-10 req/15min
- Use Redis store for distributed systems

### CSRF Protection

**csurf is DEPRECATED — do not use.**

Modern alternatives:
```bash
npm i csrf-csrf    # Stateless (double submit cookie)
npm i csrf-sync    # Stateful (synchronizer token)
```
- Layer with SameSite cookies (Strict or Lax)
- POST/PUT/DELETE for mutations only

---

## 5. API Security

### API Key Management

**Generation:**
- `crypto.randomBytes(32)` minimum (64 preferred)
- 128+ bits of entropy

**Storage:**
- Hash before storing (like passwords)
- Environment variables (never in code)
- Never commit to version control

**Transport:**
- HTTPS only
- `Authorization: Bearer <key>` header (never URL params)

**Rotation:**
- Regular rotation schedule
- Alert on suspicious activity
- Trend: short-lived, auto-expiring credentials

### Webhook Signature Verification

**Standard: HMAC-SHA256** (used by Stripe, GitHub, Shopify, Slack)

```typescript
// Critical: use raw body, not parsed JSON
app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['x-signature'];
  const computed = crypto
    .createHmac('sha256', SECRET)
    .update(req.body)
    .digest('hex');

  // Critical: timing-safe comparison (prevents timing attacks)
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(computed))) {
    return res.status(401).send('Invalid signature');
  }
});
```

**Rules:**
- Raw request body (not parsed JSON)
- `crypto.timingSafeEqual()` — never `===`
- Reject webhooks older than X minutes (replay prevention)

**Library: Tern** — universal webhook verification framework (Stripe, GitHub, Clerk, Shopify)

### Request Signing (HMAC)
- System-to-system auth (simpler than OAuth)
- Include timestamp in signed payload (replay prevention)
- SHA-256 or stronger (avoid SHA-1)

### Bot Protection

**Cloudflare Turnstile (recommended over reCAPTCHA):**
- Silent JS challenges (no visual puzzles)
- Better UX, privacy-focused, free tier
- React: `@marsidev/react-turnstile`
- Vue: `vue-turnstile`, Svelte: `svelte-turnstile`

---

## 6. Input Validation & Sanitization

### Zod (recommended)
```bash
npm i zod
```
- 40M+ weekly downloads
- Runtime + compile-time safety via `z.infer<>`
- Validate at route entry points (middleware)
- `.transform()` for sanitization

### SQL Injection Prevention
1. **Use ORMs** (Prisma, Drizzle) — auto-parameterization
2. **Parameterized queries** — input as data, never concatenated
3. **Validate inputs** — Zod at boundaries
4. **Warning:** ORMs not 100% safe with raw queries

### XSS Prevention
- CSP headers via Helmet
- Never `dangerouslySetInnerHTML` without sanitization
- Escape user content in templates
- Use `DOMPurify` for HTML sanitization on client

---

## 7. Secrets Management

### Type-Safe Env (recommended)
```bash
npm i @t3-oss/env-core zod
```
```typescript
import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().url(),
    API_KEY: z.string().min(1),
    NODE_ENV: z.enum(['development', 'production', 'test']),
  },
  runtimeEnv: process.env,
});
// env.DATABASE_URL — fully typed, validated at startup
```

- Prevents deployment with invalid/missing env vars
- TypeScript type inference (no `string | undefined`)
- Throws errors on schema mismatch

### Enterprise Secrets
| Tool | Best For |
|------|----------|
| **HashiCorp Vault** | Multi-cloud, Kubernetes, CI/CD |
| **AWS Secrets Manager** | AWS-native services |
| **Azure Key Vault** | Azure ecosystem |

---

## 8. Content Security Policy (CSP)

```javascript
app.use(helmet.contentSecurityPolicy({
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "trusted-cdn.com"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", "data:", "cdn.example.com"],
    connectSrc: ["'self'", "api.example.com"],
  }
}));
```

**Best practice:**
1. Start with `Content-Security-Policy-Report-Only`
2. Monitor violations via reporting endpoint
3. Gradually tighten policy
4. Then enforce

---

## Quick Checklist — Before Shipping

- [ ] Helmet enabled with CSP
- [ ] CORS configured (not wildcard with credentials)
- [ ] Rate limiting on auth + public endpoints
- [ ] Input validation (Zod) on all routes
- [ ] Parameterized queries (no string concatenation SQL)
- [ ] No secrets in code (use env vars + @t3-oss/env-core)
- [ ] HttpOnly + Secure + SameSite cookies for tokens
- [ ] CSRF protection on mutation endpoints
- [ ] Error responses don't leak stack traces in production
- [ ] Dependencies up to date (npm audit)
- [ ] HTTPS enforced (HSTS header)
