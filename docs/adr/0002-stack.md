# ADR 0002 — Foundation stack

## Status

Accepted.

## Decision

- Node.js 24 LTS in Docker and CI; Node.js 22.12+ is supported locally.
- pnpm workspaces.
- NestJS 11 with Fastify adapter.
- React 19 + Vite + TanStack Router/Query.
- PostgreSQL 17 + Drizzle ORM.
- pg-boss for background jobs.
- Zod for validation and shared contracts (dual CJS/ESM package).
- Tailwind CSS + shadcn-compatible primitives.
- Vitest now; Playwright, Testcontainers, fast-check, and Anvil are planned for later phases.
- Railway for app/worker/Postgres; Cloudflare for edge; R2 for backups.

## Rationale

- The app is a private dashboard; SSR is not required.
- Wallet libraries are client-side React.
- NestJS modules map well to the modular product.
- Same-origin SPA + API simplifies cookies and CSRF.
- Drizzle gives SQL control for financial queries.
- pg-boss avoids an extra Redis service at this scale.

## Consequences

- More boilerplate than a full-stack framework.
- OpenAPI-generated client is required to keep frontend/backend contracts aligned.
- Financial logic must be framework-agnostic and heavily tested.
