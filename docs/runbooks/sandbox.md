# Sandbox Runbook

Owner-only `Песочница`: a persistent live paper loop on real 1h market data (Stage 2) and an owner-facing historical replay over stored candles (Stage 2.1), both with virtual money. No wallets, keys, signing, exchange orders or real ledger writes.

- Stage 2 design: `docs/superpowers/specs/2026-11-24-sandbox-stage-2-ui-live-design.md`
- Stage 2 ADR: `docs/adr/0084-sandbox-stage-2-ui-live.md`
- Stage 2.1 design: `docs/superpowers/specs/2026-11-25-sandbox-historical-replay-design.md`
- Stage 2.1 ADR: `docs/adr/0085-sandbox-historical-replay.md`
- UI cleanup design: `docs/superpowers/specs/2026-11-25-sandbox-visual-cleanup-design.md`
- UI cleanup ADRs: `0089-sandbox-favorites-token-source.md`, `0090-remove-ai-trading-and-backtest.md`
- API flag: `SANDBOX_ENABLED` (default `true`; accepts `true|false|1|0`)
- Migrations: `0052_sandbox_stage2.sql`, `0053_sandbox_replays.sql` and `0055_favorites_default_group.sql` are applied in production (56 migrations). `0055` renamed the default watchlist group to `Избранное`. All sandbox migrations are additive/no-DELETE.

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

## Migration `0053` — production apply order (Stage 2.1, applied 2026-11-25)

Migration `0053_sandbox_replays.sql` is additive, creates the `sandbox_replays`
table plus three indexes and grants `nexter_app` `SELECT/INSERT/UPDATE` with
`DELETE` revoked. Nothing else changes; the table stays empty until the owner
creates a replay. With the flag on and the table missing, every replay worker
pass fails its first table query — the stale `running` requeue
(`requeueRunningReplays`) that runs after the advisory lock and before the claim
— logged and retried, no crash, but no replays run.
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

## Migration `0055` — favorites rename (this batch)

`0055_favorites_default_group.sql` is a data-only migration: it renames the
owner's default group `Основная` → `Избранное` only when no custom group named
`Избранное` already exists. It does not touch existing `sandbox_tokens` rows or
Stage 3 runs.

1. Encrypted backup + restore check (migration is data-only; DB schema unchanged).
2. Apply `0055` with the owner role, then verify:
   `select name, is_default from watchlist_groups;` shows one default
   `Избранное`; if the owner already had a custom `Избранное`, the default keeps
   its old name (UI still treats it as the default group).
3. Deploy API/web. Verify `/health`/`/ready`, `GET /sandbox/tokens/candidates`,
   both replay report downloads, chart/decisions, `Настройки → Стратегии`, no
   `ИИ-торговля` tab and no `Тестировать` buttons.
4. Confirm the five Stage 3 runs are still `running` and were not edited.
5. Rollback: redeploy the previous image. The rename is harmless; no data is
   dropped. Do not drop dormant `ai_*`/`bot_backtest_runs` tables here.

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
  `GET /sandbox/replays/:id/report.json`, `GET /sandbox/replays/:id/report.pdf`,
  `GET /sandbox/replays/:id/chart`, `GET /sandbox/replays/:id/decisions`,
  `POST /sandbox/replays/:id/cancel` (queued only), `POST /sandbox/replays/:id/archive`
  (terminal only). Owner-only, `SandboxEnabledGuard`, `Cache-Control: no-store`;
  unknown/foreign ids return `404 SANDBOX_REPLAY_NOT_FOUND`, a non-completed
  report returns `409 SANDBOX_REPLAY_NOT_COMPLETED`. Historical `report.md` was
  removed; only live run Markdown remains. There is no manual buy/add route.
- **Chart/decisions:** `chart` returns only evaluation-window candles plus
  buy/sell/reject/expire/counterfactual markers with reasons. `decisions`
  re-runs the persisted snapshot with frozen settings/seed on demand, caches in
  API memory by `(replayId, reportHash)` and never writes to the DB. A corrupt
  snapshot returns `409 SANDBOX_REPLAY_DECISIONS_UNAVAILABLE`/`SNAPSHOT_INVALID`.
