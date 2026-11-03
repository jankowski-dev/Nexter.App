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
  - `TRUST_PROXY` — exact Railway/Cloudflare proxy CIDR, or `true` only behind a trusted proxy. Default `false`.

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

The command requires `DATABASE_URL`. It resolves migrations from `packages/db/drizzle`.

Do not run migrations automatically on every API boot.

### Phase 4 migration 0007 preflight

Migration `0007_wild_leper_queen.sql` is additive: it creates `imports`/`import_rows` and adds nullable `import_id`/`source_id` columns plus JSONB data-quality defaults. It does not delete or rewrite existing ledger data.

Before deploying:

1. Take a PostgreSQL backup.
2. Confirm the previous API/worker deployment is healthy.
3. Run the pre-deploy migration command `node packages/db/dist/migrate.js`.
4. Deploy the Phase 4 API/worker and the rebuilt SPA.
5. Verify `/ready`, then import through `/import` per `docs/runbooks/notion-import.md`.

The import endpoint accepts up to 10 MiB because the raw Notion `orders.json` is about 1.7 MiB. If a reverse proxy or edge is added later, raise its body limit to at least 10 MiB for `/api/v1/imports/notion/preview`.

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
