# Restore Runbook

## Targets

- RPO: 1 hour (Railway PITR).
- RTO: 4 hours.
- Drill cadence: quarterly, plus before any destructive migration.

## Backup layers

1. **Railway PostgreSQL PITR** — primary recovery path for the last hours/days. Verify it is enabled in the Railway Postgres service settings before relying on it.
2. **Encrypted logical dump** — `pg_dump` custom format, AES-256-GCM encrypted, intended for daily upload to Cloudflare R2. The dump script is `packages/db/scripts/backup.mjs`; scheduling and the R2 upload command are operational configuration, not committed secrets.
3. **Monthly retained dump** — a monthly copy in the same encrypted format, retained for 12 months. Configure R2 lifecycle rules (30 days for daily, 12 months for monthly).

`BACKUP_ENCRYPTION_KEY` must be 32 bytes as base64 or 64 hex characters and stored outside the repository (password manager and Railway secret). Losing the key makes the dumps unrecoverable.

## Creating an encrypted backup

```bash
DATABASE_URL="$DATABASE_URL" \
BACKUP_ENCRYPTION_KEY="$BACKUP_ENCRYPTION_KEY" \
BACKUP_OUTPUT_DIR=./backups \
node packages/db/scripts/backup.mjs
```

The script uses local `pg_dump` when present, otherwise the `postgres:17-alpine` Docker image. Output is `nexter-<timestamp>.dump.enc`, laid out as `NEXTER1 | IV(12) | tag(16) | ciphertext`. The command prints plaintext and encrypted SHA-256 values for the backup record.

Schedule it daily (for example a Railway cron service) and upload:

```bash
rclone copy ./backups/*.dump.enc r2:nexter-backups/daily/
```

Use a dedicated R2 token with write-only access to the backup bucket. Never put R2 credentials in the repository, logs, or screenshots.

## Restoring a dump

1. Declare an incident and freeze writes: stop the worker, put the API in maintenance, and revoke sessions if credentials may be compromised.
2. Choose the restore point (PITR timestamp or dump object).
3. Create a **new** PostgreSQL instance/database. Do not overwrite production before verification.
4. Download the `.dump.enc` and decrypt it:

   ```bash
   BACKUP_ENCRYPTION_KEY="$BACKUP_ENCRYPTION_KEY" \
   node packages/db/scripts/backup.mjs --decrypt nexter-<timestamp>.dump.enc nexter.dump
   ```

5. Restore with `pg_restore` (custom format):

   ```bash
   pg_restore --no-owner --no-privileges --exit-on-error \
     --dbname "$RESTORED_DATABASE_URL" nexter.dump
   ```

   If the dump was produced by an older app version, run `node packages/db/dist/migrate.js` against the restored database after the restore.

6. Run the verification queries below. Do not point the app at the database until they pass.
7. Point the API and worker at the restored database, redeploy the matching app image, and verify `/health` and `/ready`.
8. Re-enable writes and confirm dashboard totals with the owner.
9. Record the timeline, data-loss window, root cause, and follow-up actions.

### PITR path

If the dump is unavailable, restore the Railway Postgres service to the chosen timestamp through the Railway dashboard. Then run migrations if the restore point predates the current schema. Treat the PITR instance as a new database until verified.

## Verification queries

Run against both the source (when available) and the restored database. Counts and sums must match; orphan counts must be zero.

```sql
select count(*) from users;
select count(*) from sessions;
select count(*) from accounts;
select count(*) from assets;
select count(*) from transactions;
select count(*) from postings;
select count(*) from lots;
select count(*) from lot_consumptions;
select count(*) from trade_groups;
select count(*) from audit_log;
select count(*) from settings;
select count(*) from imports;
select count(*) from import_rows;
select count(*) from watchlist;

select coalesce(sum(realized_pnl_usd), 0)::text from lot_consumptions;
select coalesce(sum(remaining_amount), 0)::text from lots;
select coalesce(sum(fees_usd), 0)::text from transactions;

select count(*) from postings p
left join transactions t on t.id = p.transaction_id
where t.id is null;

select count(*) from lots l
left join transactions t on t.id = l.acquisition_transaction_id
where t.id is null;

select count(*) from lot_consumptions c
left join lots l on l.id = c.lot_id
left join transactions t on t.id = c.disposal_transaction_id
where l.id is null or t.id is null;
```

For a production restore, also confirm the dashboard control totals with the owner: cash `15.73629954`, equity `1845.62434716`, realized `55.63629954`, total P&L `-617.17565284` for the 431-order baseline (values change with new activity).

## Automated drill

`packages/db/scripts/restore-drill.mjs` creates a disposable target database, restores the source into it with `pg_dump`/`pg_restore` (native or `postgres:17-alpine` Docker), then falls back to a logical JSON copy when neither client is available. It compares table counts, id checksums, sums, orphan counts, and re-runs migrations.

```bash
RESTORE_DRILL_SOURCE_URL="$DATABASE_URL" pnpm restore:drill
```

CI runs this after the build/test steps with `RESTORE_DRILL_MODE=dump-docker`. It also generates and decrypts an encrypted backup as a smoke test.

### Drill record

- 2026-11-04 — local drill against the real 431-order import dataset (logical JSON fallback; no PostgreSQL client tools on the workstation). 18 tables, 6,977 rows restored. Realized P&L `55.63629954`, lot remaining sum `9002602.000000000000000000`; zero orphan postings, lots, or consumptions; migrations re-ran cleanly. Result: **PASS**.
- CI drill — enabled in `.github/workflows/ci.yml`; uses `pg_dump`/`pg_restore` from `postgres:17-alpine` and verifies the encrypted backup round-trip.

## Rules

- Never restore over production without a verified backup.
- Never delete the old database until the new one is verified.
- Never store unencrypted dumps on a workstation longer than the drill.
- Record every drill and every real restore, including the data-loss window.
- Test restore quarterly and after any destructive migration.
