# Railway Deployment Runbook

## Services

Create these Railway services in one project:

1. **Postgres** — Railway PostgreSQL 17, private networking, PITR/backups enabled.
2. **api** — repository root, Dockerfile builder, start command `node apps/api/dist/main.js`.
3. **worker** — repository root, same Dockerfile, start command `node apps/worker/dist/main.js`.

Do **not** create a separate `@nexter/web` service. The API serves the built SPA from `WEB_DIST_PATH=/app/apps/api/public`.

Set **Root Directory** to the repository root for both `api` and `worker`. If Railway created services with root directories `apps/api`, `apps/worker`, or `apps/web`, delete/recreate them or change the root to `/`; otherwise the root `Dockerfile` and `railway.json` are ignored and Railway falls back to Nixpacks.

## Railway service settings

### api

- Builder: **Dockerfile**
- Dockerfile path: `Dockerfile`
- Config-as-code path: `railway.json` (or leave default)
- Start command: `node apps/api/dist/main.js`
- Healthcheck path: `/ready`
- Public networking: generate a domain on **api** (not on worker)
- Variables:
  - `NODE_ENV=production`
  - `DATABASE_URL=${{Postgres.DATABASE_URL}}`
  - `SENTRY_DSN` (optional)
  - `APP_URL=https://<api-domain>`
  - `SETUP_TOKEN` (required before first setup)
  - `AUTH_ENCRYPTION_KEY` (32-byte base64 or 64-char hex)
  - `ENABLE_DOCS=false`
  - `TRUST_PROXY` — `1` for Railway's single edge hop (the app parses it as a hop count), or the exact Railway/Cloudflare proxy CIDR. `true` is rejected in production because it trusts client-supplied `X-Forwarded-For`; `false` behind Railway makes every client share the edge IP, so IP lockouts become global. Default `false` for local development.

`WEB_DIST_PATH` is already set in the Dockerfile (`/app/apps/api/public`); do not set it manually. On Git Bash/Windows, setting Unix paths through `railway variable set` can be mangled by MSYS path conversion — use the Railway dashboard or `--stdin` if you must set one.

### worker

- Builder: **Dockerfile**
- Dockerfile path: `Dockerfile`
- Config-as-code path: `railway.worker.json`
- Start command: `node apps/worker/dist/main.js`
- No public domain, no HTTP healthcheck.
- Variables: `NODE_ENV=production`, `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `SENTRY_DSN` (optional).

## Troubleshooting: `The executable pnpm could not be found`

This error means the service start command is still `pnpm ...` while the runtime image contains only Node. It is not an application build failure.

1. Confirm the service **Root Directory** is `/`, not `apps/api` or `apps/worker`.
2. Set the service start command to `node apps/api/dist/main.js` (api) or `node apps/worker/dist/main.js` (worker).
3. Use the root `Dockerfile` as the builder.
4. Delete the separate `@nexter/web` service; the API serves the SPA.
5. Redeploy api and worker.

## Migrations

Run migrations as a separate Railway release/deploy step before starting the new API version:

```bash
node packages/db/dist/migrate.js
```

The command requires `MIGRATION_DATABASE_URL` (preferred) or `DATABASE_URL`. It resolves migrations from `packages/db/drizzle`.

Do not run migrations automatically on every API boot.

### Database roles and least privilege

Production should use two roles:

- **Migration/owner role** — owns the schema and runs `node packages/db/dist/migrate.js`. Set it as `MIGRATION_DATABASE_URL`.
- **Application role** — used by the API and worker as `DATABASE_URL`. It must not own tables and must not have `CREATE` on schema `public`.

Run the provisioning script as the owner/migration role:

```bash
APP_DB_USER=nexter_app APP_DB_PASSWORD='<strong-password>' DATABASE_URL="$MIGRATION_DATABASE_URL" pnpm db:provision-app
```

Then set the API/worker `DATABASE_URL` to the `nexter_app` URL and keep `MIGRATION_DATABASE_URL` on the owner role for the pre-deploy migration. The script refuses to run without a password of at least 16 characters, grants only DML on `public`, and verifies the role is not superuser/createdb/createrole. Use `--dry-run` to review the SQL with the password redacted.

Equivalent SQL (run as the database owner, replace the password and database name):

```sql
create role nexter_app login password '<strong-password>';
grant connect on database nexter to nexter_app;
grant usage on schema public to nexter_app;
grant select, insert, update, delete on all tables in schema public to nexter_app;
grant usage, select on all sequences in schema public to nexter_app;
alter default privileges in schema public
  grant select, insert, update, delete on tables to nexter_app;
alter default privileges in schema public
  grant usage, select on sequences to nexter_app;
