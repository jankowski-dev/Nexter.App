# Phase 6 — MVP-1 Hardening Report

Date: 2026-11-04

Status: **implementation and security review PASS; deployed to production on 2026-11-04. Owner UAT and production app-role provisioning are pending.**

## Scope

- E2E coverage for the accounting UI.
- Independent security review and fixes.
- Performance verification against the MVP-1 budgets.
- Backup restore drill and encrypted backup tooling.
- UAT checklist.
- Operations, restore, and security-incident runbooks.

## Changes

### Performance

- Refactored trade-group listing to fetch the page first and aggregate lots, consumptions, and sources only for those group ids. This removed a nested-loop plan that scanned the ledger per group.
- Real 431-order measurements: trade-group list ~86 ms (was ~488 ms), trade-group export ~154 ms (was ~1209 ms), dashboard summary ~62 ms, allocation ~45 ms, P&L ~43 ms, equity curve ~50 ms, import preview ~996 ms.
- The real-data e2e test logs `[perf]` timings and asserts the budgets when `NEXTER_PERF=1`.

### E2E

- New `apps/e2e/tests/manual-flows.spec.ts`: manual buy, partial sell, income, adjustment, trade-detail sell, audit, data quality, and JSON export through the real UI.
- Full Playwright suite is now four specs: auth, Notion import, manual accounting flows, and the Phase 5 UI flow.

### Security

The first independent security review returned **FAIL** with no Critical findings, one High, and eight Mediums. The High and the material Mediums are fixed; a re-review is pending.

- **H1 (fixed): negative fee forged wallet balance.** `tradeGroupSellRequestSchema` now uses positive decimal schemas for amount, proceeds, USD value, fee amount, and fee USD value. `LedgerService` defensively rejects non-positive fee amounts/values and non-positive cash-derived USD values. Regression tests cover negative, zero, exponent, malformed, and whitespace values on both trade-group sells and `/transactions`.
- **M1 (fixed): pre-auth 10 MiB import parsing.** A Fastify `onRequest` hook in `import-auth.hook.ts` resolves the session and validates CSRF/origin/2FA before the lossless import body parser runs. The imports e2e test sends a 2 MiB unauthenticated body and gets `401` before parsing.
- **M2 (fixed): database parameters in logs/Sentry.** `safe-error.ts` replaces Drizzle/DB errors with a short SQLSTATE-only message before logging or Sentry; audit and pool error paths use it. Unit tests assert SQL and bound values are removed.
- **M3 (fixed, with ledger residual): database least privilege.** `MIGRATION_DATABASE_URL` is preferred by the migration runner. `db:provision-app` creates a non-superuser `nexter_app` role with DML only, no schema `CREATE`, no `UPDATE`/`DELETE` on `audit_log`, and no `DELETE` on users/settings/accounts/assets/chains/imports/watchlist; the script verifies those denials. Ledger `DELETE` remains available for the documented import rollback path; removing it requires moving rollback behind a security-definer function (recorded as residual).
- **M4 (fixed): proxy/IP handling.** Numeric `TRUST_PROXY` values are parsed as hop counts; production/staging rejects `true`. Railway should run with `TRUST_PROXY=1` (one edge hop) so IP limits use the Railway-appended client IP instead of the shared edge IP. The production Railway values were checked without printing secrets: 64-char setup token, 32-byte key with 29 distinct bytes, HTTPS URL. The `TRUST_PROXY` variable is set to `1` after this release deploys.
- **Backup tooling (hardened after re-review).** `backup.mjs` rejects single-byte encryption keys, writes dumps only into a `0700` temporary directory with signal cleanup, encrypts before writing the final `0600` file, passes the DB password through `PGPASSWORD` rather than process arguments, and preserves URL query options such as `sslmode`/`sslrootcert` in the password-stripped connection URI.
- **M5 (fixed): vulnerable dev toolchain.** Vitest upgraded to 5.1.0 (tinypool patched); `pnpm audit --audit-level=high` now passes for all dependencies. CI gained an all-dependency audit gate. Two dev-only advisories remain (moderate `esbuild` via drizzle-kit, low `deepmerge` via Nest CLI) and are documented.
- **M6 (fixed): import numeric/field DoS.** Numeric exponents are normalized with a bounded exponent (max 30) instead of rejected, preserving the real Notion export (`9.83e-05`); oversized values are rejected. Text/id fields are capped, and parser errors/warnings are capped at 200 with an overflow marker.
- **M7 (fixed): malformed sell numbers caused 500s.** Covered by the positive schemas and the H1 regression tests.
- **M8 (fixed): weak production secrets.** Covered by M4 env validation.
- **L2–L5 (fixed):** UUID validation for cursor ids on all four paginated endpoints; whitespace idempotency keys normalized to absent; CSV guards line-feed prefixes; production `APP_URL` must be HTTPS.
- **L6–L9 (documented residual):** retention jobs for sessions/rate limits/imports, base-image/action digest pinning and runtime dependency pruning, failed-login audit spam, and `/ready` schema/Argon2 concurrency checks remain operational hardening items.

