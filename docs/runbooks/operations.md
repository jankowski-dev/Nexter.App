# Operations Runbook

## Daily

- `GET /health` and `GET /ready` return `200`.
- Railway deployment is `SUCCESS`; no crash loop.
- Check Sentry for new 5xx or auth anomalies.
- Check API logs for `auth.rate_limited`, import failures, and 5xx.
- Confirm the daily encrypted backup exists in R2 and its size is plausible.
- Confirm no new `unverified_assets`, `negative_balances`, or `missing_gas` spike on `/settings/data-quality`.
- Check `/swap` history or the DB for `CONFIRMED` orders with null `accounting_transaction_id`, and for `SWAP_ACCOUNTING_*` errors older than 10 minutes. Investigate before the next swap.

## Weekly

- Review `/settings/audit` for unexpected mutations and sessions.
- Run `pnpm audit --prod --audit-level=high`.
- Confirm Railway Postgres disk/connection headroom.
- Confirm the restore drill record is current (quarterly at minimum).

## Deploy

1. Merge to `main` only after CI is green.
2. Railway deploys `@nexter/api` and `@nexter/worker` from `main`.
3. Pre-deploy runs `node packages/db/dist/migrate.js`.
4. Verify `/ready`, `/dashboard`, `/portfolio`, `/trades`, `/watchlist`, `/settings`, and an authenticated login/2FA flow.
5. Record the deployment id and migration in `docs/decisions.md` when the release changes behavior or schema.

## Rollback

- Railway: prefer `SWAP_KILL_SWITCH=true`/`SWAP_EXECUTION_ENABLED=false`; drain active/unaccounted swap orders before rolling back to a pre-Phase-8 image. The API hosts the swap tracker.
- Database: restore PITR/dump only if a migration is destructive; prefer a forward fix for additive migrations.
- After rollback, verify `/ready` and login.
- Keep the failed deployment logs and the exact commit SHA.

## Monitoring

- Health: `/health` (liveness) and `/ready` (database readiness). Railway healthcheck path is `/ready`.
- Logs: pino JSON; auth, CSRF, and cookie headers are redacted. Request URLs are logged without query strings.
- Sentry: optional; events and breadcrumbs are scrubbed by `@nexter/contracts`. Do not attach request bodies or cookies.
- No third-party analytics or trackers are allowed.

## Rate limits and locks

- In-memory edge limiter: auth 10/min, mutations 60/min, reads 300/min per IP in production (100/min auth in tests).
- DB-backed locks: login 10/15min per IP+email, 2FA/recovery 5/5min, password changes 5/15min, setup 5/15min.
- A `429` is expected during brute force; check `audit_log` for `auth.rate_limited`.
- Locks expire automatically. Do not clear `rate_limits` for an active investigation without recording why.

## Performance budgets

- Dashboard summary/allocation/P&L/equity curve: < 1000 ms.
- Trade-group and transaction lists: < 500 ms.
- Import preview for 431 orders: < 5000 ms.
- Export trade groups CSV: < 5000 ms.

The real-data test logs `[perf]` timings when run with `NEXTER_PERF=1`. Phase 6 measurements on the 431-order dataset: dashboard 62 ms, allocation 45 ms, P&L 43 ms, trade-group list 86 ms, export 154 ms, equity curve 50 ms, import preview 996 ms. Investigate before the next phase if a budget regresses by more than ~2×.

## Dependency and secret hygiene

- CI runs gitleaks and `pnpm audit --prod --audit-level=high`.
- Do not add a dependency without checking its license, maintenance, and transitive footprint.
- No secrets in code, prompts, logs, screenshots, or committed fixtures.
- Production secrets live in Railway variables; backups use a dedicated `BACKUP_ENCRYPTION_KEY`.

## Incident entry points

- Security incident: `docs/runbooks/security-incident.md`
- Restore: `docs/runbooks/restore.md`
- Auth recovery: `docs/runbooks/auth-recovery.md`
- Notion import: `docs/runbooks/notion-import.md`
- Railway setup: `docs/runbooks/railway.md`
