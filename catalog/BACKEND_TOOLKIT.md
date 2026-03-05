# Backend Toolkit — Node.js / TypeScript

Master reference for backend development. Frameworks, auth, APIs, middleware, jobs, storage, email.

---

## 1. Frameworks

### Decision Matrix

| Framework | Best For | TypeScript | Performance | Ecosystem | Learning Curve |
|-----------|----------|------------|-------------|-----------|---------------|
| **Express** | General purpose, legacy | Via @types | Baseline | Massive | Low |
| **Fastify** | JSON APIs, plugins | First-class | ~30% > Express | Large | Medium |
| **Hono** | Edge, serverless, multi-runtime | First-class | Excellent | Growing | Low |
| **NestJS** | Enterprise, large teams | Built-in (decorators) | Good | Large | High |
| **Elysia** | Bun-only, max performance | First-class | Matches Go/Rust | Small | Medium |
| **Nitro** | Universal deploy, Nuxt | Built-in | Good | Growing | Medium |
| **tRPC** | TS monorepos, internal tools | Required | Good | Active | Medium |

### Express
```bash
npm i express @types/express
```
- 14M+ weekly downloads — most battle-tested
- Massive middleware ecosystem
- Minimalist: you build everything yourself
- Best for: general-purpose, teams wanting flexibility

### Fastify
```bash
npm i fastify
```
- JSON Schema validation built-in
- Plugin architecture for modularity
- Auto OpenAPI generation from schemas
- Best for: JSON APIs, plugin-based architectures

### Hono
```bash
npm i hono
```
- Ultra-lightweight, edge-runtime optimized
- Runs on Cloudflare Workers, Deno, Bun, Node
- Built-in Zod OpenAPI via `@hono/zod-openapi`
- Best for: edge deployments, serverless, tiny bundles

### NestJS
```bash
npm i @nestjs/core @nestjs/common
```
- Angular-style DI + modules + decorators
- Built-in GraphQL, WebSockets, microservices
- Opinionated structure — great for large teams
- Best for: enterprise apps, microservices

### Elysia
```bash
bun add elysia
```
- Bun-only — 25ms cold starts
- TypeBox validation (18× faster than Zod on Node)
- End-to-end type safety like tRPC
- Best for: Bun projects, performance-critical APIs

### Nitro
```bash
npm i nitropack
```
- UnJS ecosystem — powers Nuxt, SolidStart, Analog
- Universal deploy (zero-config for any platform)
- Output < 1MB, auto route registration
- Best for: multi-platform deploy, Vue/Nuxt ecosystem

### tRPC
```bash
npm i @trpc/server @trpc/client
```
- End-to-end type safety, zero codegen
- Direct type sharing client ↔ server
- v11: React Server Components support
- Best for: TS monorepos, Next.js apps, internal tools
- NOT for: public APIs, polyglot clients

---

## 2. Authentication

### Strategy Comparison

| Strategy | Stateless | Revocable | Best For |
|----------|-----------|-----------|----------|
| **Sessions** | No | Instant | Web apps, monoliths |
| **JWT** | Yes | At expiry only | APIs, microservices, mobile |
| **JWT + Refresh** | Hybrid | Via refresh rotation | Modern web + mobile |
| **Magic Link** | N/A | Single-use | Consumer apps, low-friction |
| **Passkeys/WebAuthn** | N/A | Per-device | High security, passwordless |
| **OAuth 2.0 + OIDC** | Depends | Via provider | Social login, enterprise SSO |

### Library Comparison

| Library | Weekly Downloads | Best For | Status |
|---------|-----------------|----------|--------|
| **Passport.js** | 2M+ | Flexible, 500+ strategies | Mature, aging |
| **Auth.js (NextAuth)** | Growing | Next.js, social auth | Active, v5 |
| **Better Auth** | Growing | Modern TS, Lucia successor | Rising |
| **Arctic** | Growing | OAuth 2.0 for 50+ providers | Active, lightweight |
| **Lucia** | — | — | **Deprecated** — use Better Auth |

