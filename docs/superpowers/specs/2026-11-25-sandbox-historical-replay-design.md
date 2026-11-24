# Sandbox historical replay in the UI — design

Date: 2026-11-25
Status: **proposed; owner approval pending**
Scope: Stage 2.1 (owner-facing historical replay). The Stage 1C replay engine is already built and accepted; this design wraps it in the `Песочница` UI. It does not change the decision, fill, ledger or report rules.
Base: Stage 2 merged as `3a6f94a`, deployed `ad0b0b73-2df2-46bd-a403-f83074c598c5`, migration `0052` applied.

## 1. Intent

The owner wants to test the sandbox on **historical** data the same way it
behaves live: at each 1h bar the system sees only the current and previous
candles, never the next one, and reacts with the Stage 1B/1C rules. Today that
engine exists in `@nexter/sandbox-core` and is exercised by a 180-day golden and
the CLI, but there is no owner-facing way to run it from the app. The live
`Песочница` only runs forward.

This design adds an owner-only `Исторический прогон` tab: choose tokens, a
period (30/90/180 days), capital and the same decision/paper settings as a live
run; the replay runs asynchronously over `sandbox_candles`; the owner sees
progress, equity, trades, intents, counterfactuals and the deterministic
JSON/Markdown report. Results are persisted so they can be compared with each
other and, later, with the Stage 3 forward run.

## 2. Goals and non-goals

### Goals

1. Owner-facing `Исторический прогон` in `Песочница`, independent of live runs.
2. Deterministic look-ahead-safe replay using the existing Stage 1A market view
   and Stage 1B/1C engine; no next-candle access.
3. Selectable token universe (1–3 tokens), period (30/90/180 days ending at the
   latest closed candle), initial capital, seed and the same Stage 1B/1C
   settings form as live runs.
4. Data from `sandbox_candles` only; coverage/preflight blocks or warns before
   the replay can be created; a link refreshes the token data.
5. Persisted async worker with status/progress, restart recovery and one replay
   at a time under an advisory lock; the CPU-heavy replay runs in a worker
   thread so the API and the live runner keep their event loop.
6. Persisted report including metrics, equity curve, trades, intent journal and
   hindsight counterfactuals; JSON/Markdown download; `historical-paper` label.
7. Persist the exact compressed candle snapshot used by the replay so the same
   report can be re-derived after `sandbox_candles` is refreshed or the 180-day
   window rolls.
8. History list with owner isolation, status, result summary and archive.
9. Audit every mutation; no DELETE; feature flag and rollback; tests and a
   review gate.

### Non-goals

- Parameter optimization, mass search, walk-forward or strategy fitting. This
  is a deterministic replay of the same rules, not a research/optimizer tool.
- Real money, wallets, keys, signing, swaps or real-ledger writes.
- Old AI/`ai-trading`/`trading-bots`/search imports or `market_candles`/`ai_*`
  reads.
- New data providers or arbitrary historical ingestion beyond the existing
  180-day `sandbox_candles` window. The owner can refresh a token from the UI.
- Live-run changes, multi-timeframe decisions or 5m/15m replay. The replay is
  1h, matching Stage 1B/1C and the live runner.
- Comparing/merging replays automatically with live runs; Stage 3 will do that
  as a separate step.
- Push notifications, PDF export, scheduled replays or a separate worker
  service.

### Anti-goals

- A replay that can see candles after the decision bar.
- A replay that changes the live run's ledger, events, positions or reports.
- A "backtest" that silently optimizes parameters or uses hindsight in the
  decision path.
- Hiding data gaps, synthetic candles or stale history.

## 3. Approaches considered

### A. Synchronous preview, no persistence

A `POST /sandbox/replays/preview` runs the replay in the request and returns the
report; the UI shows it without saving history. Fast to build; no migration.
But 180 days × 3 tokens takes tens of seconds and risks proxy/HTTP timeouts;
there is no history or comparison; restart loses progress. Rejected for the
owner's stated use (compare results and later compare with Stage 3).

