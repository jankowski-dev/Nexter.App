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
- **Cash-equivalent USD is derived and enforced.** Cash equivalents are valued at $1 in Phase 3; explicit USD for a cash leg must equal the token amount. Manual cash prices are ignored until a depeg flag exists.
- **Fee USD must be positive and consistent with cash fees.** A zero fee USD is rejected; a cash fee USD must equal the cash fee amount.
- **Phase 3 accepted.** Three independent reviews: FAIL → PASS WITH CHANGES → PASS; all required findings fixed. Next phase: Phase 4 — Notion import.

## Phase 4 — Notion import

- **Phase 4 imports the current 431-order Notion export, not only the 429-order audit snapshot.** The 429 baseline remains the control; orders `465`/`466` (opened after the snapshot) and closed orders `450`/`463` (still active in the snapshot) are the known adjustments.
- **Control reconciliation reconstructs the 429 baseline explicitly.** Preview excludes the two post-snapshot orders and treats the two later-closed orders as active, then compares counts, transaction totals, cash, and active cost to the Phase 3 control within ±$0.01. A failed applicable baseline blocks commit. Price-dependent snapshot metrics (active value, equity, unrealized/total P&L) were calculated at audit-time prices and are reported separately, not gated.
- **Raw Notion exports are staged, not committed.** `imports`/`import_rows` keep normalized rows and source hashes; the repository never stores the export. The import preview uses `application/x-notion-import+json` with a route-specific 10 MiB limit and a lossless JSON parser that keeps numeric literals as strings; other routes keep 1 MiB.
- **Closed Notion orders use per-order lots.** Each order gets a trade group and a lot; a closed order consumes its own lot, preserving historical Notion cost basis. Imported active lots remain in the normal global FIFO pool: a later manual sell may consume them, and a later Notion close for the same partially consumed lot is rejected as `IMPORT_CONFLICT` instead of double-counting the disposal.
- **Notion close dates are date-only for some rows.** Those values are normalized to `23:59:59.999Z` on that date so the sell follows the buy on the same day.
- **USDT prices from Notion are ignored.** USDT is a cash equivalent valued at $1; non-cash `Курс [1]` values are stored as `source=notion` prices with `import_id`.
- **Imports are idempotent at row level.** Deterministic `notion:order:<id>:buy`, `:sell`, and `notion:transaction:<pageId>` source ids prevent duplicates. Re-exports skip existing rows and can add a sell to an already imported active order. Commit re-runs detection under the user lock, so a preview → rollback → commit sequence re-opens skipped rows instead of silently committing an empty import.
- **Import and manual writes share one advisory lock.** This prevents imports from racing manual ledger writes and negative-balance checks.
- **Rollback is a narrow import-admin exception.** It is allowed only for the newest committed import with no later non-import activity; it removes the import's transactions, lots, groups, and prices, restores lots for active→closed updates, and restores previous group status/closedAt from `import_rows.metadata` for status-only and `for_sale`/`reserve` updates. Ordinary ledger mutations remain append-only.
- **The import reconciliation endpoint is read-only.** `GET /api/v1/imports/:id/reconciliation` returns the stored control, current deltas, and valuation.
- **Source watchlist theses/tags are deferred to Phase 5.** Phase 4 imports assets and keeps descriptions in staging; the watchlist table/UI is not part of this phase.
- **Import commit checks final wallet balances only.** The Notion journal has buys before the first recorded deposit, so chronological non-negativity would require inventing an opening balance.
- **Phase 4 UI is limited to `/import`.** Upload, preview, control reconciliation, commit/rollback, history, and a compact post-commit accounting summary. Full dashboard/portfolio/trades UI remains Phase 5.
- **Phase 4 accepted.** Three independent reviews (FAIL → PASS WITH CHANGES → PASS), owner sign-off on the documented scope deviations, and the production 431-row import applied on 2026-11-03. Merge commit `12bfbb0`; main CI passed. Next phase: Phase 5 — MVP-1 UI.

## Phase 5 — MVP-1 UI

