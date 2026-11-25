# Sandbox Stage 2.1 — historical replay review request

Date: 2026-11-25
Branch: `feat/sandbox-replay`
Base: `3a6f94a` (Stage 2 merged, signed off, accepted and deployed; migration `0052` applied)
Docs base: `f1ac808` (design, ADR 0085, plan)
Frozen code head: `a040e4b` (Tasks 1–7; CI status below) plus this Task 8 docs/packet commit
Status: **Stage 2.1 implemented; independent whole-branch review gate. Not deployed; migration `0053` is not applied.**

Review this as one whole-branch Stage 2.1 review. The scope is paper only: no
real money, exchange orders, wallets, keys, signing or real-ledger writes.

## Scope

- Owner-only `Прогон` tab (`/sandbox#replay`) in `Песочница`, independent of live `Запуски`.
- New additive `sandbox_replays` table (migration `0053`), separate from live runs and old AI tables.
- Historical replay of the existing Stage 1C engine over stored `sandbox_candles`:
  - additive `PaperRunner.evaluateFrom` and reusable `runPaperFromCandles`;
  - 1–3 tokens, 30/90/180-day evaluation window, 180-day lookback store;
  - next-bar-open paper fills with the existing fees/slippage/liquidity rules.
- Window-specific coverage preflight, explicit `allowPartial`, data refresh through the existing token universe.
- 60-second replay worker under an advisory lock; CPU-heavy run in a Node worker thread; lock-gated restart recovery.
- Persisted report, report/event hashes and the exact gzipped candle snapshot (SHA-256), so a report is re-derivable after the candle store refresh rolls.
- Owner API (8 routes), history/detail UI, progress polling, JSON/Markdown downloads, cancel queued / archive terminal.
- Audit (`sandbox.replay_*`), feature flag, no DELETE, no manual buy/add, runbook and rollback.

## Out of scope

- Real money, exchange execution, wallets, keys, signing, swaps, real ledger.
- Old AI/`ai-trading`/`trading-bots`/search imports or `ai_*`/`market_candles` reads.
- Parameter optimization, mass search, walk-forward, strategy fitting or Stage 1B/1C rule changes.
- Live-run mutation; multi-timeframe or 5m/15m replay; arbitrary dates.
- Notifications, PDF, scheduled replays, a separate worker service, event-row persistence.
- Production migration apply or deploy (explicitly deferred to owner approval).

## Tasks and commits

| Task | Scope                                                   | Commits                         | Review                           |
| ---- | ------------------------------------------------------- | ------------------------------- | -------------------------------- |
| Docs | Design, ADR 0085, plan, plan fixes                      | `f1ac808`, `ea49aae`, `7b3a85a` | n/a                              |
| 1    | `evaluateFrom`, `runPaperFromCandles`, CLI reuse        | `34c26c8`                       | complete                         |
| 2    | `sandbox_replays` schema, migration `0053`, grants      | `19872f3`                       | complete                         |
| 3    | Contracts, window coverage, repository, service, routes | `2d66475`, `1d74a4f`            | complete                         |
| 4    | Worker thread executor, replay worker, lock, restart    | `cefb815`                       | complete                         |
| 5    | Persisted report read/download endpoints                | `d76aee3`                       | complete                         |
| 6    | API e2e, look-ahead, snapshot re-derivation, restart    | `1cb74cc`                       | complete (DB-gated CI)           |
| 7    | `Прогон` UI tab, form, history, detail, downloads       | `a040e4b`                       | complete                         |
| 8    | Full gate, security/ops evidence, runbook, this packet  | this commit                     | **awaiting whole-branch review** |

Branch diff from `3a6f94a` through `a040e4b`: 64 files, +23,897/−180. Of that,
`packages/db/drizzle/meta/0053_snapshot.json` is the 12,207-line generated
Drizzle snapshot; excluding it the hand-written diff is 63 files, +11,689/−180.
The Task 8 commit adds documentation and two static security assertions only. No
production data or configuration was changed.

## Commands and outputs

