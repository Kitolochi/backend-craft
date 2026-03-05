# Backend Craft

A collection of backend patterns, API templates, auth flows, and middleware recipes for Node.js + TypeScript. Self-contained, copy-paste ready examples.

## Structure

```
catalog/            Reference docs and pattern checklists
examples/
  api-patterns/     REST, GraphQL, tRPC, OpenAPI templates
  auth/             JWT, sessions, OAuth, passkeys, magic link
  middleware/       Validation, logging, error handling, security
  jobs/             BullMQ, Trigger.dev, Inngest, cron
  file-handling/    Uploads, presigned URLs, S3/R2
  email/            Resend, React Email templates, queues
```

## Catalog

- **BACKEND_TOOLKIT.md** — Frameworks, auth libraries, middleware, jobs, storage, email with decision matrices
- **PATTERN_CATALOG.md** — 50+ backend patterns organized by category with build status

## Tech

- Node.js + TypeScript
- Express / Fastify / Hono frameworks
- Zod / Valibot validation
- Working examples with inline comments
- Each example is self-contained with its own package.json
