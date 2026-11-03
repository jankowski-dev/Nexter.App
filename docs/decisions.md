# Decision Log

Format: date — decision — reason.

## 2026-11-02

- **Single-user application.** One owner, closed registration, `user_id` in future tables. Simpler auth and data model.
- **USD as base accounting currency.** BYN is deferred and will be a reporting/display currency.
- **Non-custodial swaps only.** Private keys stay in Tangem; the server never signs.
- **BSC first, Ethereum second.** Lower fees and faster iteration on BSC.
- **Modular monolith.** NestJS + React SPA + Postgres + worker; no microservices.
- **Postgres + Drizzle.** SQL control, typed schema, forward-only migrations.
- **pg-boss instead of Redis.** Fewer services, transactional jobs on Postgres.
- **Ledger + postings + FIFO lots.** Required for auditable accounting, transfers, fees, and partial exits.
- **FIFO is global per asset for MVP.** Simpler than per-account lots; can be extended later.
- **Stablecoins are cash equivalents.** No FIFO lots for USDT/USDC; depeg flag stays.
- **Gas is added to cost basis by default.** Configurable in settings; never double-count execution cost.
- **Notion is the historical source for MVP-1.** On-chain reconciliation is deferred to MVP-3.
- **No wallet access in MVP-1.** The owner explicitly deferred wallet connection.
- **Step-up TOTP threshold $500.** Extra protection for larger swaps; configurable.
- **Cloudflare Access optional.** App auth remains mandatory.
- **RPO 1 hour / RTO 4 hours.** PITR + encrypted dumps to R2.
- **Sentry SaaS with scrubbing.** No PII or wallet addresses in events.

## 2026-11-03

- **NestJS 11, not 12.** NestJS 12 is ESM-first and adds friction for the CJS-oriented Nest toolchain. NestJS 11 is stable and matches the implementation contract.
- **TypeScript 5.9.** Required by the NestJS 11 toolchain; strict mode remains enabled.
- **Worker is ESM.** pg-boss 12 is ESM-only. The worker package uses `"type": "module"` and NodeNext resolution.
- **SPA served by Nest via `@fastify/static` 10.1.8 and an explicit SPA fallback.** `@nestjs/serve-static` was removed because its peer range conflicted with the Fastify adapter; deep links are rewritten to `index.html` with an `onRequest` hook.
- **Fastify pinned to 5.12.8 via pnpm override.** The NestJS adapter’s transitive Fastify version had high-severity advisories; the runtime version is verified in the smoke test.
- **Shared contracts are dual CJS/ESM.** `@nexter/contracts` is built with tsup and consumed by both API and web, including runtime response validation.
- **Typecheck and test build workspace packages first.** A clean checkout must not depend on gitignored `dist/` artifacts.
- **Migration validated with PGlite.** Docker/Postgres was unavailable locally; the SQL schema was executed in an in-memory Postgres-compatible engine without `pgcrypto`.
- **Shared root env loader.** `@nexter/config` finds the repository root and loads `.env` for API, worker, and migrations, regardless of package cwd.
- **Empty env placeholders are normalized.** `DATABASE_URL=`, `SETUP_TOKEN=`, and `APP_URL=` are treated as unset; development falls back to localhost, production/staging fails fast.
- **Permissions-Policy is set manually.** Helmet 8 does not implement the option; a Fastify `onSend` hook sets `camera=(), microphone=(), geolocation=()`. CSP uses `frame-ancestors 'none'`.
- **Sentry scrubbing lives in shared contracts.** API and worker both scrub request, exception, tags, contexts, breadcrumbs, and secret-looking strings.
- **Phase 2 auth fields are in migration 0001.** `users.totp_enabled` and `sessions.last_seen_at` are added now to avoid a Phase 2 schema surprise.
- **Production audit is clean.** `glob`, `js-yaml`, and `minimatch` are overridden to patched versions; `pnpm audit --prod` reports no vulnerabilities.
- **CI exercises the container and worker.** Docker build, API container `/ready`/SPA, worker startup, compiled migration runner, secret scan, and audit are CI gates.
- **Migrations use the shared root env loader.** `@nexter/config` is used by API, worker, and database scripts; `db:generate`/`db:migrate` build it first.
- **Secret scan is pinned and redacted.** gitleaks `v8.28.0`, `dir` mode, `--redact`, and path allowlists for generated/dependency directories.
- **PostgreSQL readiness is tested in CI.** The API e2e suite runs a DB-backed `/ready` test when `DATABASE_URL` is set and skips it locally.
- **Sentry scrubbing includes user context and arrays.** `event.user` is removed and nested arrays are recursively scrubbed.
- **Phase 1 accepted with operational follow-ups.** Independent review round 4 returned PASS WITH CHANGES: no Critical/High findings. Remaining work is Railway staging, actual proxy CIDRs, real CI/Docker execution, broader DB auth tests, and version/digest hardening.
