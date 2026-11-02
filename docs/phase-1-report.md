# Phase 1 — Foundation Report

Date: 2026-11-03

Status: **in review**

## Scope completed

- pnpm workspace with `apps/*` and `packages/*`.
- TypeScript strict configuration.
- ESLint 9 flat config + Prettier.
- Vitest test setup.
- PostgreSQL 17 Docker Compose service.
- Drizzle ORM schema, client, migration runner, initial migrations.
- Tables: `users`, `sessions`, `audit_log`, `settings`.
- Phase 2 auth fields: `users.totp_enabled`, `sessions.last_seen_at`.
- NestJS 11 + Fastify API.
- Shared root `.env` loader (`@nexter/config`) for API, worker, and migrations.
- Empty-value normalization for `.env` placeholders.
- Env validation with Zod and production/staging requirements.
- Structured logging with pino / nestjs-pino, safe request serializer, redaction.
- Sentry initialization with shared `beforeSend`/`beforeBreadcrumb` scrubbing in API and worker.
- Health and readiness endpoints.
- Standard exception filter with status-to-code mapping.
- API 404 envelope.
- Helmet, cookies, CSP frame-ancestors `none`, Permissions-Policy.
- Swagger/OpenAPI in non-production.
- React 19 + Vite + TanStack Router/Query + Tailwind.
- shadcn-compatible Button/Card primitives.
- `/dashboard` route with `/` redirect, Russian UI, skip link, ARIA labels.
- Worker bootstrap with pg-boss 12 (ESM).
- Multi-stage Dockerfile with API and worker entrypoints, non-root runtime.
- `railway.json` for the API service and worker runbook.
- GitHub Actions CI with PostgreSQL 17, migration, compiled migration runner, static/API smoke, Docker build/API run/worker run, secret scan, and audit.
- AGENTS.md, README, decision log, ADRs, specs, runbooks.

## Verification

Commands run locally:

```bash
npx pnpm@10.20.0 install --frozen-lockfile
npx pnpm@10.20.0 format:check
npx pnpm@10.20.0 lint
npx pnpm@10.20.0 typecheck
npx pnpm@10.20.0 test
npx pnpm@10.20.0 build
npx pnpm@10.20.0 smoke:static
npx pnpm@10.20.0 smoke:worker
npx pnpm@10.20.0 audit --prod
```

Results:

- format: pass
- lint: pass
- typecheck: pass
- tests: 21 tests pass (contracts 6, db 1, web 2, api 10, worker 2)
- build: pass
- static/API smoke: pass
- SPA root and deep links (GET and HEAD): 200
- gzip static asset: full body, no truncation
- API 404: `NOT_FOUND` envelope
- security headers: `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`, CSP `frame-ancestors 'none'`
- Fastify runtime: 5.12.8 (patched)
- `@fastify/static`: 10.1.8
- audit: 0 vulnerabilities
- migration SQL: executes in PGlite; both migrations produce 4 tables, 35+ columns, indexes
- worker syntax: pass
- root `.env` loading: API and worker read the repository-root `.env` from package cwd
- `.env.example` copy: API and worker start in development with empty placeholder values
- production env: API requires `DATABASE_URL`, `SETUP_TOKEN`, and `APP_URL`
- clean checkout: install, format, lint, typecheck, test, build, smoke all pass

## Independent review history

### First review — FAIL

Critical/High findings included static asset truncation, clean-checkout CI failure, `pgcrypto` migration failure, SPA deep-link 404s, vulnerable Fastify, pino secret logging, missing Sentry scrubbing, missing Phase 0 artifacts, and 404 envelope gaps.

### Second review — FAIL

No Critical findings. Two High findings remained:

1. Empty `.env.example` values crashed the API/worker because Zod `.min(1)` rejected empty strings.
2. `pnpm dev` ran packages with their own cwd and ignored the root `.env`, while migrations used it.

Medium findings included missing `Permissions-Policy`, incomplete worker Sentry scrubbing, optional production `SETUP_TOKEN`/`APP_URL`, missing `sessions.last_seen_at`, CI gaps for Docker/worker/secret scan, and three moderate audit findings.

### Fixes applied after second review

- Added `@nexter/config` with a repository-root `.env` loader shared by API, worker, and migrations.
- Preprocess empty env values to `undefined`; added env tests for empty, development, and production cases.
- Added manual `Permissions-Policy` header via a Fastify `onSend` hook; CSP now uses `frame-ancestors 'none'`.
- Extended the shared Sentry scrubber to exception messages, tags, contexts, breadcrumbs, and string values; worker now registers both `beforeSend` and `beforeBreadcrumb`.
- Added `users.totp_enabled` and `sessions.last_seen_at` migration `0001`; updated ADR 0004.
- Required `SETUP_TOKEN` and `APP_URL` in production/staging; added `TRUST_PROXY` configuration.
- Added Docker build/API/worker CI gates, secret scan, compiled migration runner, and `db:migrate:prod`.
- Added overrides for `glob`, `js-yaml`, and `minimatch`; production audit is now clean.
- Added HEAD deep-link handling, Button `type="button"` default, and docs corrections.

A third independent review is required before Phase 1 is accepted.

## Known limitations

- Docker is not installed in the local environment; Docker build and container runtime are exercised in CI, not locally.
- A real PostgreSQL 17 instance is not available locally; the migration is exercised against PostgreSQL 17 in CI and validated in PGlite locally.
- The worker is exercised by a Docker runtime check in CI; there is no separate long-running integration test.
- Production dependency pruning in the Docker image is still a Phase 6 hardening item.
- `trustProxy` defaults to `false`; set it to the exact Railway/Cloudflare proxy CIDR before enabling IP-based rate limits.
- No Railway staging deployment has been observed yet; the deployment runbook is written.
- BYN and tax reporting are deferred.
- Accounting, import, and swap features are not part of Phase 1.

## How to run

```bash
cp .env.example .env
# set DATABASE_URL in .env; SETUP_TOKEN and APP_URL are required only in production/staging
docker compose up -d postgres
npx pnpm@10.20.0 install
npx pnpm@10.20.0 db:generate
npx pnpm@10.20.0 db:migrate
npx pnpm@10.20.0 dev
```

Open:

- web: http://localhost:5173/dashboard
- health: http://localhost:3000/health
- ready: http://localhost:3000/ready
- docs: http://localhost:3000/api/docs

## Next phase

Phase 2 — Auth and security, only after Phase 1 passes independent re-review.