### B. Persisted asynchronous replay (chosen)

A new additive `sandbox_replays` table, owner-only API, a 60-second
advisory-locked worker with a worker thread for the CPU-heavy run, a persisted
compressed candle snapshot, and a `Исторический прогон` UI tab with history,
progress and report. More work (ADR + migration + worker + UI), but it matches
the sandbox's evidence/persistence model, supports 180 days and multiple tokens
without HTTP timeouts, survives restarts and keeps the exact replay input.

### C. Reuse `sandbox_runs` with `mode = historical`

Fewer tables, but would mix live and historical runs in statuses,
`last_bar_close`, reports, runner queries and UI semantics. High risk of
confusing the live runner and the owner. Rejected.

The owner picked **B**.

## 4. Architecture

```
apps/api/src/modules/sandbox/
  sandbox-replay.service.ts        create/list/detail/cancel/archive, owner scope, audit
  sandbox-replay-worker.service.ts 60 s interval + advisory lock, claim/run
  sandbox-replay.worker.ts         worker-thread entrypoint (CPU-heavy replay)
  sandbox-replay.repository.ts     Drizzle queries for sandbox_replays
  sandbox.controller.ts            owner-only replay endpoints
  sandbox.module.ts                register services
packages/contracts/src/sandbox.ts  replay request/response Zod schemas
packages/db/src/schema/index.ts    sandbox_replays table
packages/db/drizzle/0053_*.sql     additive migration + grants
packages/sandbox-core/src/paper/   reusable runPaperFromCandles + evaluateFrom (additive)
apps/web/src/features/sandbox/     replay tab, form, list, detail/report
```

The API imports `@nexter/sandbox-core` and the existing market-data clients are
not used by the replay (data is already in `sandbox_candles`). No old AI module
is imported.

### 4.1 Data flow

```
owner form -> POST /sandbox/replays (queued, audited)
           -> worker claims queued replay under advisory lock
           -> load sandbox_candles for the full data window and selected tokens
           -> snapshot/gzip the exact candles; POST to a worker thread
           -> worker thread: PaperRunner with evaluateFrom (ClockedMarketView)
           -> buildReport (Stage 1C) + executionMode historical-paper
           -> store report/snapshot/status/hashes, audit replay_completed
           -> UI polls detail -> equity/trades/intents/counterfactuals/report
```

There is no provider fetch in the replay path. If coverage is insufficient, the
form shows the coverage status and a link to `Токены песочницы` to refresh the
180-day window; the replay cannot be created until the requested period is
covered (or the owner accepts a shorter available window explicitly, matching
the live start preflight policy).

### 4.2 Look-ahead guarantee

The replay uses the same `ClockedMarketView(candles, SimulationClock(barClose),
snapshotId)` as Stage 1C. `candles(tokenId, timeframe, limit)` and `latest()`
use an upper bound on `closeTime <= clock.now()`, so a decision at bar `i` can
only see candles up to `i`; the next bar is not visible. Stage 1C executes the
decision at the next open (the same `PaperRunner` rules). The replay does not
pre-compute indicators over the full series outside the engine; it uses the
engine's own per-bar evaluation. A dedicated test mutates future candles and
asserts the earlier report/trades are unchanged.

### 4.3 Execution mode

The Stage 1C report is labelled `historical-paper` in the API wrapper (the core
`RunReport` type/hash is unchanged, as with the live `live-paper` wrapper). The
report states that decisions use only closed candles and that fills use the
next open; it is not a live exchange fill and not a performance claim.

### 4.4 Window, warmup and comparability (owner decision A)

The owner chose the **prepended-history** semantics:

- `to_time` is the latest common closed 1h candle across the selected tokens
  (the earliest of their latest closed candles, so every token has data at the
  end).
