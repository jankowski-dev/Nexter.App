# Sandbox Runbook

Owner-only `Песочница`: a persistent live paper loop on real 1h market data (Stage 2) and an owner-facing historical replay over stored candles (Stage 2.1), both with virtual money. No wallets, keys, signing, exchange orders or real ledger writes.

- Stage 2 design: `docs/superpowers/specs/2026-11-24-sandbox-stage-2-ui-live-design.md`
- Stage 2 ADR: `docs/adr/0084-sandbox-stage-2-ui-live.md`
- Stage 2.1 design: `docs/superpowers/specs/2026-11-25-sandbox-historical-replay-design.md`
- Stage 2.1 ADR: `docs/adr/0085-sandbox-historical-replay.md`
- API flag: `SANDBOX_ENABLED` (default `true`; accepts `true|false|1|0`)
- Migrations: `packages/db/drizzle/0052_sandbox_stage2.sql` (applied in production) and `packages/db/drizzle/0053_sandbox_replays.sql` (additive, **not applied**) — both with no DELETE grants

## Enable / disable

| `SANDBOX_ENABLED` | API | Runner + replay worker | UI                       |
| ----------------- | --- | ---------------------- | ------------------------ |
| `true` / `1`      | on  | on                     | nav + all tabs           |
| `false` / `0`     | off | off                    | nav hidden; status shown |

When off, `GET /api/v1/sandbox/status` stays reachable (owner auth) and returns
`{ enabled: false, version: 'sandbox-stage-2' }`; every other sandbox route returns
`404 SANDBOX_DISABLED`, and neither the 60-second live runner nor the 60-second
replay worker starts. Existing `sandbox_*` and `sandbox_replays` rows stay intact
and inert; reads are restored when the flag is on again. Queued replays remain
`queued` while the flag is off and run after it is re-enabled.

Changing the flag requires an API redeploy (env is parsed at boot). Always stop
running runs before disabling if you want their `last_tick_at` to remain current.

## Migration `0052` — production apply order (applied 2026-11-25)

Migration `0052` is additive and was applied to production with owner approval on
2026-11-25 (Stage 2). The order below remains the reference for a rebuilt
environment:

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

## Migration `0053` — production apply order (Stage 2.1, not applied)

Migration `0053_sandbox_replays.sql` is additive, creates the `sandbox_replays`
table plus three indexes and grants `nexter_app` `SELECT/INSERT/UPDATE` with
`DELETE` revoked. Nothing else changes; the table stays empty until the owner
creates a replay. With the flag on and the table missing, every replay worker
pass fails its first query — the stale `running` requeue (`requeueRunningReplays`)
that runs before the claim — logged and retried, no crash, but no replays run.
Apply the migration **before** deploying code that references the table.

1. Encrypted backup + restore check + SHA-256 (see below). A migration without
   a verified backup is not approved.
2. Apply with the owner role:

   ```bash
   MIGRATION_DATABASE_URL="$MIGRATION_DATABASE_URL" \
     node packages/db/dist/migrate.js
   ```

3. Re-provision `nexter_app` (or confirm the migration grants) and verify:

   ```bash
   APP_DB_USER=nexter_app APP_DB_PASSWORD='<secret>' \
   DATABASE_URL="$MIGRATION_DATABASE_URL" pnpm db:provision-app
   ```

   `sandbox_replays`: `SELECT/INSERT/UPDATE`, **no DELETE**; the provisioning
   script lists it in the delete-revoke/delete-check sets. Verify with `\dp
sandbox_replays` and the CI `sandbox-schema` suite (`sandbox.migration.spec.ts`
   is a local static check of the committed SQL/journal, not a runtime grant check).

4. Deploy the Stage 2.1 API/UI with `SANDBOX_ENABLED=true`.
5. Verify `/health` and `/ready` return 200, the replay routes return `401`
   unauthenticated, and the `Песочница → Прогон` tab renders.
