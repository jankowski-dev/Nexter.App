# Phase 1 — Foundation Report

Date: 2026-11-03

## Scope completed

- pnpm workspace with `apps/*` and `packages/*`.
- TypeScript strict configuration.
- ESLint 9 flat config + Prettier.
- Vitest test setup.
- PostgreSQL 17 Docker Compose service.
- Drizzle ORM schema, client, migration runner, initial migration.
- Initial tables: `users`, `sessions`, `audit_log`, `settings`.
- NestJS 11 + Fastify API bootstrap.
- Env validation with Zod.
- Structured logging with pino / nestjs-pino and redaction.
- Sentry initialization hooks (API and worker).
- Health and readiness endpoints.
- Standard exception filter.
- Helmet, compression, cookies.
- Swagger/OpenAPI in non-production.
- React 19 + Vite + TanStack Router/Query + Tailwind CSS.
- Dark Russian dashboard shell with placeholder sections.
- Worker bootstrap with pg-boss 12 (ESM).
- Multi-stage Dockerfile with API and worker build targets.
- `railway.json` for the API service.
- GitHub Actions CI.
- AGENTS.md, README, decision log, ADRs.

## Verification

Commands run locally:

```bash
npx pnpm@10.20.0 install
npx pnpm@10.20.0 lint
npx pnpm@10.20.0 typecheck
npx pnpm@10.20.0 test
npx pnpm@10.20.0 build
```

Results:

- lint: pass
- typecheck: pass
- tests: 9 tests pass (contracts 4, web 2, api 3)
- build: pass
- API runtime `/health`: 200
- API runtime `/ready` without DB: 503 with structured error
- Web dev server: rendered successfully
- Production SPA served by Nest with `WEB_DIST_PATH`: 200
- Static assets: 200
- Migration SQL executed successfully in PGlite (tables, columns, indexes created)

## Known limitations

- Docker is not installed in the local environment, so the Dockerfile was not built locally.
- A real PostgreSQL instance was not available; the migration was validated with PGlite.
- `@fastify/static` 9.3.0 is used because `@nestjs/serve-static` 5.x requires 8.x/9.x, while `@nestjs/platform-fastify` 11.2.8 declares 10.x as a peer. Runtime is verified; the peer warning is cosmetic.
- Framework-generated 404 responses do not use the custom error envelope yet. This will be normalized in a later phase.
- Shared contracts are currently consumed by the API; the web app uses a small local contract to avoid CJS/ESM interop friction. A dual-format shared package will be introduced when the OpenAPI client is generated.
- No database connection was tested against real Postgres, only schema validation.
- Swagger is enabled in non-production only.

## How to run

```bash
cp .env.example .env
docker compose up -d postgres
npx pnpm@10.20.0 install
npx pnpm@10.20.0 db:generate
npx pnpm@10.20.0 db:migrate
npx pnpm@10.20.0 dev
```

Open:

- web: http://localhost:5173
- health: http://localhost:3000/health
- ready: http://localhost:3000/ready
- docs: http://localhost:3000/api/docs

## Next phase

Phase 2 — Auth and security:

- setup token and owner creation
- login
- TOTP 2FA
- recovery codes
- session management
- CSRF
- rate limits and lockout
- security headers review
- audit log integration
- auth UI
