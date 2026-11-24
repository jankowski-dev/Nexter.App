# Sandbox Runbook

Owner-only `Песочница` (Stage 2): a persistent live paper loop on real 1h market data with virtual money. No wallets, keys, signing, exchange orders or real ledger writes.

- Design: `docs/superpowers/specs/2026-11-24-sandbox-stage-2-ui-live-design.md`
- ADR: `docs/adr/0084-sandbox-stage-2-ui-live.md`
- API flag: `SANDBOX_ENABLED` (default `true`; accepts `true|false|1|0`)
- Migration: `packages/db/drizzle/0052_sandbox_stage2.sql` (additive, no DELETE grants)

## Enable / disable

| `SANDBOX_ENABLED` | API | Runner | UI                       |
| ----------------- | --- | ------ | ------------------------ |
| `true` / `1`      | on  | on     | nav + all tabs           |
| `false` / `0`     | off | off    | nav hidden; status shown |

When off, `GET /api/v1/sandbox/status` stays reachable (owner auth) and returns
`{ enabled: false, version: 'sandbox-stage-2' }`; every other sandbox route returns
`404 SANDBOX_DISABLED` and the 60-second runner does not start. Existing
`sandbox_*` rows stay intact and inert; reads are restored when the flag is on again.

Changing the flag requires an API redeploy (env is parsed at boot). Always stop
running runs before disabling if you want their `last_tick_at` to remain current.

## Migration `0052` — production apply order

Migration `0052` is additive and was **not applied to production in Stage 2**
(branch head only). Apply it only with owner approval:

1. Create the pre-migration encrypted backup and verify a restore (see below);
   record the plaintext and encrypted SHA-256.
2. Apply migrations with the owner role (never `nexter_app`):

   ```bash
   MIGRATION_DATABASE_URL="$MIGRATION_DATABASE_URL" \
     node packages/db/dist/migrate.js
   ```

   This creates the `sandbox_*` tables and indexes and applies the grant revokes.

3. Re-provision the app role so `nexter_app` receives the new grants and no DELETE:

   ```bash
   APP_DB_USER=nexter_app APP_DB_PASSWORD='<secret>' \
   DATABASE_URL="$MIGRATION_DATABASE_URL" pnpm db:provision-app
   ```

   The provisioning script is authoritative: `SELECT/INSERT/UPDATE` on mutable
   sandbox tables, `SELECT/INSERT` on `sandbox_events` (no UPDATE/DELETE), no
   DELETE anywhere. Verify with `\dp sandbox_*` and the CI `sandbox-schema` suite.

4. Deploy the Stage 2 API/UI with `SANDBOX_ENABLED=true`.
5. Verify `/health` and `/ready` return 200, the owner sees `Песочница`, and
   `GET /api/v1/sandbox/overview` returns `executionMode: 'live-paper'`.
6. Run the live smoke below, then optionally start one short paper run.

## Pre-migration backup and rollback

Backup (encrypted, custom format):

```bash
DATABASE_URL="$DATABASE_URL" BACKUP_ENCRYPTION_KEY="$BACKUP_ENCRYPTION_KEY" \
  BACKUP_OUTPUT_DIR=./backups node packages/db/scripts/backup.mjs
```

Record the printed plaintext and encrypted SHA-256, and restore-check the dump
into a disposable database (`docs/runbooks/restore.md`). A migration without a
verified backup is not approved.

Rollback:

1. Stop the runner: set `SANDBOX_ENABLED=false` and redeploy (or stop every
   running run first from the UI).
2. Revert the API/UI/package code to the previous image if the change caused it.
3. The `sandbox_*` tables are additive and inert; leave them in place or drop
   them later with a separate approved destructive migration. Do not restore the
   database unless other data was damaged; the migration creates no rows.

## Live provider smoke (opt-in, no Postgres)

The market-data clients return no candles under `NODE_ENV=test`, so run the
opt-in smoke with a non-test environment:

```bash
cd apps/api
NODE_ENV=development SANDBOX_LIVE_SMOKE=1 \
  npx vitest run test/sandbox-live-smoke.e2e.spec.ts
```

It fetches 180 days of real 1h candles through `SandboxDataService`
(`binance:BTCUSDT` + `bsc:0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82`, the CAKE
token contract on BSC; the client resolves its top pool), upserts them into an
in-memory repository and asserts the
available/required/gaps/stale/synthetic coverage math. CI never sets
`SANDBOX_LIVE_SMOKE`, so the suite is skipped and no network is used.

Observed locally on 2026-11-24: Binance 4320/4320 rows (`ok`, gaps 0, not stale,
not synthetic); GeckoTerminal 4320/4320 rows after three HTTP 429 retries
(`ok`, gaps 0, not synthetic). Public providers rate-limit; retries are expected.

A full live paper tick against a deployed environment is a **post-deploy**
verification with owner approval. Do not leave a production run started unless
the owner asks for it.

## Operations

- One API instance is expected; the runner is serialized by
  `pg_try_advisory_lock(hashtext('nexter:sandbox-runner'))` and each run advances
  at most once per closed 1h bar (`last_bar_close`).
- Ticks persist events, engine/ledger state, projections and the equity point in
  one transaction. A reconciliation failure marks the run `failed` and stops it.
- `sandbox_events` is append-only (`SELECT/INSERT` only). No code path deletes
  sandbox rows; closed positions are zero tombstones.
- The event log replays the full chain per tick/report. Long forward runs make
  that O(n²); snapshot/checkpointing is a Stage 3 item.
- Candles are read with a bounded 4321-row window per token; reports are
  generated on demand and never write `sandbox_reports`.
- Candle retention is not pruned in Stage 2. Old runs remain readable; archive
  is a soft hide, not a delete.
- Data staleness: coverage marks a series stale when its last closed bar is more
  than one bar old; the dashboard shows the freshness state only for running,
  non-archived runs.

## Stage 3 gate

Stage 3 (4–8 week forward paper run) must not start until the Stage 2
independent review is signed off and the owner accepts the Stage 2 report. Real
money remains a separate Stage 4 product/security/legal decision.