6. Create one short (30-day) replay for tokens with full coverage and verify the
   manual checklist below. Do not start a live run for this check.
7. Rollback: set `SANDBOX_ENABLED=false` and redeploy (this stops the replay
   worker and the live runner), then revert the image if needed. `sandbox_replays`
   is additive and inert with no rows to restore; it can be dropped later only by
   a separate approved destructive migration. Do not restore the database for
   this migration.

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

1. Stop the runner and replay worker: set `SANDBOX_ENABLED=false` and redeploy
   (or stop every running run first from the UI; a queued replay simply waits).
2. Revert the API/UI/package code to the previous image if the change caused it.
3. The `sandbox_*`/`sandbox_replays` tables are additive and inert; leave them in
   place or drop them later with a separate approved destructive migration. Do
   not restore the database unless other data was damaged; neither migration
   creates rows.

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

## Historical replay (`Прогон`, Stage 2.1)

The `Прогон` tab (`#replay`) runs the Stage 1C engine over stored `sandbox_candles`
and stores the report plus the exact input snapshot. It is independent of live
runs and never mutates them.

- **API:** `POST /sandbox/replays/preflight`, `POST /sandbox/replays` (202),
  `GET /sandbox/replays`, `GET /sandbox/replays/:id`,
  `GET /sandbox/replays/:id/report.json|report.md`,
  `POST /sandbox/replays/:id/cancel` (queued only), `POST /sandbox/replays/:id/archive`
  (terminal only). Owner-only, `SandboxEnabledGuard`, `Cache-Control: no-store`;
  unknown/foreign ids return `404 SANDBOX_REPLAY_NOT_FOUND`, a non-completed
  report returns `409 SANDBOX_REPLAY_NOT_COMPLETED`. There is no manual buy/add
  route.
- **Statuses:** `queued`, `running`, `completed`, `failed`, `cancelled`; archive
  is a soft `archived_at`. A running replay is bounded and is not cancelled in
  v1; only queued replays can be cancelled.
- **Worker:** `SandboxReplayWorkerService` runs every 60 s (first pass after
  15 s) only when `SANDBOX_ENABLED` and not `NODE_ENV=test`. It holds
  `pg_try_advisory_lock(hashtext('nexter:sandbox-replay-worker'))` for the whole
  claim → snapshot → run → store cycle and releases it in `finally`. One replay
  at a time; a second API instance cannot claim while the lock is held.
- **Restart recovery:** `running` rows are requeued **only after** the lock is
  acquired, so a rolling deploy cannot steal a replay another instance is still
  executing. The requeue is audited `sandbox.replay_requeued`; the stored gzip
  snapshot is reused, so the same input produces the same report.
- **Worker thread:** the CPU-heavy engine runs in
  `sandbox-replay.worker.js` with a 15-minute hard bound. A worker error,
  non-zero exit, timeout or missing report marks the replay `failed` with a
  sanitized message; the API event loop and the live runner stay responsive.
- **Data and window:** `to_time` is the earliest latest closed 1h candle across
  the selected 1–3 tokens. The evaluation window is `to − periodDays` (30/90/180)
  and the data window is up to 180 days ending at `to_time`; earlier candles are
  lookback prefix only and are not evaluated, traded or included in the report
  period. A 180-day request has no prefix (the store is 180 days). There is no
  provider call in the replay path.
- **Coverage:** preflight reports per-token available/required, prefix bars, gaps,
  synthetic, stale and `ok|partial|missing`. A gap inside the evaluation window
  or missing data blocks creation (`409 SANDBOX_REPLAY_COVERAGE_MISSING`); a
  partial window requires explicit `allowPartial` and at least 240 evaluation
  bars (`409 SANDBOX_REPLAY_WINDOW_TOO_SHORT` otherwise). The owner can refresh
  tokens from `Прогон → Обновить данные` / the token universe before retrying.