| Command                         | Result                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx pnpm@10.20.0 test`         | **exit 0**. `@nexter/contracts` 60 passed (5 files); `@nexter/sandbox-core` 560 passed (39 files, includes the unchanged Stage 1B/1C goldens); `@nexter/db` 1 passed; `apps/web` 315 passed (47 files); `@nexter/api` **548 passed / 159 skipped** (79 files passed / 25 skipped) in 541 s. Total 1,484 passed; the 159 skips are Postgres-gated/opt-in suites. |
| `npx pnpm@10.20.0 typecheck`    | **exit 0**; config, contracts, sandbox-core, db, ui, e2e and web pass; API runs `tsconfig.json` **and** `tsconfig.test.json`, so `apps/api/test/**/*.ts` is type-checked.                                                                                                                                                                                       |
| `npx pnpm@10.20.0 build`        | **exit 0**; web (31.98 s), sandbox-core, db, contracts and API (`nest build`) build. Existing Vite chunk-size warning only (`core` 587 kB, `index` 1,837 kB).                                                                                                                                                                                                   |
| `npx pnpm@10.20.0 lint`         | **exit 0**; ESLint clean.                                                                                                                                                                                                                                                                                                                                       |
| `npx pnpm@10.20.0 format:check` | **exit 0** after Prettier formatted this packet and the runbook; “All matched files use Prettier code style!”.                                                                                                                                                                                                                                                  |
| Focused security/flag tests     | **17/17 passed** (`sandbox-isolation.spec.ts`, `sandbox.disabled.spec.ts`, `sandbox.module.spec.ts`), including the new replay lock/lock-gated-requeue, replay-only candle repository and replay-worker flag assertions. After the final test-file rename/assertion the two changed specs were re-run: **11/11 passed**.                                        |
| Stage 1B/1C goldens             | Included in the 560 sandbox-core tests; hashes unchanged.                                                                                                                                                                                                                                                                                                       |
| DB-gated replay suites          | **Skipped locally** (no PostgreSQL/Docker in this workspace); CI is the first real execution. See the list below.                                                                                                                                                                                                                                               |

## Schema, migration and grants

Migration `packages/db/drizzle/0053_sandbox_replays.sql` is **additive and
unapplied** in production. It creates only `sandbox_replays`:

- `id` uuid PK default random; `user_id` uuid FK `users.id` `ON DELETE restrict`;
  `name` text (1–80); `status` text default `queued` with check
  `queued|running|completed|failed|cancelled`; `token_keys` jsonb (array 1–3);
  `period_days` integer check `30|90|180`; `from_time`/`to_time` timestamptz;
  `initial_capital_usd` `numeric(18,2)` with `> 0`; `seed` integer default 7;
  `settings`/`paper` jsonb; `report` jsonb nullable; `report_hash`,
  `event_hash`, `data_snapshot_id`, `candle_snapshot_hash` text nullable;
  `event_count` integer nullable; `candle_snapshot` bytea nullable; `error` text;
  `queued_at`/`created_at`/`updated_at` not null; `started_at`/`finished_at`/
  `archived_at` nullable.
- Indexes: `(user_id, created_at)`, `(status, queued_at)`, `(user_id, archived_at)`.
- No `sandbox_replay_events` in v1; the report, hashes and exact snapshot are the evidence.
- Grants: `SELECT, INSERT, UPDATE` to `nexter_app`, `REVOKE DELETE` (the migration
  repeats the revoke inside a `pg_roles` guard; `provision-app-role.mjs` is
  authoritative and lists `sandbox_replays` in its delete-revoke and delete-check sets).
- The generated `0053_snapshot.json` and `_journal.json` chain are committed;
  `sandbox.migration.spec.ts` asserts the table/columns/indexes/SQL/grants and the
  journal index 53.
- DB-gated `sandbox-schema.e2e.spec.ts` asserts the table, indexes, `numeric(18,2)`
  and the **runtime** `nexter_app` privileges, including `DELETE = false`.

## Migration backup and rollback

Migration `0053` is not applied. Production apply order (owner approval required):

1. Encrypted backup + restore check + plaintext/encrypted SHA-256.
2. `node packages/db/dist/migrate.js` with `MIGRATION_DATABASE_URL` (owner role, never `nexter_app`).
3. `pnpm db:provision-app` and verify `\dp sandbox_replays` (`SELECT/INSERT/UPDATE`, no DELETE).
4. Deploy with `SANDBOX_ENABLED=true`; verify `/health`, `/ready`, an unauthenticated
   replay route `401`, the `Прогон` tab, and one short real replay.
5. Rollback: `SANDBOX_ENABLED=false` and redeploy (stops the replay worker and the
   live runner), revert the image if needed. `sandbox_replays` is additive and inert
   with no rows created by the migration; do not restore the database for it.

The table must exist before the code is deployed: with the flag on and the table
missing, each worker pass logs a claim failure and retries without crashing.

## Data, coverage and warmup

- Source: `sandbox_candles`, 1h only, 1–3 owner tokens. No provider call in the replay path.
- `to_time` = the earliest latest closed 1h candle across the selected tokens plus
  one bar (that candle's close); every token has data at the end.
- Evaluation window `[to_time − periodDays, to_time)`: exactly 720/2160/4320 bars
  for 30/90/180 days.
- Data window `[to_time − 180 days, to_time)`; candles before `from_time` are
  lookback prefix only. They feed regimes/SMAs/ATR but are not evaluated, traded,
  recorded in equity or counted in the report period. A full 180-day request has
  no prefix because the store is exactly 180 days.
- Coverage is window-specific: per token available/required, prefix bars, gaps,
  synthetic, stale (`ok|partial|missing`). A gap inside the evaluation window or
  no candles blocks creation; `allowPartial` accepts a shorter available window
  (latest first candle across tokens) with at least 240 evaluation bars and
  records the actual `from_time`/window. Staleness is per token.
- Synthetic (CoinGecko) candles are flagged, not hidden; missing data never
  fabricates candles.
- The snapshot is prefix + evaluation candles, sorted, gzip-compressed and hashed
  (SHA-256 over canonical JSON = `data_snapshot_id`).

## No-look-ahead and fill semantics

- The replay uses the Stage 1C `ClockedMarketView` + `SimulationClock`; a query at
  bar `i` is bounded by `closeTime <= now`, so the next candle is never visible.
- `evaluateFrom` starts the loop at the first bar whose **open** is at or after
  `from_time`; `runStarted`, the report period, equity and trades start there.
  A missing bar at/after `evaluateFrom` raises `PAPER_EVALUATE_FROM_OUT_OF_RANGE`.
- A decision on closed bar `i` fills at the open of bar `i+1` with the frozen fee
  and slippage; a decision on the last bar is ignored (no next open); the
  end-of-window force-close remains.
- Core tests: prefix-vs-evaluation boundary, `evaluateFrom` out of range, mutated
  future candles leave earlier decisions unchanged, and the Stage 1B/1C goldens
  are unchanged when `evaluateFrom` is absent.
- API e2e inserts 48 hostile bars after `to_time` and asserts the stored report is
  unchanged; it also re-derives the report from the persisted gzip snapshot and
  asserts identical `reportHash`, event hash, metrics, trades, equity, intents and
  counterfactuals. (DB-gated; CI is the first execution.)
- The report is labelled `historical-paper` and states that it is simulated,
  next-open, not a live/exchange fill and not a performance claim.

## Worker thread, lock and restart

- `SandboxReplayWorkerService`: 60-second interval, first pass after 15 seconds,
  only when `SANDBOX_ENABLED` and `NODE_ENV !== 'test'`; tests call `runOnce`.
- `pg_try_advisory_lock(hashtext('nexter:sandbox-replay-worker'))` is held for the
  whole claim → snapshot → run → store cycle and released in `finally`; an
  in-process `running` flag prevents overlap in one instance.
- After the lock: requeue every `running` row (audited `sandbox.replay_requeued`),
  then claim the oldest `queued` row with `FOR UPDATE SKIP LOCKED`, mark `running`
  and audit `sandbox.replay_started`.
- A requeued row reuses its stored snapshot instead of reloading candles; a
  missing/corrupt snapshot hash fails closed (`REPLAY_SNAPSHOT_INVALID`).
- The snapshot is read/gzipped/hashed and persisted **before** execution; the
  report identity (`runId`, `dataSnapshotId`) is checked against the claim.
- The CPU-heavy run is delegated to `sandbox-replay.worker.js` with a 15-minute
  hard bound; a worker error, non-zero exit, timeout or malformed message marks
  the replay `failed` with a sanitized (≤1000 chars) message and audits
  `sandbox.replay_failed`. The API event loop and live runner stay responsive.
- A cancelled-between-claim-and-start row is skipped; a concurrent state change
  during snapshot storage leaves the row for the next pass rather than publishing
  a mismatched report.
- One replay at a time: a second queued replay waits for the next 60-second pass.
- Running replays are bounded by the thread timeout and are not cancellable in v1.

## API and UI inventory

API (owner auth/2FA/CSRF + `SandboxEnabledGuard` + no-store):

```
POST /api/v1/sandbox/replays/preflight
POST /api/v1/sandbox/replays                 202, queued
GET  /api/v1/sandbox/replays                 filter status/includeArchived, limit/offset
GET  /api/v1/sandbox/replays/:id
GET  /api/v1/sandbox/replays/:id/report.json  historical-paper wrapper
GET  /api/v1/sandbox/replays/:id/report.md    text/markdown; charset=utf-8
POST /api/v1/sandbox/replays/:id/cancel      queued only, 409 otherwise
POST /api/v1/sandbox/replays/:id/archive     terminal only, 409 otherwise
```

Errors: `SANDBOX_REPLAY_NOT_FOUND` (404, owner-scoped), `…_COVERAGE_MISSING`,
`…_WINDOW_TOO_SHORT`, `…_CAPITAL_INVALID`, `…_TOKEN_NOT_FOUND`,
`…_INVALID_STATUS`, `…_STATE_INVALID`, `…_NOT_COMPLETED` (409). No manual buy/add route.

UI (`Прогон` tab, `#replay`):