- The data window loaded for the engine is `[max(earliest available, to - 180
days), to]`. The store's 180-day window is the maximum.
- The **evaluation window** is `[to - periodDays, to]`. Prefix candles before
  `evaluateFrom` are supplied to the engine as history (for regimes, SMAs,
  ATR, strategy lookbacks) but are **not** evaluated, recorded in equity,
  traded, or included in the report period.
- `PaperRunner` gains an optional `evaluateFrom` (additive; default undefined
  keeps the current behavior and goldens). The market view still receives the
  full candle set; the loop starts at the first bar close at/after
  `evaluateFrom`, and `runStarted`/period/equity/trades begin there.
- For 30 and 90 days the prefix is large (150/90 days when the full store is
  available); for 180 days there is no prefix because the store is exactly 180
  days. The 180-day run's first ~169 bars are natural engine warmup; its last
  30/90 days are comparable with the 30/90-day runs' evaluated tails because
  all have the full 180-day history by that point.
- `dataSnapshotId` hashes the full input candle set (prefix + evaluation), and
  the report period contains only the evaluation window. The report notes the
  prefix length and the 180-day no-prefix case.

This is not a separate warmup simulation: prefix candles are lookback data, not
fake trades. The engine's state starts empty at `evaluateFrom`; the regime and
indicators see the prefix, while the ledger starts at the initial capital.

## 5. Schema

Additive migration `0053_sandbox_replays.sql`, no DELETE, no old tables. The
app role gets SELECT/INSERT/UPDATE on `sandbox_replays`; DELETE is revoked.
Before production apply: encrypted backup + restore check + SHA-256 and a
documented rollback (disable `SANDBOX_ENABLED`, revert the image; the table stays
inert).

`sandbox_replays`:

| Column                    | Type                 | Notes                                                                              |
| ------------------------- | -------------------- | ---------------------------------------------------------------------------------- |
| `id`                      | uuid pk              | default random                                                                     |
| `user_id`                 | uuid FK users        | owner, no cascade                                                                  |
| `name`                    | text                 | 1–80 chars                                                                         |
| `status`                  | text                 | `queued`, `running`, `completed`, `failed`, `cancelled` (archive is `archived_at`) |
| `token_keys`              | jsonb                | array of 1–3 sandbox token keys, frozen at create                                  |
| `period_days`             | integer              | 30, 90 or 180                                                                      |
| `from_time`               | timestamptz          | first evaluation candle open                                                       |
| `to_time`                 | timestamptz          | last evaluation candle close                                                       |
| `initial_capital_usd`     | numeric(18,2)        | > 0, 2 decimals                                                                    |
| `seed`                    | integer              | default 7                                                                          |
| `settings`                | jsonb                | Stage 1B decision settings                                                         |
| `paper`                   | jsonb                | Stage 1C paper settings                                                            |
| `report`                  | jsonb nullable       | full `RunReport`                                                                   |
| `report_hash`             | text nullable        | 64 hex                                                                             |
| `event_count`             | integer nullable     | from report                                                                        |
| `event_hash`              | text nullable        | 64 hex                                                                             |
| `data_snapshot_id`        | text nullable        | deterministic hash of the full input candle set                                    |
| `candle_snapshot`         | bytea nullable       | gzip(JSON) of the exact prefix + evaluation candles                                |
| `candle_snapshot_hash`    | text nullable        | SHA-256 of the uncompressed snapshot JSON                                          |
| `error`                   | text nullable        | sanitized failure                                                                  |
| `queued_at`               | timestamptz          |                                                                                    |
| `started_at`              | timestamptz nullable |                                                                                    |
| `finished_at`             | timestamptz nullable |                                                                                    |
| `archived_at`             | timestamptz nullable | soft hide                                                                          |
| `created_at`/`updated_at` | timestamptz          |                                                                                    |

Indexes: `(user_id, created_at)`, `(status, queued_at)`, `(user_id, archived_at)`.
No `sandbox_replay_events` in v1: the deterministic report (`eventCount`,
`eventHash`, report `intentJournal`, trades, counterfactuals) is stored and the
exact candle snapshot makes the input re-derivable; the full event chain is not
persisted to avoid a ~50 MB journal per replay. The snapshot + frozen
config/settings are the audit input; the report is the evidence. This
limitation is stated in the report/package.

