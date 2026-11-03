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
- **Custom auth module instead of a framework.** Argon2id, TOTP, recovery codes, server-side sessions, and explicit guards keep the security model auditable and avoid a large auth dependency.
- **CSRF uses a double-submit cookie plus a session hash.** The SPA reads `nexter_csrf`; the API requires `X-CSRF-Token`, compares it to the cookie, and verifies its hash against the session.
- **TOTP secrets are encrypted with AES-256-GCM.** `AUTH_ENCRYPTION_KEY` is a 32-byte base64/hex secret and is required in production/staging.
- **Recovery codes are one-time and hashed.** Password reset consumes a code, revokes all sessions, and issues ten new codes.
- **Auth rate limits are database-backed.** `rate_limits` provides per-IP/per-user lockout without adding Redis.
- **Pending-2FA sessions are isolated by a global guard.** Only explicitly allowed auth endpoints can be used before TOTP verification.
- **No email is sent.** Setup, login, TOTP, recovery, and password reset are fully self-hosted.
- **TOTP lockout is per-user and enforced before verification.** The counter is keyed `2fa:<user_id>`, checked before decrypting a code, and not reset by a password-only login. A valid code cannot bypass an active block.
- **First-run setup is single-owner at the database level.** `users_singleton_unique` plus an advisory-lock transaction prevents two owners under concurrency; the loser receives `409`.
- **Password change rotates the current session.** The old session and all other sessions are revoked, and a new verified session is issued. This resolves the contract/spec conflict in favor of rotation.
- **Recovery-code consumption is atomic.** Verification and reset use row locks, so a code cannot be consumed twice under concurrency.
- **Credential/session mutations and their audit rows share a transaction.** If the audit insert fails, the mutation rolls back; failed attempts remain best-effort audit writes.
- **Session TTL is absolute 30 days.** Sliding renewal is deferred; see ADR 0005. Activity updates `last_seen_at`, not `expires_at`.
- **`AUTH_ENCRYPTION_KEY` is validated at startup and before setup.** A malformed key cannot create an owner that then cannot complete TOTP setup.
- **Login throttling is per IP+email pair and per IP.** Unknown emails still pay an Argon2 dummy verification; login counters reset only after 2FA or a password reset/change. A global per-email lockout is intentionally avoided.
- **Break-glass recovery is an offline runbook.** The setup token is not a recovery path; see `docs/runbooks/auth-recovery.md`.
- **Phase 2 review fixes are covered by tests.** API auth e2e now covers setup races, lockout, recovery/reset, session revocation, CSRF, audit, and password-change rotation; Playwright covers the browser auth flow.
- **Login session creation and audit are transactional.** A failed audit write rolls back the login session; this closes the last rule-6 gap.
- **Login throttling uses per-IP+email keys.** A global per-email lockout was rejected because it would let an unauthenticated attacker deny login to the single owner.
- **Password reset/change clear auth lockouts.** Recovery after an attacker-triggered 2FA lockout is not blocked; the break-glass runbook also clears `rate_limits`.
- **Destructive auth tests require `NEXTER_TEST_DB=1`.** CI uses a disposable PostgreSQL service; local runs must use a dedicated test database.
- **Phase 2 accepted.** Three independent reviews: FAIL → PASS WITH CHANGES → PASS WITH CHANGES; all Critical/High and actionable Medium findings fixed. Final green CI: `6d09b82`. Next phase: Phase 3 — Accounting core.
- **Phase 3 uses an append-only ledger with per-chain assets.** `transactions` + signed `postings` are the source of truth; balances and P&L are derived. Assets are unique per `(chain, symbol)` so BSC USDC and Ethereum USDC can have different decimals.
- **Default accounts are bootstrapped idempotently.** Every owner gets system accounts and `Tangem BSC`/`Tangem Ethereum` wallets; account rows are audited.
- **FIFO is global per asset.** Lots are not per account; transfers do not change lots. Stablecoins are cash equivalents and do not create lots.
- **Manual prices only in Phase 3.** No external price provider is added. Missing prices are represented as `null` and listed in `missingPrices`, never invented.
- **Income is separate from disposal P&L.** `incomeUsd` is included in total P&L; realized disposal P&L remains `proceeds − cost basis − selling fees`.
- **MVP manual buys/sells require a cash-equivalent quote/proceeds asset.** Token-to-token swaps remain supported; broader quote assets are a later extension.
- **Manual transactions are audited in the same transaction as the ledger writes.** Price changes are audited too; account bootstrap writes audit rows.
- **Manual writes are serialized per user.** A PostgreSQL advisory transaction lock makes the balance re-check safe under concurrent cash spends.
- **Withdrawals of non-cash assets realize disposal P&L.** Cash withdrawals remain capital flows; this keeps `equity − netDeposits = totalPnl`.
- **Positive adjustments and non-capitalized fees are explicit P&L components.** `adjustmentsUsd` and `feesUsd` are reported separately; fee amounts already capitalized or deducted from realized P&L are not counted twice. Adjustment reasons are persisted and audited.
- **Manual POSTs accept an `Idempotency-Key`.** Transaction `source_id` plus the unique user/source index makes retries replay the original transaction.
- **Asset decimals and wallet chain consistency are validated.** Amounts may not exceed `assets.decimals`; a wallet may only hold assets from its chain.