- **Watchlist is a separate soft-archived table.** `(user_id, asset_id)` is unique; `DELETE` archives. The first read backfills from the latest committed Notion Source rows (thesis from `Описание`, tags from `Топ`/`Дашбоард`/`П-Мкап`).
- **Trade groups expose read/detail/sell/notes APIs.** Notes are product metadata on `trade_groups`; `POST /trade-groups/:id/sells` delegates to the append-only manual sell path with `tradeGroupId`. Trade reversal is deferred to Phase 6.
- **Dashboard aggregates are derived from the ledger.** Allocation, monthly P&L, active positions, recent trades, data quality, and an equity curve are read-only. The equity curve is explicitly valued at current prices because historical prices are unavailable; true historical valuation needs snapshots.
- **Settings remain narrow in MVP-1.** USD and FIFO are fixed; timezone and `includeGasInCostBasis` are editable and audited. Account management is read-only for now.
- **Audit log has a read API.** The owner sees their entries and system entries; filters and cursor pagination are supported.
- **Export is server-side CSV/JSON.** Transactions, positions, and trade groups are exported with quoting and an `export.generated` audit entry.
- **Manual entry is a global dialog using the existing ledger API.** The dialog supports all eight manual types; the server remains the authority for validation, FIFO, fees, and postings.
- **The running Swagger document is the API reference; shared Zod contracts are the typed client.** A generated OpenAPI client is deferred to Phase 6 tooling.
- **Test-only auth rate limit is raised.** Playwright runs multiple setup flows from one IP; `NODE_ENV=test` allows 100 auth attempts/minute instead of 10. Production remains at 10. The DB-backed auth lockout tests still exercise 429 behavior through the service layer.
- **Watchlist prices are not invented.** 24h change is `null` unless the latest price is less than 24h old and an older price exists. Backfill is marked by audit, runs with `onConflictDoNothing`, and archived entries can be restored.
- **Manual-entry idempotency keys are stable per dialog attempt.** The key is generated when the dialog opens, reused on retries, and reset after success. Trade-group sell accepts the same header.
- **The equity curve is capped to the most recent 36 months** and ends at the current month; older history is folded into the first balance rather than dropping recent months.
- **Cash asset detail is available.** USDT/USDC positions are returned at $1 for the asset detail page; non-cash asset detail loads all trade groups, not just the first 50.
- **Manual transfer account selectors only offer wallets.** The destination defaults to a second wallet or empty; the current one-wallet-per-chain setup means internal transfers are usable only after account management lands.
- **Authenticated API responses are no-store.** CSV cells beginning with formula characters are prefixed with `'`; manual prices must be positive; cursor and watchlist race errors are mapped to 400/409.
- **Monthly P&L uses the configured IANA timezone.** UI date labels use the browser timezone; this distinction is shown in settings.
- **Phase 5 deferrals:** trade reverse/compensating reversal, standalone manual Fee type, dashboard account/asset filters and holding-period buckets, portfolio account grouping, accounts CRUD, watchlist drag-sort, and generated OpenAPI client are Phase 6 items.
- **CSV protection preserves numeric cells.** Only formula-like text is prefixed with `'`; negative decimal values remain numeric in spreadsheets.
- **Microsecond timestamps are paged at millisecond precision.** Audit and watchlist cursors use `date_trunc('milliseconds', ...)` for ordering and predicates, so rows sharing the cursor's millisecond are not skipped. Settings creation is audited as `settings.created`; monthly P&L falls back to `Europe/Minsk`.
- **Phase 5 accepted.** Independent review returned PASS after two rounds of fixes (no Critical/High/Medium findings remaining). PR #3 merged to `main` as `a731457`; docs sign-off merged as `a59bc4b`. Railway `@nexter/api` deployment `f99e06cd-fd9a-4ad2-8057-cdf63b7a32eb` succeeded on 2026-11-04 and pre-deploy applied migration `0008`; `/health` and `/ready` return 200, and the deployed bundle contains the Phase 5 routes. The owner approved the Phase 6 deferrals on 2026-11-04. Next phase: Phase 6 — MVP-1 hardening.

## Phase 6 — MVP-1 hardening

- **Security review comes before operational sign-off.** Phase 6 runs an independent security review and fixes material findings before UAT.
- **Trade-group listing is aggregated in a second query.** The list now fetches the page of groups, then aggregates lots/consumptions/sources for those group ids. This removed a nested-loop plan that scanned the ledger per row; the 431-order list dropped from ~488 ms to ~86 ms while preserving the contracts.
- **Separate migration role support.** `packages/db/src/migrate.ts` prefers `MIGRATION_DATABASE_URL` over `DATABASE_URL`. The runbook documents a least-privilege `nexter_app` role for the API/worker and an owner role for migrations.
- **Encrypted logical backups.** `packages/db/scripts/backup.mjs` creates a custom-format `pg_dump` and encrypts it with AES-256-GCM (`NEXTER1` header + IV + tag + ciphertext). The key is a 32-byte `BACKUP_ENCRYPTION_KEY`; R2 upload and retention are operational configuration, not committed secrets.
- **Restore drill is automated.** `packages/db/scripts/restore-drill.mjs` restores into a disposable database with native `pg_dump`/`pg_restore` or the `postgres:17-alpine` image, with a logical JSON fallback for developer machines. It verifies table counts, id checksums, sums, orphan rows, and re-runs migrations. CI runs it with the Docker client plus an encrypted-backup round-trip.
- **Performance budgets are checked with real data.** The 431-order e2e test logs `[perf]` timings and asserts dashboard <1 s, list <500 ms, import preview <5 s, and export <5 s when `NEXTER_PERF=1`.
- **Manual-flow E2E covers the accounting UI.** A fourth Playwright spec exercises buy, partial sell, income, adjustment, trade-detail sell, audit, data quality, and JSON export through the real UI.
- **Operational runbooks are part of the deliverable.** Restore, security incident, and daily operations runbooks are updated; the UAT checklist is in `docs/uat.md`.
- **Phase 6 security fixes.** Trade-group sell amounts/fees use positive decimal schemas and the ledger defensively rejects non-positive fee values. The large import body is authenticated in a Fastify `onRequest` hook before parsing. DB errors are sanitized before logs/Sentry. Production/staging config rejects `TRUST_PROXY=true`, short/test setup tokens, single-byte encryption keys, and non-HTTPS `APP_URL`. Cursor ids are UUID-validated; whitespace idempotency keys are treated as absent; CSV guards line-feed prefixes. Vitest was upgraded to 5.1.0 and the all-dependency audit is a CI gate.