### Auth.js (NextAuth v5)
```bash
npm i next-auth @auth/core
```
- Framework integrations (Next.js, SvelteKit, etc.)
- Social login out of the box
- WebAuthn/passkey support built-in
- Free, open source

### Better Auth
```bash
npm i better-auth
```
- Lucia's spiritual successor
- Modern TypeScript-first design
- Session management + social auth
- Growing ecosystem

### Arctic
```bash
npm i arctic
```
- OAuth 2.0 clients for 50+ providers
- Runtime-agnostic (Node, Bun, Deno, Workers)
- PKCE + token revocation support
- Lightweight, focused

### Passkeys / WebAuthn
```bash
npm i @simplewebauthn/server
```
- SimpleWebAuthn: best library for FIDO2/WebAuthn
- Works on all runtimes
- Auth.js also has built-in WebAuthn support

### Managed Services
| Service | Best For | Pricing |
|---------|----------|---------|
| **Clerk** | React/Next.js, fast integration | Free tier, per-MAU |
| **Auth0** | Enterprise, complex flows | Free tier, per-MAU |
| **WorkOS** | Enterprise SSO, SAML/SCIM | Per-connection |
| **Supabase Auth** | Supabase stack | Included with Supabase |

---

## 3. API Design

### Protocol Decision Matrix

| Protocol | Public API | Internal | Type Safety | Real-time | Ecosystem |
|----------|-----------|----------|-------------|-----------|-----------|
| **REST** | Best | Good | Manual (OpenAPI) | No | Massive |
| **GraphQL** | Good | Great | Schema-based | Subscriptions | Large |
| **tRPC** | No | Best | Automatic | Via subscriptions | TS-only |
| **gRPC** | Service-to-service | Best | Proto-based | Streaming | Polyglot |

### REST + OpenAPI
```bash
# Zod → OpenAPI generation
npm i @asteasolutions/zod-to-openapi
# or with Hono
npm i @hono/zod-openapi
# or with Express
npm i express-zod-api
```
- OpenAPI 3.1 is the universal standard
- Generate docs from Zod schemas — no manual spec writing
- Best for: public APIs, multi-language clients

### GraphQL

| Implementation | Downloads | Best For |
|---------------|-----------|----------|
| **Apollo Server** | 2M+/wk | Features, enterprise, federation |
| **GraphQL Yoga** | 350K+/wk | Performance, tiny bundle, modern |

```bash
# Apollo
npm i @apollo/server graphql
# Yoga (recommended for new projects)
npm i graphql-yoga graphql
```
- Apollo: feature-rich, Federation v2, enterprise
- Yoga: significantly faster, fewer deps, W3C standards
- Best for: complex frontend data needs, aggregating backends

### Multi-Protocol (2026 Trend)
Many teams combine:
- **REST** for public APIs
- **GraphQL** for complex client data needs
- **tRPC** for internal TypeScript tools

---

## 4. Middleware

### Recommended Stack Order
```
1. Security headers     → helmet
2. CORS                 → cors / @fastify/cors
3. Body parsing         → built-in (Express 4.16+, Fastify)
4. Request logging      → morgan (HTTP) + pino/winston (app)
5. Rate limiting        → express-rate-limit / @fastify/rate-limit
6. Input validation     → zod / valibot
7. Error handling       → centralized handler (last)
```

### Validation

| Library | Bundle Size | Speed | Ecosystem | Best For |
|---------|-------------|-------|-----------|----------|
| **Zod** | 15-17 KB | Good | Massive (40M+/wk) | General purpose, ecosystem compat |
| **Valibot** | 1.4 KB | ~2× Zod v3 | Growing | Edge, serverless, bundle-critical |
| **ArkType** | Small | Fastest | Emerging | Performance-critical validation |

```bash
npm i zod        # ecosystem king
npm i valibot    # 90% smaller bundle
```

### Logging