## 6. API and contracts

Owner-only, same auth/2FA/CSRF/flag/no-store as the rest of sandbox. Every
mutation audits. Contracts live in `packages/contracts/src/sandbox.ts`.

```
POST   /api/v1/sandbox/replays            create queued replay (202)
GET    /api/v1/sandbox/replays            paginated owner list (status filter, includeArchived)
GET    /api/v1/sandbox/replays/:id        detail/status/report summary
GET    /api/v1/sandbox/replays/:id/report.json
GET    /api/v1/sandbox/replays/:id/report.md
POST   /api/v1/sandbox/replays/:id/cancel  queued only -> `cancelled` (409 otherwise)
POST   /api/v1/sandbox/replays/:id/archive terminal only
```

Create body: `name`, `tokenKeys` (1–3, canonical sandbox keys), `periodDays`
(30/90/180), `initialCapitalUsd` (decimal string), optional `seed`, `settings`,
`paper`, `allowPartial` (explicit warning acceptance). The API freezes the
resolved config, computes `to_time` from the latest common closed candle and
`from_time = to - periodDays`, checks the evaluation-window coverage (and the
available prefix), inserts `queued`, audits `sandbox.replay_created` and
returns the row. `allowPartial` means: if the full evaluation window is not
covered, accept a shorter available evaluation window (move `from_time`
forward) and record the actual window; missing candles with no usable window
still block. No manual buy/add; no token mutation.

Read responses use decimal strings; the report is wrapped as
`{ executionMode: 'historical-paper', report, notes }`, matching the live report
wrapper. `report.md` is `text/markdown; charset=utf-8`, no-store.

## 7. Worker

`SandboxReplayWorkerService` runs every 60 s (and once after a short boot delay)
under `pg_try_advisory_lock(hashtext('nexter:sandbox-replay-worker'))`, only when
`SANDBOX_ENABLED` and not `NODE_ENV=test`. It:

1. acquires the advisory lock; **only after the lock is held**, requeues any
   `running` row from a dead instance (no other worker can be executing under
   the same lock). A rolling deploy is safe because the old instance holds the
   lock until its run/connection ends; the new instance cannot sweep or claim
   until it acquires the lock.
2. claims the oldest `queued` replay with `FOR UPDATE SKIP LOCKED`, marks
   `running`, audits `sandbox.replay_started`;
3. loads the frozen token snapshot, the full data window, settings and
   evaluation start; validates coverage; snapshots/gzips the candles;
4. posts the snapshot/config to a **worker thread** (`sandbox-replay.worker.ts`)
   that runs the reusable `runPaperFromCandles` with `evaluateFrom` (extracted
   from the CLI; additive, goldens unchanged). The API event loop and the live
   runner stay responsive during the CPU-heavy run;
5. stores the report/hashes/snapshot and marks `completed`, audits
   `sandbox.replay_completed`; on a data/engine/report error marks `failed` with
   a sanitized message and audits `sandbox.replay_failed`;
6. releases the advisory lock. A worker-thread crash/exit marks the replay
   failed (or requeues once for an infrastructure exit, with a bounded attempt
   count).

One replay at a time; a 3-token 180-day run is expected to take ~1–2 minutes.
The worker is bounded (no infinite loops) and does not touch live runs. A queued
replay can be cancelled (`cancelled`); a running replay is bounded and is not
cancelled in v1.

## 8. UI

A new `Прогон` tab in `Песочница` (label `Исторический прогон` in the heading),
independent of `Запуски`:

- **Форма:** name, token multi-select from the owner universe (1–3), period
  preset 30/90/180 days, initial capital, `Дополнительные настройки` (the same
  Stage 1B/1C fields as the live form), coverage preflight with per-token
  available/required/gaps/stale/synthetic, `Обновить данные` link, `Запустить
прогон` (disabled until coverage is acceptable). Explicit warning acceptance
  for a partial window, matching live start.
