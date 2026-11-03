# Nexter

Private, single-user, modular personal finance application.

Current phase: **Phase 3 — Accounting core**. Phase 2 auth/security is accepted.

The implementation contract is in [`docs/mega-prompt.md`](docs/mega-prompt.md).

## Stack

- Node.js 24 LTS in Docker and CI; Node.js 22.12+ is supported locally
- pnpm workspaces
- NestJS 11 + Fastify
- PostgreSQL 17 + Drizzle ORM
- pg-boss
- React 19 + Vite + TanStack Router/Query
- Tailwind CSS + shadcn-compatible primitives
- Vitest + Supertest + Playwright; Testcontainers, fast-check, and Anvil planned
- Railway + Cloudflare + R2

## Repository

```text
apps/api       NestJS API, serves the built SPA in production
apps/web       React SPA
apps/worker    background jobs
packages/db    Drizzle schema, migrations, client
packages/contracts shared Zod schemas and API types
packages/config shared root env loader
packages/ui    shared UI utilities
docs           specs, ADRs, runbooks
```

## Local setup

1. Copy environment file and set `DATABASE_URL`:

   ```bash
   cp .env.example .env
   ```

   ```dotenv
   DATABASE_URL=postgres://postgres:postgres@localhost:5432/nexter
   ```

   Generate local auth secrets:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   # use as SETUP_TOKEN
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   # use as AUTH_ENCRYPTION_KEY
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
npx pnpm@10.20.0 smoke:static
npx pnpm@10.20.0 smoke:worker
```

Browser auth E2E and API auth integration tests **truncate auth tables**. Never point them at a database that contains real Nexter data. Create a disposable database (for example `nexter_test`) and set `NEXTER_TEST_DB=1`; without this flag the destructive suites are skipped.

```bash
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/nexter_test
export SETUP_TOKEN=test-setup-token
export AUTH_ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
export NEXTER_TEST_DB=1

npx pnpm@10.20.0 db:migrate
npx pnpm@10.20.0 test
npx pnpm@10.20.0 --filter @nexter/e2e exec playwright install chromium
npx pnpm@10.20.0 test:e2e
```

## Documentation

- [`docs/mega-prompt.md`](docs/mega-prompt.md) — implementation contract
- [`docs/specs/`](docs/specs) — product, threat model, accounting, API/UX, KyberSwap
- [`docs/adr/`](docs/adr) — architecture decisions
- [`docs/runbooks/`](docs/runbooks) — Railway, restore, and auth break-glass procedures
- [`docs/phase-1-report.md`](docs/phase-1-report.md) — Phase 1 verification report
- [`docs/phase-2-report.md`](docs/phase-2-report.md) — Phase 2 verification report
- [`docs/phase-3-report.md`](docs/phase-3-report.md) — Phase 3 verification report

## Phase status

- [x] Phase 0 — Design
- [x] Phase 1 — Foundation (accepted with operational follow-ups)
- [x] Phase 2 — Auth and security (accepted)
- [ ] Phase 3 — Accounting core (in review)
- [ ] Phase 4 — Notion import
- [ ] Phase 5 — MVP-1 UI
- [ ] Phase 6 — MVP-1 hardening
- [ ] Phase 7 — Swap foundation
- [ ] Phase 8 — Swap execution (BSC)
- [ ] Phase 9 — Ethereum
- [ ] Phase 10 — On-chain reconciliation
- [ ] Phase 11 — Other modules

## Production environment

Production and staging require `DATABASE_URL`, `SETUP_TOKEN`, `AUTH_ENCRYPTION_KEY`, and `APP_URL`. `AUTH_ENCRYPTION_KEY` must be a 32-byte base64 or 64-char hex key. Set `TRUST_PROXY` to the exact Railway/Cloudflare proxy CIDR (default `false`). See `docs/runbooks/railway.md`.

## Security notes

- No private keys or seed phrases on the server.
- No public signup.
- No wallet connection in MVP-1.
- No swap execution in MVP-1.
- All mutations must be audited.
- Secrets live in environment variables only.