```

The app does not need DDL, `TRUNCATE`, or role-management privileges. Test the app role on a restored copy before switching production. If the roles are not separated yet, keep `DATABASE_URL` on the owner role and record the gap; do not grant `SUPERUSER` to the app role.

### Backups

- Enable Railway Postgres PITR and confirm the retention window covers the 1-hour RPO.
- Create a daily cron service that runs `node packages/db/scripts/backup.mjs` with `DATABASE_URL` (owner/migration role is acceptable for dumps), `BACKUP_ENCRYPTION_KEY`, and `BACKUP_OUTPUT_DIR`.
- Upload the encrypted `.dump.enc` to Cloudflare R2 with a write-only token. Keep 30 daily and 12 monthly copies; configure lifecycle rules.
- Store `BACKUP_ENCRYPTION_KEY` in Railway secrets and the owner password manager.
- Test decryption and restore quarterly with `docs/runbooks/restore.md`.

### Phase 4 migration 0007 preflight

Migration `0007_wild_leper_queen.sql` is additive: it creates `imports`/`import_rows` and adds nullable `import_id`/`source_id` columns plus JSONB data-quality defaults. It does not delete or rewrite existing ledger data.

Before deploying:

1. Take a PostgreSQL backup.
2. Confirm the previous API/worker deployment is healthy.
3. Run the pre-deploy migration command `node packages/db/dist/migrate.js`.
4. Deploy the Phase 4 API/worker and the rebuilt SPA.
5. Verify `/ready`, then import through `/import` per `docs/runbooks/notion-import.md`.

The import endpoint accepts up to 10 MiB because the raw Notion `orders.json` is about 1.7 MiB. If a reverse proxy or edge is added later, raise its body limit to at least 10 MiB for `/api/v1/imports/notion/preview`.

### Phase 7 migration 0009 preflight

Migration `0009_daily_champions.sql` is additive: it creates `swap_orders`, `swap_events`, and `external_api_calls`. It does not rewrite ledger data.

Before enabling quotes:

1. Take a PostgreSQL backup.
2. Run the pre-deploy migration command.
3. Configure `SWAP_ENABLED=false` first and deploy the API/worker and SPA.
4. Set `KYBERSWAP_API_KEY` (preferred) or use the public fallback, `BSC_RPC_URL`, `SWAP_WALLET_ALLOWLIST`, and `SWAP_SELECTOR_ALLOWLIST` only after review.
5. Set `SWAP_ENABLED=true` and verify `GET /swap/config`, a quote, and the kill switch. Keep `SWAP_KILL_SWITCH=true` as the emergency stop.

Builds remain disabled until a selector allowlist is configured. Phase 7 never signs or submits transactions.

### Phase 5 migration 0008 preflight

Migration `0008_common_the_spike.sql` is additive: it creates `watchlist` and adds nullable `trade_groups.notes`. It does not rewrite ledger data.

Before deploying:

1. Take a PostgreSQL backup.
2. Run the pre-deploy migration command.
3. Deploy Phase 5 API/worker and the rebuilt SPA.
4. Verify `/ready`, then open `/dashboard`, `/portfolio`, `/trades`, `/watchlist`, and `/settings`.
5. Check that the production watchlist backfills from the latest committed Notion import on first read.

### Phase 2 migration 0003 preflight

Migration `0003` creates `users_singleton_unique` and aborts with a clear error if more than one owner exists (possible only if an old deployment hit the pre-fix setup race).

```sql
SELECT id, email, created_at FROM users ORDER BY created_at;
```

If the query returns more than one row:

1. Take a fresh backup and stop the API.
2. Decide which row is the canonical owner. Do not delete rows blindly.
3. In a transaction, move or merge `settings`, `sessions`, and `audit_log` references to the canonical user, record the decision in `audit_log`, and remove only the duplicate owner rows.
4. Re-run migrations and verify `GET /ready`.
5. Record the incident and the owner used.

If the history is ambiguous, restore the pre-migration backup and resolve the duplicate owners manually before retrying.

## Rollback

- Keep the previous deployment image available.
- Restore the database from PITR/backup if a migration is destructive.
- Re-deploy the previous image.
- See `docs/runbooks/restore.md`.

## Post-deploy checks

- `GET /health` returns 200.
- `GET /ready` returns 200 and `database: "ok"`.
- Worker logs `Nexter worker started`.
- No secret values appear in Railway logs.
- `pnpm smoke:static` passes locally against the built image before deploy.

### Phase 6 hardening release

Phase 6 is code/ops hardening with no schema migration. Before deploying:

1. Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, and `pnpm restore:drill`.
2. Confirm `pnpm audit --prod --audit-level=high` is clean.
3. Merge only after CI is green; Railway applies no new migration.
4. After deploy, verify `/health`, `/ready`, login/2FA, `/dashboard`, `/trades`, `/settings/audit`, and one export.
5. Confirm the encrypted backup cron produced an object in R2 and that its timestamp is within 24 hours.