- Form: name, 1–3 tokens, 30/90/180 days, capital (default 1000), seed, the Stage
  1B/1C advanced settings, preflight coverage cards (available/required, prefix,
  gaps, stale, synthetic), `Обновить данные` link, blocked creation on
  missing/blocked data, explicit partial-window confirmation.
- History: rows with name/status/period/tokens/final equity/return/drawdown/times,
  status filter, cancel/archive with the shared `ConfirmDialog`, empty/loading/error.
- Detail: queued/running progress; completed metrics, equity chart, trades, intent
  journal, counterfactuals, report identity (hashes/snapshot/config version),
  JSON/Markdown downloads; failed error; cancelled state. Polling is 5 s only
  while queued/running, none for terminal rows.
- No manual buy/add, no live-run controls, no placeholders.

## Audit and security evidence

- Every mutation audits: `sandbox.replay_created`, `replay_started`,
  `replay_completed`, `replay_failed`, `replay_cancelled`, `replay_archived`,
  `replay_requeued`. Started/completed rows carry `executionMode:
'historical-paper'`, hashes and the window. E2e asserts the exact sorted action
  rows per flow (create→start→complete→archive, cancel, requeue→complete).
- Owner isolation: a second owner gets `404` for detail and report; a
  non-completed report is `409`; the worker internal read is not exposed over HTTP.