| Library | Downloads | Output | Best For |
|---------|-----------|--------|----------|
| **Pino** | 6M+/wk | JSON (structured) | High-throughput, performance |
| **Winston** | 12M+/wk | Flexible formats | General purpose, multiple transports |
| **Morgan** | 9M+/wk | HTTP request logs | Pair with Pino or Winston for app logs |

```bash
npm i pino pino-pretty   # fast structured logging
npm i winston             # flexible logging
npm i morgan              # HTTP request logging
```

### Security Headers
```bash
npm i helmet              # sets secure HTTP headers
```

### Rate Limiting
```bash
npm i express-rate-limit  # 10M+ weekly downloads
```

---

## 5. Background Jobs

### Decision Matrix

| Tool | Infrastructure | Best For | Pricing |
|------|---------------|----------|---------|
| **BullMQ** | Self-hosted Redis | High volume, full control | Free (+ Redis costs) |
| **Trigger.dev** | Managed | AI workflows, long-running | Free tier, usage-based |
| **Inngest** | Managed (HTTP invoke) | Complex orchestration | Free tier, usage-based |
| **node-cron** | In-process | Simple scheduled tasks | Free |

### BullMQ
```bash
npm i bullmq ioredis
```
- 100K+ jobs/second throughput
- Repeatable jobs (cron expressions)
- Parallel execution, retries, priorities
- Requires Redis infrastructure
- Best for: self-hosted, high volume, full control

### Trigger.dev
```bash
npm i @trigger.dev/sdk
```
- Managed infrastructure — no Redis
- v3: dedicated long-running compute (not serverless)
- No execution timeouts (runs minutes/hours)
- Built-in integrations (OpenAI, Resend, Slack)
- Checkpointing: resume after interruptions
- Best for: startups, AI workflows, no-DevOps teams

### Inngest
```bash
npm i inngest
```
- Step functions for complex orchestration
- Deploys to existing hosting (invokes via HTTP)
- Sleep between steps, TypeScript event types
- Best for: complex workflows, existing hosting

### node-cron
```bash
npm i node-cron
```
- Simple in-process cron scheduling
- No external dependencies
- Best for: simple tasks, development

---

## 6. File Handling

### Upload Strategy Decision

| Strategy | Backend Load | Scalability | Complexity | Best For |
|----------|-------------|-------------|------------|----------|
| **Presigned URLs** | None | Excellent | Medium | Modern apps, large files |
| **Multipart (server)** | Full | Limited | Low | Simple apps, small files |
| **Chunked + Presigned** | Minimal | Excellent | High | Very large files (100MB+) |

### Presigned URL Flow (Recommended)
```
1. Client requests upload URL from backend
2. Backend generates presigned PUT URL (S3/R2)
3. Client uploads directly to storage
4. Backend receives confirmation (webhook or polling)
```

### Upload Libraries

| Library | Downloads | Approach | Best For |
|---------|-----------|----------|----------|
| **Multer** | 4M+/wk | Memory/disk buffer | Express, simple uploads |
| **Busboy** | Via multer | Streaming parser | Large files, performance |
| **Formidable** | — | Progress tracking | Upload progress needs |

```bash
npm i multer @types/multer    # Express middleware
npm i busboy @types/busboy    # Low-level streaming
```

### Storage

| Provider | Egress Fees | S3 Compatible | Best For |
|----------|-------------|---------------|----------|
| **AWS S3** | Yes | Native | AWS ecosystem |
| **Cloudflare R2** | No | Yes | Cost savings, edge |
| **MinIO** | No (self-hosted) | Yes | On-prem, dev |

```bash
npm i @aws-sdk/client-s3 @aws-sdk/s3-request-presigner  # Works with S3 + R2
```

**Note:** R2 presigned URLs support PUT and GET only — no POST/multipart form uploads.

---

## 7. Email

### Service Comparison

