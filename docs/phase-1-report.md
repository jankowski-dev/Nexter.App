# Phase 1 — Foundation Report

Date: 2026-11-03

Status: **in review**

## Scope completed

- pnpm workspace with `apps/*` and `packages/*`.
- TypeScript strict configuration.
- ESLint 9 flat config + Prettier.
- Vitest test setup.
- PostgreSQL 17 Docker Compose service.
- Drizzle ORM schema, client, migration runner, initial migration.
- Initial tables: `users`, `sessions`, `audit_log`, `settings`.
- NestJS 11 + Fastify API.
- Env validation with Zod.
- Structured logging with pino / nestjs-pino, safe request serializer, redaction.
- Sentry initialization with request/extra scrubbing.
- Health and readiness endpoints.
- Standard exception filter with status-to-code mapping.
- API 404 envelope.
- Helmet, cookies, security headers.
- Swagger/OpenAPI in non-production.
- React 19 + Vite + TanStack Router/Query + Tailwind.
- shadcn-compatible Button/Card primitives.
- `/dashboard` route with `/` redirect, Russian UI, skip link, ARIA labels.
- Worker bootstrap with pg-boss 12 (ESM).
- Multi-stage Dockerfile with API and worker entrypoints.
- `railway.json` for the API service and worker runbook.
- GitHub Actions CI with PostgreSQL 17, migration, static smoke test, audit.
- AGENTS.md, README, decision log, ADRs, specs, runbooks.

## Verification

Commands run locally:

```bash
npx pnpm@10.20.0 install
npx pnpm@10.20.0 format:check
npx pnpm@10.20.0 lint
npx pnpm@10.20.0 typecheck
npx pnpm@10.20.0 test
npx pnpm@10.20.0 build
npx pnpm@10.20.0 smoke:static
npx pnpm@10.20.0 smoke:worker
npx pnpm@10.20.0 audit --prod --audit-level=high
```

Results:

- format: pass
- lint: pass
- typecheck: pass
- tests: 13 tests pass (contracts 4, db 1, web 2, api 6)
- build: pass
- static/API smoke: pass
- SPA root and deep links: 200
- gzip static asset: full body, no truncation
- API 404: `NOT_FOUND` envelope
- security headers: `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`
- Fastify runtime: 5.12.8 (patched)
- audit: 0 high, 3 moderate (production dependencies)
- migration SQL: executes in PGlite (no `pgcrypto` dependency); 4 tables, 35 columns, indexes
- worker syntax: pass (`node --check`)

## Independent review

An independent reviewer subagent reviewed the first version of Phase 1 and returned **FAIL**.

Critical findings that were fixed:

1. Compressed static assets had an incorrect `Content-Length` and were truncated.
   - Application compression was removed; edge compression is delegated to Cloudflare/Railway.
   - Added a gzip static smoke test.
2. A clean checkout could not pass `typecheck`/`test` because workspace `dist` artifacts were missing.
   - Root `typecheck` and `test` now build workspace packages first.
3. The initial migration required `pgcrypto`, which is unavailable in some environments.
   - Removed the extension; `gen_random_uuid()` is built into PostgreSQL 13+.
4. SPA deep links returned 404.
   - Added an `onRequest` SPA fallback that rewrites non-API GET routes to `index.html`.
5. Fastify 5.11.3 had high-severity advisories.
   - Overrode Fastify to 5.12.8; verified runtime version.
6. `@fastify/static` 9.x was outside the adapter peer range.
   - Switched to `@fastify/static` 10.1.8 and a direct SPA handler.
7. Pino logged `x-api-key`.
   - Added a safe request serializer that logs only id, method, path, IP, user agent.
8. Sentry had no scrubbing.
   - Added `beforeSend`/`beforeBreadcrumb` scrubbing for API and worker.
9. Missing Phase 0 artifacts and schema ADR.
   - Added `docs/specs/*` and `docs/adr/0004-initial-schema.md`.
10. API 404 bypassed the error envelope and headers.
    - Added `ApiNotFoundController` and status-to-code mapping.

A second independent review is required before Phase 1 is accepted.

## Known limitations

- Docker is not installed in the local environment, so the Dockerfile was not built locally.
- A real PostgreSQL 17 instance was not available locally; the migration was validated with PGlite and is exercised against PostgreSQL 17 in CI.
- The worker has a syntax check and manual startup probe, but no automated integration test yet.
- Runtime production dependencies are not pruned in the Docker image yet; this is a Phase 6 hardening item.
- `trustProxy` is `false`; set it to the exact Railway/Cloudflare proxy configuration before enabling IP-based rate limits.
- No Railway staging deployment has been observed yet; the deployment runbook is written.
- BYN and tax reporting are deferred.
- Accounting, import, and swap features are not part of Phase 1.

## How to run

```bash
cp .env.example .env
# set DATABASE_URL in .env
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