- Unauthenticated: all 8 replay routes return `401 AUTH_REQUIRED` (DB-free e2e).
- Feature flag: with `SANDBOX_ENABLED=false`, `GET /replays` and preflight return
  `404 SANDBOX_DISABLED`; static tests assert all 31 guarded routes, and that both
  the live runner and the replay worker bootstrap exit when the flag is off.
- Static isolation (`sandbox-isolation.spec.ts`): no old-AI/trading-bot imports,
  no `market_candles`/`ai_*`/`trading_bots`/`bot_backtest_runs` references, no
  wallet/key/signing terms, no `.delete(`/`delete from`, and the replay worker has
  its own released advisory lock with lock-gated requeue. The replay repository
  reads only `sandboxCandles` and imports no provider client.
- No DELETE grant/code path; archive is a soft `archived_at`. No secrets, keys,
  seed phrases or signing in the module. No real money or ledger writes; the
  replay uses an in-memory event log and the report only.
- The candle snapshot/report are owner-only and `no-store` (server headers and e2e
  `cache-control: no-store`).
- Task 8 added only two static assertions: the replay lock/lock-gated requeue and
  the replay-only candle repository, plus the replay worker flag gate.

## Tests and evidence

- **Core (560 tests):** `run-paper.test.ts` covers deterministic report/event
  hashes, the evaluation start at `evaluateFrom` with prefix lookback, mutated
  future candles leaving earlier decisions unchanged, out-of-range rejection,
  final marks and open-position marking. `paper-runner.test.ts` adds the
  `evaluateFrom` boundary, next-open fills, partial fills, stop cooldown, expiry
  and state pass-through. The Stage 1B/1C goldens are unchanged.
