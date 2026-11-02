# Nexter

Private, single-user, modular personal finance application.

Current phase: **Phase 1 — Foundation**.

The implementation contract is in [`docs/mega-prompt.md`](docs/mega-prompt.md).

## Stack

- Node.js 22+ (Docker image uses Node 24)
- pnpm workspaces
- NestJS 12 + Fastify
- PostgreSQL 17 + Drizzle ORM
- pg-boss
- React 19 + Vite + TanStack Router/Query
- Tailwind CSS + shadcn-style components
- Vitest, Playwright, Testcontainers, fast-check, Anvil
- Railway + Cloudflare + R2

## Repository

```text
apps/api       NestJS API, serves the built SPA in production
apps/web       React SPA
apps/worker    background jobs
packages/db    Drizzle schema, migrations, client
packages/contracts shared Zod schemas and API types
packages/ui    shared UI utilities
docs           specs, ADRs, runbooks
```

## Local setup

1. Copy environment file:

   ```bash
   cp .env.example .env
   ```

2. Start Postgres:

   ```bash
   docker compose up -d postgres
   ```

3. Install dependencies:

   ```bash
   npx pnpm@10.20.0 install
   ```

4. Generate and apply the initial migration:

   ```bash
   npx pnpm@10.20.0 db:generate
   npx pnpm@10.20.0 db:migrate
   ```

5. Start development:

   ```bash
   npx pnpm@10.20.0 dev
   ```

6. Open:

   - Web: http://localhost:5173
   - API health: http://localhost:3000/health
   - API readiness: http://localhost:3000/ready
   - OpenAPI docs (non-production): http://localhost:3000/api/docs

## Workspace commands

```bash
npx pnpm@10.20.0 build
npx pnpm@10.20.0 typecheck
npx pnpm@10.20.0 lint
npx pnpm@10.20.0 test
npx pnpm@10.20.0 format
```

## Phase status

- [x] Phase 0 — Design
- [ ] Phase 1 — Foundation
- [ ] Phase 2 — Auth and security
- [ ] Phase 3 — Accounting core
- [ ] Phase 4 — Notion import
- [ ] Phase 5 — MVP-1 UI
- [ ] Phase 6 — MVP-1 hardening
- [ ] Phase 7 — Swap foundation
- [ ] Phase 8 — Swap execution (BSC)
- [ ] Phase 9 — Ethereum
- [ ] Phase 10 — On-chain reconciliation
- [ ] Phase 11 — Other modules

## Security notes

- No private keys or seed phrases on the server.
- No public signup.
- No wallet connection in MVP-1.
- No swap execution in MVP-1.
- All mutations must be audited.
- Secrets live in environment variables only.
