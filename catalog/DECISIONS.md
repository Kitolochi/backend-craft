# Backend Decision Frameworks

Opinionated guides for common backend choices. Each section gives a default, explains when to deviate, and provides a comparison table.

---

## API Protocol: REST vs GraphQL vs tRPC vs gRPC

**Default choice:** REST with OpenAPI — universally understood, tooling everywhere, cacheable.

**Choose REST when:** You're building public APIs, need HTTP caching, have diverse clients (mobile, web, third-party), or your team isn't all TypeScript.

**Choose GraphQL when:** Your frontend needs flexible queries across deeply nested data, you have multiple client apps with different data needs, or you're aggregating multiple backend services into one graph.

**Choose tRPC when:** Both client and server are TypeScript, you want end-to-end type safety without code generation, and you're building a monorepo with shared types.

**Choose gRPC when:** You need high-performance service-to-service communication, streaming (bidirectional), or polyglot microservices with strict contracts.

| Factor | REST | GraphQL | tRPC | gRPC |
|--------|------|---------|------|------|
| Type safety | OpenAPI codegen | Codegen (GraphQL Code Generator) | Native (zero codegen) | Protobuf codegen |
| Caching | HTTP native | Complex (normalized) | None built-in | None built-in |
| Overfetching | Common | Solved | Solved | N/A (RPC) |
| Learning curve | Low | Medium | Low (if TS) | Medium |
| File uploads | Multipart | Complex | Multipart | Streaming |
| Real-time | SSE/WebSocket | Subscriptions | Subscriptions | Bidirectional streaming |
| Browser support | Native | Native | Native | grpc-web (proxy) |
| Public API friendly | Yes | Yes | No (TS-only) | No (tooling barrier) |

**Our pick:** REST for public APIs. tRPC for internal TypeScript full-stack apps. GraphQL for BFF (Backend for Frontend) aggregation.

---

## Auth: better-auth vs Roll-Your-Own vs OAuth Providers

**Default choice:** better-auth — TypeScript-native, extensible plugin system, handles the hard parts.

**Choose better-auth when:** You want self-hosted auth with modern features (passkeys, magic links, 2FA), TypeScript-first DX, and don't want to maintain auth infrastructure yourself.

**Choose roll-your-own when:** You have very specific auth requirements that no library supports, you're building a learning project, or you need absolute control over every auth flow.

**Choose OAuth providers (Auth0, Clerk, Supabase Auth) when:** You want zero auth code, need enterprise SSO (SAML), or your team doesn't have security expertise to handle auth correctly.

| Factor | better-auth | Roll-your-own | Auth0 | Clerk |
|--------|-------------|---------------|-------|-------|
| Self-hosted | Yes | Yes | No | No |
| Passkey support | Plugin | You build it | Add-on | Built-in |
| Social login | Plugin | You build it | Built-in | Built-in |
| Cost | Free | Free | Free tier + $$ | Free tier + $$ |
| TypeScript DX | Excellent | You define it | Good | Excellent |
| Enterprise SSO | Plugin | Complex | Built-in | Built-in |
| Vendor lock-in | None | None | Medium | Medium |
| Security burden | Low (maintained) | High (on you) | None | None |

**Our pick:** better-auth for self-hosted TypeScript apps. Clerk for rapid prototyping where auth UI is needed. Auth0 for enterprise with SAML requirements.

---

## Framework: Express vs Hono vs Fastify

**Default choice:** Hono — ultrafast, TypeScript-first, works everywhere (Node, Deno, Bun, Cloudflare Workers, Lambda).

**Choose Express when:** You need the largest middleware ecosystem, your team already knows it, or you're maintaining an existing Express app.

**Choose Hono when:** You want modern TypeScript DX, need to run on edge/serverless, or want the fastest framework with built-in middleware (CORS, auth, validation).

**Choose Fastify when:** You need a full-featured Node.js framework with JSON Schema validation, plugin architecture, and the best Node.js performance.

| Factor | Express | Hono | Fastify |
|--------|---------|------|---------|
| Performance (req/s) | ~15K | ~60K+ | ~45K |
| TypeScript | Needs @types | Native | Native |
| Runtime support | Node | Node, Deno, Bun, Edge | Node |
| Bundle size | ~200KB | ~14KB | ~300KB |
| Middleware ecosystem | Largest | Growing | Large |
| Validation | Third-party (Zod) | Built-in (Zod/Valibot) | JSON Schema (built-in) |
| OpenAPI | swagger-jsdoc | Built-in (@hono/zod-openapi) | @fastify/swagger |
| Learning curve | Low | Low | Medium |

**Our pick:** Hono for new projects. Express if you need a specific middleware that doesn't exist elsewhere. Fastify for Node-only apps that need schema validation.

---

## Background Jobs: BullMQ vs Trigger.dev vs Inngest

**Default choice:** BullMQ — battle-tested, Redis-backed, full control over workers.

**Choose BullMQ when:** You already run Redis, need fine-grained control over job processing (priorities, rate limiting, retries), or want to self-host everything.

**Choose Trigger.dev when:** You want serverless background jobs with a great dashboard, cron scheduling, and don't want to manage Redis/workers infrastructure.

**Choose Inngest when:** You're building event-driven workflows, need step functions (multi-step jobs with automatic retries per step), or want fan-out/fan-in patterns.

| Factor | BullMQ | Trigger.dev | Inngest |
|--------|--------|-------------|---------|
| Infrastructure | Redis (self-managed) | Managed cloud | Managed cloud |
| Pricing | Free (+ Redis cost) | Free tier + usage | Free tier + usage |
| Dashboard | Bull Board (self-host) | Built-in (excellent) | Built-in |
| Cron jobs | Yes | Yes | Yes |
| Multi-step workflows | Manual | Yes | Yes (step functions) |
| Rate limiting | Built-in | Built-in | Built-in |
| Retries | Configurable | Configurable | Per-step |
| Self-hostable | Yes | Yes (OSS) | Yes (OSS) |
| TypeScript DX | Good | Excellent | Excellent |

**Our pick:** BullMQ for self-hosted, high-volume job processing. Trigger.dev for teams that want great DX without managing infrastructure. Inngest for complex event-driven workflows.