- **Contracts (60 tests, 25 in `sandbox.test.ts`):** replay create/preflight/list/
  detail/report schemas, period/status enums, decimal strings, hash regexes and
  owner-facing shapes.
- **API unit (69 replay-specific tests):** `sandbox-replay.coverage.spec.ts` (9:
  common end, bars/gaps/prefix, `allowPartial` move, 240-bar floor, empty/missing,
  synthetic/stale), `sandbox-replay.service.spec.ts` (22: defaults/freeze,
  audit, owner 404, cancel/archive states, list filters, partial window),
  `sandbox-replay.executor.spec.ts` (16: worker success/error/exit/timeout,
  snapshot gzip/hash, corrupt snapshot, candle assertion, settings mapping),
  `sandbox-replay-worker.service.spec.ts` (14: lock held → no claim/no requeue,
  lock-gated requeue, claim→run→complete, failure sanitization, cancel race,
  snapshot reuse, transient claim failure, no double run, report identity) and
  `sandbox-replay-report.service.spec.ts` (8: wrapper/notes, 409 non-completed,
  owner 404, corrupt report). The module/flag/isolation suites add 17.
- **Web (57 replay-specific tests):** form validation/preflight blocking/partial
  confirmation (6), helpers/status labels/tones (18), API URLs/parsing/download
  filename (12), list SSR states (7), detail SSR/progress/metrics/failed (10) and
  tab/hash (4), plus the existing sandbox boundary check (no old AI/manual buy).
- **API e2e (DB-gated, 7 tests in `sandbox-replays.e2e.spec.ts`):** the 401 route
  test runs without Postgres; the six DB tests cover preflight→create→worker→
  detail/report/wrapper/metrics, snapshot re-derivation with an exact report hash,
  48 hostile future bars not changing the report, cancel/archive transitions and
  exact audit rows, restart requeue only after the lock completes once, and
  cross-owner 404. **CI is their first execution.**
- **Schema/migration:** static `sandbox.migration.spec.ts` asserts the table,
  columns, indexes, SQL grants/revoke, journal index 53 and snapshot; the DB-gated
  `sandbox-schema.e2e.spec.ts` asserts tables/indexes/`numeric(18,2)` and the
  runtime `nexter_app` `SELECT/INSERT/UPDATE`, `DELETE = false`.
- **Flag-off:** `sandbox-disabled.e2e.spec.ts` asserts `/replays` and preflight
  `404 SANDBOX_DISABLED` with the flag off; the unit suite asserts the guard and
  that the replay worker bootstrap exits.

DB-gated suites (CI): `sandbox-schema`, `sandbox-tokens`, `sandbox-candles`,
`sandbox-status`, `sandbox-event-log`, `sandbox-run-store`, `sandbox-projections`,
`sandbox-live-runner`, `sandbox-run-lifecycle`, `sandbox-read`, `sandbox-disabled`,
`sandbox-replays` and `sandbox.e2e`.

Unverified in this environment (explicit):

