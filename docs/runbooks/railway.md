# Railway Deployment Runbook

## Services

Create these Railway services in one project:

1. **Postgres** — Railway PostgreSQL 17, private networking, PITR/backups enabled.
2. **api** — this repository, Dockerfile builder, start command `node apps/api/dist/main.js`.
3. **worker** — same image, start command `node apps/worker/dist/main.js`.

## API service

Variables:

- `NODE_ENV=production`
- `DATABASE_URL=${{Postgres.DATABASE_URL}}`
- `SENTRY_DSN` (optional)
- `APP_URL=https://<your-domain>`
- `SETUP_TOKEN` (required before first setup in Phase 2)
- `ENABLE_DOCS=false`
- `WEB_DIST_PATH=/app/apps/api/public`
- `TRUST_PROXY` — set to the exact Railway/Cloudflare proxy CIDR or use `true` only when the origin is unreachable except through the trusted proxy. Default `false`.

Healthcheck: `/ready` (requires database).

## Worker service

Use the same Docker image. Start command:

```bash
node apps/worker/dist/main.js
```

Variables: `NODE_ENV=production`, `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `SENTRY_DSN`.

No HTTP healthcheck is required for the worker.

## Migrations

Run migrations as a separate Railway release/deploy step before starting the new API version:

```bash
node packages/db/dist/migrate.js
```

The command requires `DATABASE_URL`. It resolves migrations from `packages/db/drizzle`.

Do not run migrations automatically on every API boot.

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