- **История:** cards/rows with name, status, period, tokens, initial/final
  equity, return, max drawdown, created/finished; filter by status; archive.
- **Детали:** progress while queued/running (status, queued/started time,
  elapsed), then metrics cards, equity chart, per-strategy/per-token metrics,
  trades, intent journal with reason codes, counterfactuals/why-not, report
  identity (report hash, event count/hash, snapshot, config version), JSON/MD
  download, failed error, archive.
- Polling only while queued/running (e.g. 5 s); no polling for terminal rows.
- Russian/light, existing shared components, empty/loading/error states; no
  manual buy/add; no live-run mutation.

## 9. Data and coverage

- Source: `sandbox_candles` for the selected token keys, 1h only. No provider
  call in the worker.
- Window: `to_time` = earliest of the selected tokens' latest closed candles
  (a common end); data window = `[max(earliest available, to - 180 days), to]`.
  Evaluation window = `[to - periodDays, to]`. Prefix candles are history for
  the engine but are not part of the report period; see §4.4.
- Coverage is computed for the **evaluation window plus the available prefix**,
  not against the fixed 4320-bar whole-series formula. The gate reports
  per-token window available/required, first/last, gaps, prefix bars, synthetic
  and stale. A fully covered evaluation window is `ok` even if older history is
  missing; a gap inside the evaluation window is a block. `partial` requires
  explicit `allowPartial`, which accepts a shorter available evaluation window
  and records the actual `from_time`; `missing` (no usable window) blocks.
- The owner can refresh tokens from `Токены песочницы` (existing 180-day
  ingestion) before creating a replay.
- No fabricated candles; no fallback provider fetch inside the replay. The
  exact loaded snapshot (prefix + evaluation) is persisted and hashed.

## 10. Reports

- Reuse the Stage 1C `buildReport`/`renderMarkdown` over the replay result; the
  report is deterministic for the same candles/settings/seed and has the same
  `reportHash` semantics.
- Store the full `RunReport` JSONB, plus `report_hash`, `event_count`,
  `event_hash`, `data_snapshot_id`, the gzipped `candle_snapshot` and its
  uncompressed SHA-256. The snapshot is the exact prefix + evaluation candle
  set; re-running the same snapshot/config/seed must reproduce the report hash.
- Counterfactuals are included (unlike live reports) because the historical
  run has no future backfill; they are labelled `hindsight`, `usedForDecisions:
false`.
- The wrapper adds `executionMode: 'historical-paper'` and notes: 1h closed
  candles only, next-open fills, not a live/exchange fill, not a performance
  claim.
- The full event chain is not persisted; `eventCount`/`eventHash`, the frozen
  config and the persisted candle snapshot make the report re-derivable. This
  is an explicit v1 limitation (report + input, not the event rows).

## 11. Security and operations

- Owner-only; reuse auth/2FA/CSRF/rate limits; feature flag `SANDBOX_ENABLED`.
- Every mutation audits `sandbox.replay_*`; no DELETE; no secrets; no wallets,
  keys, signing or real money.
- No old AI/`market_candles`/`ai_*` imports; only `sandbox_candles`.
- Worker advisory lock; lock-gated stale recovery; worker thread for CPU;
  bounded report/snapshot size (max 3 tokens, 180 days); no new service.
- Migration `0053` additive; encrypted backup + restore check + SHA-256 before
  production; rollback: disable flag, stop queued/running replays, revert image;
  `sandbox_replays` stays inert.
- The report/snapshot contain market prices/trades, not sensitive secrets; the
  snapshot is owner-only and no-store.

## 12. Testing

