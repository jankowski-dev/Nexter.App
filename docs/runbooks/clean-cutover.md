# Clean cutover runbook (ADR 0014)

Status: prepared 2026-11-11. The owner runs the production cutover; agents prepare, verify, and assist. Do not delete or truncate the legacy ledger.

## Goal

Start the go-forward application with an empty ledger, explicit custody, and opening balances at cutover market value. Keep the current production database as a verified read-only archive. Do not migrate or correct the 431-order Notion-derived history.

## Preconditions

- UI-12 is deployed and healthy (bundle `assets/index-BFRB8_I4.js`, `/ready` green).
- A fresh encrypted backup of the current production database exists and a restore check passed on the target Postgres major version.
- The owner has supplied the cutover timestamp (UTC), the list of real custody addresses per chain, and the opening quantity/market value for every asset and wallet.
- `BACKUP_ENCRYPTION_KEY` is stored outside the repository. Configure a daily encrypted backup cron and, if available, enable Railway PITR before go-live. The 2026-11-11 UI-12 backup is a point-in-time copy, not a backup schedule.
- The legacy import UI remains available but is not used for the new ledger.

## 1. Freeze writes and record the timestamp

1. Set `SWAP_KILL_SWITCH=true` and wait for in-flight swaps to reach a terminal state.
2. Stop the worker and API, or put the app behind a maintenance response, so no new ledger rows can be written while the backup is taken. The owner chooses the maintenance mechanism; there is no built-in maintenance mode.
3. Record the cutover timestamp in UTC in the release record and in every opening-balance adjustment reason.

## 2. Back up and verify the legacy database

1. Take a custom-format dump from the current production database as the owner/migration role.
2. Encrypt it with `packages/db/scripts/backup.mjs` and record the plaintext and encrypted SHA-256 values.
3. Restore the dump into a scratch database and compare counts, sums, and orphan checks from `docs/runbooks/restore.md`.
4. Drop the scratch database only after the checks pass. Keep the encrypted dump outside the repository and the old database intact.

The 2026-11-11 UI-12 backup is recorded in `docs/phase-11-report.md`; take a new one at the actual cutover.

## 3. Create the go-forward database

Preferred: a new Railway Postgres database/service so the archive is isolated.

1. Create an empty database (for example `nexter_go_live`).
2. Run migrations as the owner/migration role:

   ```bash
   DATABASE_URL="$NEW_OWNER_DATABASE_URL" node packages/db/dist/migrate.js
   ```

3. Provision the application role on the new database:

   ```bash
   APP_DB_USER=nexter_app APP_DB_PASSWORD='<strong-password>' \
     DATABASE_URL="$NEW_OWNER_DATABASE_URL" pnpm db:provision-app
   ```

4. Set the API/worker `DATABASE_URL` to the `nexter_app` URL on the new database and `MIGRATION_DATABASE_URL` to the owner URL.
5. Deploy the API and worker. Verify `/health` and `/ready` before continuing.

## 4. Bootstrap the owner

1. Open `/setup` with the production `SETUP_TOKEN`.
2. Create the owner, save recovery codes, and enable TOTP.
3. Do not import the legacy Notion data.
4. Confirm `/api/v1/auth/me`, login, and 2FA work.

## 5. Custody and opening balances

1. Add every real custody address per chain via `POST /api/v1/reconciliation/addresses` (BSC and Ethereum). Include exchange/custody addresses only if they are actually watched and supported.
2. For each asset and wallet, enter one `adjustment` transaction:
   - `accountId`: the wallet account for that chain.
   - `assetId`: the asset.
   - `amount`: the opening quantity.
   - `usdValue`: quantity × cutover market price, as a decimal string.
   - `occurredAt`: the cutover timestamp.
   - `reason`: `Opening balance 2026-11-11T...Z; cost basis = market value at cutover`.
3. Cash equivalents may use a `deposit` instead of an adjustment only if the owner prefers that presentation; the resulting balance must match the custody quantity.
4. Do not invent historical cost basis, tax basis, or USD gas. The opening market value is the new cost basis.
5. If an asset has no reliable price, stop and ask the owner. Do not guess.

## 6. Reconcile

1. Run `POST /api/v1/reconciliation/run` for `bsc` and `ethereum`.
2. Inspect `GET /api/v1/reconciliation/runs/:id`.
3. Every non-zero balance must be `MATCH` or a documented owner-approved exception (exchange, other chain, unsupported token). Zero-balance unsupported imported assets are irrelevant in the new database.
4. Record the run IDs, timestamp, and exceptions in the release record.
5. If reconciliation does not match, fix custody addresses or opening balances and rerun. Do not adjust the ledger blindly.

## 7. Verify the application

- `/health` and `/ready` return 200 with `database: "ok"`.
- Dashboard shows the expected cash, positions, equity, and empty month P&L.
- Portfolio, `Основной список`, trades, Статистика, Operations, Tasks, Notes, Vault, and Settings load without console errors.
- A test quote (no execution) and the kill switch state are correct.
- An export includes the new ledger only.
- Worker logs `Nexter worker started`.

## 8. Archive the legacy database

1. Keep the legacy database and its verified encrypted backup.
2. Remove the application role's write access to the archive, or stop the legacy database after the owner confirms no further access is needed.
3. Never delete the archive until the owner signs off and the retention period is defined.

## Rollback

- Before cutover: no production change has been made; discard the new database.
- After switching `DATABASE_URL`: point API/worker `DATABASE_URL`/`MIGRATION_DATABASE_URL` back to the legacy database and redeploy the previous image. The legacy database was only read during cutover, so no restore is needed unless a write leaked through.
- After opening balances: the new database can be discarded and recreated; the archive remains the source of truth for the legacy period.
- The UI-12 release itself rolls back by redeploying the previous image (`31cb319`); migration `0027` is additive and can remain in the legacy database.

## Open items

- Enable Railway PITR or a daily encrypted backup cron before the cutover; the current RPO requirement is not met by a one-off dump.
- Decide whether the legacy Notion import UI stays under Settings or is removed after the archive is frozen.
- The worker still uses the owner database role because pg-boss performs DDL; moving it to a restricted role is a separate task.
