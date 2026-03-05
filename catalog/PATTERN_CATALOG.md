# Backend Pattern Catalog

Master reference of backend patterns and working examples to build.
Each entry: description, difficulty, dependencies, and use case.

Status: [x] = built, [ ] = available to build

---

## Category 1: API Patterns

- [ ] **REST CRUD** — Complete REST API with proper status codes, pagination, filtering, sorting. Express + Zod.
- [ ] **REST CRUD (Fastify)** — Same patterns using Fastify with JSON Schema validation + auto OpenAPI.
- [ ] **REST CRUD (Hono)** — Same patterns using Hono with Zod OpenAPI middleware.
- [ ] **tRPC Server** — Type-safe API with routers, procedures, context, middleware. Full client example.
- [ ] **GraphQL API** — Schema-first API with GraphQL Yoga, queries, mutations, subscriptions.
- [ ] **OpenAPI Generation** — Zod schemas → OpenAPI 3.1 spec → Swagger UI. Express or Hono.
- [ ] **API Versioning** — URL path, header, and query param versioning strategies.
- [ ] **Rate-Limited API** — Express + express-rate-limit with tiered limits per endpoint.
- [ ] **Webhook Sender** — Outbound webhook system with retry, signature, delivery tracking.
- [ ] **Webhook Receiver** — Inbound webhook handler with signature verification (Stripe, GitHub patterns).

## Category 2: Authentication

- [ ] **JWT Auth** — Access + refresh token flow with rotation. Express middleware.
- [ ] **Session Auth** — Cookie-based sessions with Redis store. Login/logout/me endpoints.
- [ ] **OAuth 2.0 (Arctic)** — Google + GitHub social login using Arctic library.
- [ ] **Magic Link** — Passwordless email login with token generation + Resend.
- [ ] **Passkeys (WebAuthn)** — Registration + authentication flow with SimpleWebAuthn.
- [ ] **Better Auth Setup** — Full auth system using Better Auth library.
- [ ] **RBAC Middleware** — Role-based access control with route-level permission checks.
- [ ] **API Key Auth** — API key generation, hashing, rotation, and middleware validation.
- [ ] **Multi-Factor Auth** — TOTP (authenticator app) as second factor with otpauth library.

## Category 3: Middleware & Security

- [ ] **Production Middleware Stack** — Helmet + CORS + Morgan + rate-limit + error handler. Copy-paste ready.
- [ ] **Zod Validation Middleware** — Request body/params/query validation with typed errors.
- [ ] **Valibot Validation** — Same patterns with Valibot for bundle-size comparison.
- [ ] **Centralized Error Handler** — Custom AppError class, async wrapper, structured error responses.
- [ ] **Request Logging** — Pino structured logging with request IDs, timing, and log levels.
- [ ] **CORS Configuration** — Dev/staging/production CORS configs with credentials handling.
- [ ] **Content Security Policy** — CSP header configuration for different app types.
- [ ] **Input Sanitization** — XSS prevention, SQL injection prevention, path traversal prevention.

## Category 4: Background Jobs

- [ ] **BullMQ Basic** — Queue + worker + job types. Redis connection, retries, priorities.
- [ ] **BullMQ Cron** — Repeatable/scheduled jobs with cron expressions.
- [ ] **BullMQ Dashboard** — Bull Board or Arena UI for monitoring queues.
- [ ] **Trigger.dev Workflow** — Managed background job with built-in integrations.
- [ ] **Inngest Step Function** — Multi-step workflow with sleep, retry, and fan-out.
- [ ] **Simple Cron** — node-cron for basic scheduled tasks (cleanup, reports, health checks).
- [ ] **Email Queue** — Queue-based email sending with retry and dead letter handling.

## Category 5: File Handling & Storage

- [ ] **Presigned Upload** — S3/R2 presigned URL generation + client-side upload flow.
- [ ] **Multipart Upload** — Multer middleware for direct server upload with validation.
- [ ] **Image Processing** — Sharp for resize/crop/format on upload. Thumbnail generation.
- [ ] **File Streaming** — Busboy streaming parser for large file handling.
- [ ] **S3 Operations** — List, get, delete, copy operations with @aws-sdk/client-s3.
- [ ] **R2 with Workers** — Cloudflare R2 integration from Hono on Workers.

## Category 6: Email

- [ ] **Resend Basic** — Send transactional email with Resend SDK.
- [ ] **React Email Templates** — 5 email templates (welcome, reset, invoice, notification, digest).
- [ ] **Email Queue** — BullMQ + Resend for reliable email delivery with retries.
- [ ] **Nodemailer SMTP** — Traditional SMTP sending for self-hosted setups.

## Category 7: Real-time (preview — full coverage in realtime-craft)

- [ ] **SSE (Server-Sent Events)** — One-way server push for notifications, progress updates.
- [ ] **WebSocket Basic** — ws library for bidirectional real-time communication.

## Category 8: Database Patterns (preview — full coverage in database-craft)

- [ ] **Prisma CRUD** — Basic model + CRUD operations + migrations.
- [ ] **Drizzle CRUD** — SQL-like queries with full type safety.
- [ ] **Connection Pooling** — PgBouncer / built-in pool configuration.

## Category 9: Deployment Patterns (preview — full coverage in infra-craft)

- [ ] **Docker API** — Dockerfile + docker-compose for Node.js API.
- [ ] **Health Check Endpoint** — Liveness + readiness probes for container orchestration.
- [ ] **Graceful Shutdown** — SIGTERM handling, connection draining, cleanup.
- [ ] **Environment Config** — Type-safe env with @t3-oss/env-core + Zod.

---

## Quick Reference: Pattern → Use Case

| Pattern | Best For |
|---------|----------|
| REST CRUD | Standard web APIs, public APIs |
| tRPC | Internal tools, TS monorepos |
| GraphQL | Complex data needs, multiple clients |
| JWT Auth | Mobile apps, microservices |
| Session Auth | Traditional web apps |
| OAuth 2.0 | Social login, enterprise SSO |
| Magic Link | Consumer apps, low-friction |
| Passkeys | High security, modern UX |
| BullMQ | High-volume job processing |
| Trigger.dev | AI workflows, managed infra |
| Presigned Upload | Large files, scalable storage |
| Resend + React Email | Transactional email, modern DX |
| Docker + Health Check | Production deployment |

---

## Build Priority

**Tier 1 — Essentials (build first):**
1. REST CRUD (Express)
2. JWT Auth
3. Production Middleware Stack
4. Zod Validation Middleware
5. Centralized Error Handler
6. Presigned Upload
7. Resend Basic
8. Docker API

**Tier 2 — Modern Patterns:**
9. REST CRUD (Hono)
10. OAuth 2.0 (Arctic)
11. Better Auth Setup
12. BullMQ Basic
13. React Email Templates
14. OpenAPI Generation
15. Request Logging

**Tier 3 — Advanced:**
16. tRPC Server
17. GraphQL API
18. Passkeys (WebAuthn)
19. Inngest Step Function
20. Webhook Sender/Receiver
21. RBAC Middleware
22. API Key Auth