- Contracts: create/detail/list/report parse; decimal strings; owner scope.
- Replay runner: deterministic report hash on the same input; a **look-ahead
  test** where future candles are mutated and earlier decisions/trades/equity
  are unchanged; a known 180-day golden fixture (reuse the Stage 1C fixture
  generator) with pinned hash; no next-candle access; `evaluateFrom` starts
  equity/trades at the evaluation window while prefix candles remain lookback.
- API: create/window coverage gate/allowPartial; queue; owner 404; cancel
  queued -> `cancelled`, 409 running; archive terminal; audit rows; flag off;
  no manual buy route.
- Worker: lock-gated claim/complete/fail; worker-thread run; restart recovery;
  stale running requeue only after the lock; one at a time; no duplicate
  report; report hash stable; snapshot/decrypt round-trip.
- UI: form validation, window coverage/refresh link, list/empty/error, progress
  polling, result metrics/equity/trades/intents/counterfactuals, downloads,
  failed/cancelled state, no manual buy/add.
- E2E: create replay with seeded `sandbox_candles` (prefix + evaluation),
  worker runs, detail/report match; restart continues; a mutated future candle
  does not change the report; re-running from the stored snapshot reproduces
  the report hash; owner isolation.
- Full gate: tests/typecheck/lint/format/build; Stage 1B/1C goldens unchanged.

## 13. Rollout and rollback

1. Encrypted backup + restore check + SHA-256.
2. Apply migration `0053` as the owner role; re-provision `nexter_app` (or
   verify the migration grants) — SELECT/INSERT/UPDATE, no DELETE.
3. Deploy with `SANDBOX_ENABLED=true`; verify `/health`, `/ready`, the replay
   routes (401 unauthenticated) and the UI tab.
4. Create a short replay with real `sandbox_candles` (e.g. 30 days) and verify
   the report/look-ahead; do not start a live run.
5. Rollback: set `SANDBOX_ENABLED=false`, revert the image; `sandbox_replays`
   is additive/inert. No restore is required for the migration.

## 14. Success criteria

1. The owner can create a 30/90/180-day replay for 1–3 tokens from the UI.
2. Coverage is explicit; missing data blocks; partial data requires acceptance.
3. The replay runs asynchronously, survives a restart and completes with a
   deterministic report.
4. The report/equity/trades/intents/counterfactuals match the Stage 1C engine
   and show no look-ahead; a future-candle mutation does not change earlier
   decisions.
5. History, detail, downloads, archive and owner isolation work; every
   mutation is audited; no DELETE/real-money/old-AI path.
6. Independent review clean; owner accepts the Stage 2.1 report; migration
   applied with backup/rollback; deployed and verified.

## 15. Decisions from the builder check

- **Warmup:** owner chose A. Prefix candles are lookback history; the
  evaluation window starts at `from_time`; 30/90/180 are comparable at the tail;
  180 has no prefix because the store is 180 days.
- **Coverage:** window-specific, not the whole-series 4320 formula. A gap in the
  evaluation window blocks; `allowPartial` accepts a shorter available
  evaluation window and records the actual period.
- **CPU:** the replay runs in a worker thread, not on the API event loop. The
  live runner and HTTP server stay responsive.
- **Cancel:** `cancelled` is a first-class status; only queued replays can be
  cancelled. Running replays are bounded and completed in v1.
- **Reproducibility:** owner chose to persist the exact gzipped candle snapshot
  plus its hash; the stored report is re-derivable after refresh.
- **Stale recovery:** only after acquiring the worker advisory lock; a rolling
  deploy cannot requeue a still-running replay held by another instance.

## 16. Open questions

- The report JSONB + candle snapshot for 3 tokens × 180 days may be several MB;
  if it exceeds a practical row size, store a compressed report or cap to 2
  tokens. Measure in implementation.
- Arbitrary `from`/`to` dates: v1 uses 30/90/180 presets because the store is
  180 days; arbitrary dates can be added later.
- Stage 3 will compare replay results with the forward run; this design only
  stores the replay report/snapshot for that future comparison.
- The full event chain is not persisted; if a later audit needs row-level
  replay, add an explicit compressed event artifact.