Production role/backup guidance is in `docs/runbooks/railway.md`; incident and daily operations procedures are in `docs/runbooks/`.

### Backup and restore

- `packages/db/scripts/backup.mjs`: custom-format `pg_dump` plus AES-256-GCM encryption (`NEXTER1 | IV | tag | ciphertext`), with self-test and decrypt modes.
- `packages/db/scripts/restore-drill.mjs`: disposable restore with native `pg_dump`/`pg_restore`, the `postgres:17-alpine` Docker client, or a logical JSON fallback. Verifies counts, id checksums, sums, orphan rows, and migrations.
- CI runs the restore drill and an encrypted-backup round-trip.
- Drill on the real 431-order dataset: 18 tables, 6,977 rows, realized P&L `55.63629954`, zero orphans, migrations re-ran cleanly.

### Operations and UAT

- `docs/runbooks/restore.md` expanded with backup layers, commands, verification queries, PITR path, and drill record.
- New `docs/runbooks/security-incident.md` and `docs/runbooks/operations.md`.
- `docs/uat.md` checklist for auth, import, dashboard, portfolio, trades, manual entry, watchlist, settings, export, and security.

## Verification

- `pnpm typecheck` — pass.
- `pnpm lint` — pass.
- `pnpm format:check` — pass.
- `pnpm build` — pass.
- API tests — **63 passed, 1 skipped**.
- Real 431 import + Phase 6 perf assertions — pass (see timings above).
- Playwright — **4 passed**.
- Restore drill — pass on the real 431 dataset (18 tables, 6,977 rows).
- Encrypted backup self-test — pass.
- `pnpm smoke:static` — pass with the production strict env validation.
- Gitleaks — no leaks.
- Dependency audit — `pnpm audit --audit-level=high` passes; no high/critical advisories.

## Security review

First review: **FAIL** — one High (H1) and eight Mediums. H1 and the material Mediums were fixed. Second review: **PASS WITH CHANGES** — no Critical/High, three remaining Mediums (production `TRUST_PROXY=false` shared IP, excessive role `DELETE`, backup key/temp/argv hardening); all three were fixed. Final re-review pending. L2–L5 are fixed; L6–L9 are documented residual.

## Known limitations

- The trade-group P&L-sign filter is still applied after the page query.
- R2 upload, retention lifecycle, and scheduling are operational configuration; the repository provides the encrypted dump and restore tooling but not cloud credentials.
- Separate DB roles are documented and supported; `db:provision-app` verifies no DELETE on users/settings/accounts/assets/chains/imports/watchlist. Ledger DELETE remains for import rollback.
- Retention cleanup for sessions/rate limits/imports, Docker/action digest pinning, and a schema-aware readiness check remain operational hardening items.
- UAT requires the owner to complete authenticated checks; automated Playwright covers the main flows.

## Production deployment

- PR #6 merged to `main` as `670c7be` after final security review **PASS**.
- Railway `@nexter/api` deployment `883ebb96` (Phase 6) and `0823ade7` (`TRUST_PROXY=1`) succeeded on 2026-11-04.
- `/health`, `/ready`, and `/login` return 200; new API routes return 401 without a session; security headers are present.
- Production pre-auth import probe: a 2 MiB unauthenticated body returned `401 AUTH_REQUIRED` before parsing, confirming the M1 hook in the deployed build.
- `TRUST_PROXY=1` is applied in production; IP-based limits now use the Railway-appended client IP rather than the shared edge address.

## Remaining acceptance steps

1. Owner completes `docs/uat.md` (authenticated production or staging walkthrough).
2. Owner runs `db:provision-app` with the owner/migration connection and switches the API/worker `DATABASE_URL` to the `nexter_app` role; keep `MIGRATION_DATABASE_URL` on the owner role.
3. Schedule the encrypted backup cron and R2 upload/retention, then record the first production backup drill.
4. Record Phase 6 acceptance in `AGENTS.md`/`README.md`/`decisions.md`.

## Next

Owner UAT and acceptance.