| Service | Free Tier | Paid | DX | Best For |
|---------|-----------|------|-----|----------|
| **Resend** | 3K/month | $20/50K | Excellent | Startups, React devs |
| **SendGrid** | 100/day | $20/50K | Good | High volume, marketing |
| **AWS SES** | 62K/month (EC2) | $0.10/1K | Low-level | AWS stack, cost |
| **Nodemailer** | Free (library) | SMTP costs | Simple | Budget, SMTP flexibility |

### Resend (Recommended for Modern Apps)
```bash
npm i resend
```
```typescript
import { Resend } from 'resend';
const resend = new Resend(process.env.RESEND_API_KEY);
await resend.emails.send({
  from: 'hello@example.com',
  to: 'user@example.com',
  subject: 'Welcome',
  html: '<p>Hello!</p>'
});
```

### React Email (Templates)
```bash
npm i react-email @react-email/components
```
- Write email templates in React/JSX
- Tailwind CSS support
- Renders to email-friendly HTML
- Works with any sending service
- Preview/dev server included

### Recommended Stack
**React Email** (templates) + **Resend** (sending) = best modern DX

---

## 8. Starter Kits & Boilerplates

| Kit | Stack | Stars | Best For |
|-----|-------|-------|----------|
| **T3 Stack** | Next.js + tRPC + Prisma + NextAuth + Tailwind | 35K+ | Full-stack TS monorepo |
| **create-express-ts** | Express + TypeScript + ESLint | — | Minimal Express API |
| **Hono starter** | Hono + various runtimes | — | Edge/serverless API |

### Recommended Stacks by Use Case

**Greenfield Full-Stack TS:**
Express/Fastify + tRPC + Prisma + Better Auth + Resend

**High-Performance API:**
Hono/Fastify + Valibot + Arctic + Pino + BullMQ → Fly.io

**Enterprise REST API:**
NestJS/Fastify + Zod + OpenAPI + Passport/WorkOS + Winston + BullMQ → AWS

**Edge/Serverless:**
Hono + Valibot + Arctic + JWT → Cloudflare Workers

**Simple Internal Tool:**
Express + Sessions + node-cron + Resend → Railway/Render

---

## Quick CDN/Install Reference

```bash
# Frameworks
npm i express                          # Classic
npm i fastify                          # Fast JSON APIs
npm i hono                             # Edge-first
npm i @nestjs/core @nestjs/common      # Enterprise

# Auth
npm i better-auth                      # Modern sessions
npm i arctic                           # OAuth 2.0
npm i @simplewebauthn/server           # Passkeys

# Validation
npm i zod                              # Schema validation
npm i valibot                          # Tiny validation

# Database (see database-craft)
npm i prisma @prisma/client            # Type-safe ORM
npm i drizzle-orm                      # SQL-like ORM

# Jobs
npm i bullmq ioredis                   # Job queue
npm i @trigger.dev/sdk                 # Managed jobs

# Email
npm i resend                           # Email API
npm i react-email @react-email/components  # Templates

# Storage
npm i @aws-sdk/client-s3 @aws-sdk/s3-request-presigner

# Middleware
npm i helmet cors morgan pino express-rate-limit

# Logging
npm i pino pino-pretty                 # Fast structured
npm i winston                          # Flexible
```

---

## Sources

- [Encore — Best TypeScript Backend Frameworks 2026](https://encore.dev/articles/best-typescript-backend-frameworks)
- [Fastify](https://fastify.dev/) · [Hono](https://hono.dev/) · [NestJS](https://nestjs.com/) · [tRPC](https://trpc.io/)
- [WorkOS — Top Auth Solutions for Node.js 2026](https://workos.com/blog/top-authentication-solutions-node-js-2026)
- [Arctic v3](https://arcticjs.dev/) · [SimpleWebAuthn](https://simplewebauthn.dev/)
- [BullMQ](https://bullmq.io/) · [Trigger.dev](https://trigger.dev/) · [Inngest](https://www.inngest.com/)
- [Resend](https://resend.com/) · [React Email](https://react.email/)
- [Create T3 App](https://create.t3.gg/)
- [Zod](https://zod.dev/) · [Valibot](https://valibot.dev/)
