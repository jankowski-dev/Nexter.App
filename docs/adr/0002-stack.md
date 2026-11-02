# ADR 0002 — Foundation stack

## Status

Accepted.

## Decision

- Node.js 22+ locally; Node 24 in Docker.
- pnpm workspaces.
- NestJS 12 with Fastify adapter.
- React 19 + Vite + TanStack Router/Query.
- PostgreSQL 17 + Drizzle ORM.
- pg-boss for background jobs.
- Zod for validation and shared contracts.
- Tailwind CSS + shadcn-style components.
- Vitest, Playwright, Testcontainers, fast-check, Anvil.
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