1. All Postgres-gated suites, including the replay e2e, worker restart and
   look-ahead mutation; no local Postgres/Docker. CI is the first run.
2. Browser/manual staging verification of the `Прогон` tab and downloads; SSR
   render tests and API contract tests cover the states, but no browser was run.
3. Production migration `0053`, deploy and a real production replay; not applied,
   no production access was used.
4. Report/snapshot row size at the 3-token × 180-day maximum (small fixtures only).

## Deferred items (recorded, not blocking Stage 2.1)

- **Connection-loss split brain (no claim stamp).** If the API process stays
  alive but its Postgres connection drops mid-run, the session advisory lock is
  released; another instance could requeue/re-run the row while the first worker
  thread is still computing. The first instance can only store while the row is
  `running` and may lose the race. A `worker_id`/claim-token column would harden
  this; the design accepts lock-until-connection-end semantics.
- **No attempt bound/backoff.** `requeueRunningReplays` requeues _every_
  `running` row on the first pass after the lock. A deterministic failure becomes
  `failed`, and a worker-thread crash is marked `failed` (not requeued), but an
  infrastructure exit can be retried every pass with no max-attempt column.
- **Snapshot staging runs on the API event loop.** Loading rows, canonical JSON,
  gzip and SHA-256 happen before the worker thread starts. For ≤3×180 days this is
  short but not off-loop; moving staging into the worker would need the raw rows
  passed across the thread.
- **One claim per 60-second pass.** Multiple queued replays run sequentially and
  each can wait up to a minute; no batch drain.
- **Report body is not re-hashed on read.** The read service checks schema and the
  identity columns (`runId`, `reportHash`, `dataSnapshotId`, `eventCount`,
  `eventHash`) against the row but does not recompute `reportHash` from the JSONB
  body. Tampering that keeps those columns consistent is out of the threat model.
- **No persisted prefix-length column.** The prefix is derivable from the snapshot
  and the first candle; notes state “up to 180 days”, but there is no explicit
  `prefix_bars` field on the row/report period.
- **Report + snapshot row size is unmeasured at the 3×180-day maximum.** The
  design (§16) flags a few MB; fixtures are small. Measure on the first
  production replay and cap tokens/compress the report if needed.
- **Full event journal not persisted** (design choice): only `eventCount`/
  `eventHash`; row-level event audit would need a separate compressed artifact.
- **UI history is a fixed 50-row list** with a status filter only; no pagination,
  search or sort.
- **Preflight→create race.** Coverage can change between the UI preflight and the
  POST; the server re-checks and returns `409`, which the UI surfaces, but the
  stale preflight is not automatically refreshed and re-confirmed.
- **Running replay cannot be cancelled**; bounded by the 15-minute thread timeout.
- Only 30/90/180-day presets (no arbitrary dates), 1–3 tokens, 1h only.
- No notifications, PDF or scheduled replays.
- **Generated `bytea` quoting.** Drizzle-kit emitted `"candle_snapshot" "bytea"`;
  the committed SQL uses unquoted `bytea` and `db:generate` reports no drift. A
  future regeneration of an unrelated alter on this column should be re-checked.
- The migration `0053` production apply and deploy are intentionally not done.

## Gate

**Production migration `0053` and deploy only after the independent whole-branch
review is clean and the owner explicitly approves, with the encrypted backup,
restore check, SHA-256 and rollback above recorded.**

**Stage 3 (4–8 week forward paper run) remains blocked until Stage 2 is accepted
and this Stage 2.1 historical replay is also accepted.** Real money remains a
separate Stage 4 product/security/legal decision.

Requested review:

1. `0053` schema/grants and additive safety; no DELETE.
2. Look-ahead boundary, `evaluateFrom` warmup and next-open fills.
3. Snapshot/report reproducibility and the report read path.
4. Worker lock, worker thread, restart/requeue and fail-closed behavior.
5. Owner isolation, audit, flag-off behavior and no real-money/manual-buy path.
6. UI truth (queued/running/failed/cancelled vs completed) and runbook accuracy.