- **Artifacts:** the page prioritizes PDF, keeps JSON, and hides hashes/seed/
  technical notes behind the artifact identity. PDF includes the identity,
  metrics, equity chart, per-strategy/per-token tables and all journals.
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
- **Favorites source:** `GET /sandbox/tokens/candidates` lists non-archived
  assets in the owner's default `Избранное` group. Only BSC/Ethereum assets with
  a contract are eligible; missing contracts, unsupported chains and cash
  equivalents are returned with `eligible=false` and a reason. `POST
/sandbox/tokens` re-resolves the key server-side and rejects arbitrary keys.
  Existing Stage 3 tokens are never removed or edited.

### Manual verification after deploy

1. `GET /health`, `/ready` → 200; an unauthenticated
   `GET /api/v1/sandbox/replays` → `401 AUTH_REQUIRED`.
2. `Песочница → Прогон` renders; preflight for a covered token shows `ok` with
   available/required and prefix bars.
3. Create a 30-day replay; the row is `queued`, then the worker moves it to
   `running` → `completed` within a pass or two. `GET …/report.json` returns
   `executionMode: 'historical-paper'` with `no-store` and the `identity` block;
   the PDF starts with `%PDF` and JSON/PDF downloads match the stored hash.
4. The completed page shows the action chart before the metric cards; markers
   open the reason, and `Все решения` loads the full decision journal. Long
   journals show 20 rows with `Ещё`. No `reportHash`/`seed`/notes are visible on
   the page.
5. Confirm the audit rows `sandbox.replay_created`, `replay_started`,
   `replay_completed` (and `replay_archived` after archiving), and that no
   `sandbox_replays` row was deleted.
6. Optionally cancel a queued replay (`cancelled` + `sandbox.replay_cancelled`).

## Research-only diagnostic replay

This pack explains why the engine did or did not act at each bar. It re-runs the
existing `runPaperFromCandles` pipeline over a frozen candle file and writes
local artifacts only; it does not touch Stage 3, replay rows, report hashes,
decision rules or the live runner.

Prepare a candle JSONL from `sandbox_candles` (read-only). Set `ETH_TOKEN_KEY`
to the Stage 3 ETH/BSC key from `docs/sandbox/stage-3-baseline.md`, then run:

```bash
npx pnpm@10.20.0 --filter @nexter/api diagnostics -- \
  --candles out/eth-bsc-1h.jsonl \
  --out out/eth-diagnostic-2026-11-26 \
  --token "$ETH_TOKEN_KEY"
```

Outputs: `diagnostics.csv`, `diagnostics.json`, `annotations.csv`, `chart.pdf`,
`chart/page-*.svg`, optional `chart/page-*.jpg`, and `summary.md`. Render JPGs
from the SVG pages with:

```bash
npx pnpm@10.20.0 --filter @nexter/e2e diagnostic-jpg -- \
  out/eth-diagnostic-2026-11-26
```

The PDF is A3
landscape, 15 days per page, with regime bands, candles, EMA24/EMA168, action
markers, volume and RSI14. `annotations.csv` accepts `entry`, `exit`, `hold` or
`no-trade`; match by timestamp or the printed bar number.

After the owner fills the CSV:

```bash
npx pnpm@10.20.0 --filter @nexter/api diagnostics -- \
  --annotate out/eth-diagnostic-2026-11-26/annotations.csv \
  --out out/eth-diagnostic-2026-11-26
```

This writes `annotation-report.md` with the nearest bar, regime, strategy/risk
reason and aggregate blockers. Generated artifacts stay under `out/` and are not
committed. For rule experiments, pass a `--settings <json>` file deep-merged over
the defaults and compare P/L, trades and max drawdown on ETH plus the five Stage 3
tokens. No variant becomes a default without an explicit owner decision.

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

Stage 2.1 (historical replay UI) is **accepted and deployed**. Migration `0053`
is applied, the independent whole-branch review signed off, and the owner
accepted the report. The backup/restore/SHA-256 record is in
`docs/decisions.md` and `docs/reviews/2026-11-25-sandbox-historical-replay-report.md`.
Stage 3 is active.

## Stage 3 gate

Stage 3 (8-week forward paper run) is **active** from 2026-11-25 through
2027-01-20. Real money remains a separate Stage 4
product/security/legal decision.