- **Snapshot/report:** the worker gzips the exact prefix + evaluation candles
  before running; `candle_snapshot_hash` (SHA-256 of the uncompressed canonical
  JSON) equals `dataSnapshotId`. `report_hash`, `event_count`, `event_hash` and
  the full `RunReport` JSONB are stored. Re-running the stored snapshot with the
  frozen settings/seed reproduces the report hash. The full event chain is not
  persisted (only counts/hashes).
- **Semantics:** decisions at bar `i` see candles up to the close of bar `i`
  only; fills execute at the next bar open with the frozen fees/slippage. The
  report is labelled `historical-paper` and says it is not a live fill or a
  performance claim.

### Manual verification after deploy

1. `GET /health`, `/ready` → 200; an unauthenticated
   `GET /api/v1/sandbox/replays` → `401 AUTH_REQUIRED`.
2. `Песочница → Прогон` renders; preflight for a covered token shows `ok` with
   available/required and prefix bars.
3. Create a 30-day replay; the row is `queued`, then the worker moves it to
   `running` → `completed` within a pass or two. `GET …/report.json` returns
   `executionMode: 'historical-paper'` with `no-store`; JSON and Markdown
   downloads match the stored hash.
4. Confirm the audit rows `sandbox.replay_created`, `replay_started`,
   `replay_completed` (and `replay_archived` after archiving), and that no
   `sandbox_replays` row was deleted.
5. Optionally cancel a queued replay (`cancelled` + `sandbox.replay_cancelled`).

## Operations

- One API instance is expected; the runner is serialized by
  `pg_try_advisory_lock(hashtext('nexter:sandbox-runner'))` and each run advances
  at most once per closed 1h bar (`last_bar_close`).
- Ticks persist events, engine/ledger state, projections and the equity point in
  one transaction. A reconciliation failure marks the run `failed` and stops it.
- Deterministic engine/event/persistence failures mark the run `failed` and
  expire pending intents: invalid persisted state/JSONB, a broken or invalid
  event chain/payload, `PaperLedgerError`/`PaperRunError`/execution/clock/candle
  validation errors and event-schema/JSON validation errors. Transient DB/pool
  errors and unknown infrastructure failures log a warning, keep the run
  `running` and retry on the next 60-second pass (no intent expiry, no terminal
  error).
- `sandbox_events` is append-only (`SELECT/INSERT` only). No code path deletes
  sandbox rows; closed positions are zero tombstones.
- The event log replays the full chain per tick/report. Long forward runs make
  that O(n²); snapshot/checkpointing is a Stage 3 item.
- Candles are read with a bounded 4321-row window per token; reports are
  generated on demand and never write `sandbox_reports`.
- Candle retention is not pruned in Stage 2/2.1. Old runs and replays remain
  readable; archive is a soft hide, not a delete.
- Data staleness: coverage marks a series stale when its last closed bar is more
  than one bar old; the dashboard shows the freshness state only for running,
  non-archived runs.
- Historical replays use a separate 60-second worker and advisory lock
  (`nexter:sandbox-replay-worker`); they never write `sandbox_runs`,
  `sandbox_events`, positions or the live ledger. A queued replay waits while the
  flag is off or another replay is running. Report/snapshot rows are expected to
  be a few MB at most (1–3 tokens, ≤180 days; unmeasured at that maximum) and are
  not pruned.

## Stage 2.1 gate

Stage 2.1 (historical replay UI) is **implemented; independent review gate**.
Migration `0053` is not applied and nothing is deployed. Production migration and
deploy only after the independent whole-branch review and explicit owner
approval, with the backup/restore/SHA-256 record above.

## Stage 3 gate

Stage 3 (4–8 week forward paper run) must not start until the Stage 2
independent review is signed off, the owner accepts the Stage 2 report, and the
Stage 2.1 replay report is also accepted. Real money remains a separate Stage 4
product/security/legal decision.
