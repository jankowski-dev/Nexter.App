# Sandbox Stage 2.1 — historical replay review request

Date: 2026-11-25
Branch: `feat/sandbox-replay` (pushed; draft PR #325, base `main`)
Base: `3a6f94a` (Stage 2 merged, signed off, accepted and deployed; migration `0052` applied)
Docs base: `f1ac808` (design, ADR 0085, plan)
Frozen code head: `fcd2f77` (Tasks 1–7 plus the Markdown-report 404 fix)
Docs/fix head: `3711752` (the evidence corrections); the final commit only records CI status.
CI: draft PR #325. Run `45537895046` at `ad46db4` failed on the Markdown 404; `45540307264` at `fcd2f77` **passed**; run `45542727298` at `3711752` (the docs/fix evidence commit) was in progress at packet update. This final commit only records that status and changes no code (see `CI evidence`).
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

| Task | Scope                                                   | Commits                          | Review                           |
| ---- | ------------------------------------------------------- | -------------------------------- | -------------------------------- |
| Docs | Design, ADR 0085, plan, plan fixes                      | `f1ac808`, `ea49aae`, `7b3a85a`  | n/a                              |
| 1    | `evaluateFrom`, `runPaperFromCandles`, CLI reuse        | `34c26c8`                        | complete                         |
| 2    | `sandbox_replays` schema, migration `0053`, grants      | `19872f3`                        | complete                         |
| 3    | Contracts, window coverage, repository, service, routes | `2d66475`, `1d74a4f`             | complete                         |
| 4    | Worker thread executor, replay worker, lock, restart    | `cefb815`                        | complete                         |
| 5    | Persisted report read/download endpoints                | `d76aee3`, `fcd2f77`             | complete                         |
| 6    | API e2e, look-ahead, snapshot re-derivation, restart    | `1cb74cc`                        | complete (DB-gated CI)           |
| 7    | `Прогон` UI tab, form, history, detail, downloads       | `a040e4b`                        | complete                         |
| 8    | Full gate, security/ops evidence, runbook, this packet  | `ad46db4` + this docs/fix commit | **awaiting whole-branch review** |

Branch diff from `3a6f94a` through the frozen code head `fcd2f77`: 68 files,
+24,549/−208 across 14 commits. Of that,
`packages/db/drizzle/meta/0053_snapshot.json` is the 12,208-line generated
Drizzle snapshot; excluding it the hand-written code diff is 67 files,
+12,341/−208. `ad46db4` added the docs/packet and two static security
assertions; `fcd2f77` added the Markdown-report error path fix (2 module tests, 1
live-read e2e test). This docs/fix commit adds **no new files** — it corrects
documentation and adds one executor timeout test plus a stricter lock assertion
— so the PR remains **68 files across 15 commits**, and the code under review is
exactly `fcd2f77`. No production data or configuration was changed.

## Commands and outputs

| Command                         | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx pnpm@10.20.0 test`         | **exit 0** at `ad46db4` (full suite). `@nexter/contracts` 60 passed (5 files); `@nexter/sandbox-core` 560 passed (39 files, includes the unchanged Stage 1B/1C goldens); `@nexter/db` 1 passed; `apps/web` 315 passed (47 files); `@nexter/api` **550 passed / 159 skipped** (79 files passed / 25 skipped). Total **1,486 passed**; the 159 skips are Postgres-gated/opt-in suites. The earlier 548/1,484 reading was a pre-final run. `fcd2f77` adds 3 API tests (2 module, 1 live-read e2e) and this fix adds 1 executor timeout test; those were run focused and are green, and CI runs the full suite at the final head. |
| `npx pnpm@10.20.0 typecheck`    | **exit 0**; config, contracts, sandbox-core, db, ui, e2e and web pass; API runs `tsconfig.json` **and** `tsconfig.test.json`, so `apps/api/test/**/*.ts` is type-checked.                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `npx pnpm@10.20.0 build`        | **exit 0**; web (31.98 s), sandbox-core, db, contracts and API (`nest build`) build. Existing Vite chunk-size warning only (`core` 587 kB, `index` 1,837 kB).                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `npx pnpm@10.20.0 lint`         | **exit 0**; ESLint clean.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `npx pnpm@10.20.0 format:check` | **exit 0** after Prettier formatted this packet and the runbook; “All matched files use Prettier code style!”.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Focused replay tests            | **63/63 passed** at the fix head: coverage 9, service 21, executor **11** (now includes `REPLAY_WORKER_TIMEOUT`), worker 14, report 8. At `fcd2f77` before the timeout test it was 62/62.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Focused security/flag tests     | **19/19 passed** (`sandbox-isolation.spec.ts` 9, `sandbox.disabled.spec.ts` 2, `sandbox.module.spec.ts` 8), including the replay lock/lock-gated-requeue guard-vs-call-site assertion, replay-only candle repository and replay-worker flag assertions. It was 17/17 before `fcd2f77` added the two Markdown-route module tests.                                                                                                                                                                                                                                                                                              |
| Stage 1B/1C goldens             | Included in the 560 sandbox-core tests; hashes unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| DB-gated replay suites          | **Skipped locally** (no PostgreSQL/Docker in this workspace); CI is the first real execution. See the list below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

### CI evidence (PR #325, base `main`, head `feat/sandbox-replay`)

| Run           | Head      | Result                                                                                                                                                                                                                                                                     |
| ------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `45537895046` | `ad46db4` | **Failed** — 1 failure in `sandbox-replays.e2e` owner isolation: a foreign `report.md` returned `500` instead of `404` (route-level Markdown `Content-Type` serialized the JSON error).                                                                                    |
| `45540307264` | `fcd2f77` | **Passed** (completed 2026-11-25T03:39Z). `fcd2f77` fixes both Markdown routes (live and replay) by setting the content type only after a successful read and adds the live 404 test. The DB-gated suites ran here for the first time.                                     |
| `45542727298` | `3711752` | **In progress** at packet update (docs/fix evidence commit). It changes docs, one executor test (`REPLAY_WORKER_TIMEOUT`), the lock-gating assertion and removes a dead repository helper; the local focused/gate runs are green. The final commit only records CI status. |

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
  records the actual `from_time`/window. Staleness is computed per token from the
  windowed stats and is warning-only (see Deferred items).
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
- Core tests assert the report/equity/ledger start at `evaluateFrom` (no
  pre-window ledger rows), `evaluateFrom` out of range is rejected, and mutating
  candles after a boundary leaves earlier decisions unchanged; the Stage 1B/1C
  goldens are unchanged when `evaluateFrom` is absent. They do **not** prove that
  an indicator (SMA/ATR/regime) actually consumed the pre-window prefix; that
  remains a recorded test gap (see Deferred items).
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
  The timeout path is asserted by a focused executor test (`REPLAY_WORKER_TIMEOUT`,
  worker terminated); a thread crash/timeout is marked `failed`, not requeued.
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

Errors and statuses: `SANDBOX_REPLAY_NOT_FOUND` 404 (owner-scoped);
`SANDBOX_REPLAY_TOKEN_NOT_FOUND` **400** (unknown/foreign token key is an invalid
request, matching the live-run `requireUniverse` convention);
`…_COVERAGE_MISSING`, `…_WINDOW_TOO_SHORT`, `…_CAPITAL_INVALID`, `…_INVALID_STATUS`,
`…_STATE_INVALID`, `…_NOT_COMPLETED` 409; Zod validation 400. No manual buy/add route.

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
  `replay_requeued`. `replay_started` carries `executionMode:
'historical-paper'`, the window and seed but **no hashes** (they do not exist
  yet); `replay_completed` carries `reportHash`, `eventHash`, `eventCount`,
  `dataSnapshotId`, `candleSnapshotHash` and `executionMode`. E2e asserts the
  exact sorted action rows per flow (create→start→complete→archive, cancel,
  requeue→complete).
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
- Every replay route sets `Cache-Control: no-store` statically (controller
  header). The DB e2e asserts it on `report.json`; the module suite asserts both
  Markdown report routes; list/detail rely on the same controller decorator and
  have no dedicated header assertion. There is no snapshot HTTP route.
- `ad46db4` added only two static assertions: the replay lock/lock-gated requeue
  and the replay-only candle repository, plus the replay worker flag gate.
  `fcd2f77` added two module tests for the Markdown error path (JSON errors keep
  their status) and this fix tightens the lock assertion to the actual call site.

## Tests and evidence

- **Core (560 tests):** `run-paper.test.ts` covers deterministic report/event
  hashes, the report period/equity/ledger starting at `evaluateFrom`, mutated
  future candles leaving earlier decisions unchanged, out-of-range rejection,
  final marks and open-position marking; `paper-runner.test.ts` adds the
  `evaluateFrom` boundary, next-open fills, partial fills, stop cooldown, expiry
  and state pass-through. Neither asserts that an indicator consumed the prefix
  candles (deferred). The Stage 1B/1C goldens are unchanged.
- **Contracts (60 tests, 34 in `sandbox.test.ts`):** replay create/preflight/list/
  detail/report schemas, period/status enums, decimal strings, hash regexes and
  owner-facing shapes. (`sandbox.test.ts` has 25 `it` blocks; two `it.each`
  tables expand to 34 cases.)
- **API unit (63 replay-specific tests at the fix head; 62 at `fcd2f77`):**
  `sandbox-replay.coverage.spec.ts` (9: common end, bars/gaps/prefix,
  `allowPartial` move, 240-bar floor, empty/missing, synthetic/stale),
  `sandbox-replay.service.spec.ts` (21: defaults/freeze, audit, owner 404,
  cancel/archive states, list filters, partial window),
  `sandbox-replay.executor.spec.ts` (11: worker success/error/exit/**timeout**,
  snapshot gzip/hash, corrupt snapshot, candle assertion, settings mapping),
  `sandbox-replay-worker.service.spec.ts` (14: lock held → no claim/no requeue,
  lock-gated requeue, claim→run→complete, failure sanitization, cancel race,
  snapshot reuse, transient claim failure, no double run, report identity) and
  `sandbox-replay-report.service.spec.ts` (8: wrapper/notes, 409 non-completed,
  owner 404, corrupt report). The module/flag/isolation suites add **19**
  (module 8, disabled 2, isolation 9).
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
4. Report/snapshot row size at the 3-token × 180-day maximum: expected to be a
   few MB, **unmeasured**; fixtures are small.
5. CI at the final status-only head. The `fcd2f77` run passed; run `45542727298`
   at the docs/fix evidence commit `3711752` was still in progress when the
   packet was updated. The `ad46db4` failed run, the `fcd2f77` pass, the local
   full gate and the focused fix tests are the recorded evidence.

## Fixed in this fix round

- Packet test counts corrected to measured values: replay-specific API **62** at
  `fcd2f77` (coverage 9, service 21, executor 10, worker 14, report 8), now **63**
  with the new timeout test; `sandbox.test.ts` **34**; module/flag/isolation **19**
  (17 before `fcd2f77`). Full gate corrected to API **550 passed / 159 skipped**,
  total **1,486** at `ad46db4` (the 548/1,484 figure was a pre-final run).
- `REPLAY_WORKER_TIMEOUT` was previously claimed but untested; a focused executor
  test now asserts the code, message and worker termination.
- Prefix-lookback wording corrected: tests prove the report/equity/ledger start at
  `evaluateFrom` and never include pre-window ledger rows, not that indicators
  consumed the prefix.
- PR/CI state reconciled: branch pushed, draft PR **#325**, CI run `45537895046`
  failed and `fcd2f77` fixed the Markdown 404; head/diff/commit stats updated.
- Runbook health URLs fixed to `/health`/`/ready`; missing-table first query
  corrected to `requeueRunningReplays`; `sandbox.migration` marked local/static.
- Packet wording fixed: `no-store` e2e coverage, started-audit hashes, unmeasured
  row size, error status grouping (`SANDBOX_REPLAY_TOKEN_NOT_FOUND` is 400).
- Lock-gating static test now asserts the guard string and the exact
  `await this.requeueStaleReplays(now);` call site, not any method name.
- Dead `SandboxReplayRepository.loadReplay` and its spec stub removed.

## Deferred items (recorded, not blocking Stage 2.1; each marked fixed/deferred)

**Task 1 — core replay**

- **Indicator-prefix use is not asserted.** Deferred. Tests prove the evaluation
  start and no pre-window ledger rows; no test proves an SMA/ATR/regime actually
  consumed the pre-window candles.
- **`evaluateFrom` is not part of `configVersion`.** Deferred. The frozen config
  hashes settings/seed/run shape; `evaluateFrom` is request data, and the report
  identity (`runId`, `dataSnapshotId`) plus the stored window bind it.
- **Duplicate CLI re-export.** Deferred (harmless). `collectRejectedBuys` is
  re-exported by `cli/paper.ts` although `paper/run-paper.ts` also exports it.
- **No-ledger-entry assertion is weak on the monotone fixture.** Deferred
  (test-quality only); the mutated-future test is non-vacuous.
- **No-look-ahead test does not set `evaluateFrom`.** Deferred; the separate
  boundary tests cover `evaluateFrom`.
- **Imprecise `evaluateFrom` out-of-range message; report `firstBar` is the close
  of the first evaluated bar while `from_time` is its open.** Deferred (wording);
  the half-open math is tested.

**Task 2 — schema/migration**

- **Minor static-test gaps.** Deferred: trailing newline, index column order,
  snapshot `prevId`/table-set, `jsonb_typeof` short-circuit, destructive-statement
  assertion, and optional DB hash/window checks. The table/columns/indexes/SQL/
  grants and runtime privileges are asserted.

**Task 3 — coverage/service**

- **Per-token staleness is window-derived.** Deferred (warning only): the stats'
  last open time is bounded by the replay window, so a token with newer data
  outside the window can be reported stale relative to `now`. It never blocks.
- Fixed in `1d74a4f`: unknown token key now `400 SANDBOX_REPLAY_TOKEN_NOT_FOUND`,
  corrupt stored settings fail closed, duplicate token keys are de-duplicated,
  `allowPartial` hole coverage is tested, and dead `candleStatsMany` removed.

**Task 4 — worker**

- **Connection-loss split brain (no claim stamp).** Deferred. If the API process
  stays alive but its Postgres connection drops mid-run, the advisory lock is
  released; another instance could requeue/re-run while the first thread computes.
  The first instance can only store while the row is `running` and may lose the
  race. A `worker_id`/claim token would harden this; lock-until-connection-end is
  accepted.
- **Staging gzip runs on the API event loop.** Deferred (~60 ms measured in
  review). Loading rows, canonical JSON, gzip and SHA-256 happen before the thread
  starts; moving it into the worker needs raw rows passed across the thread.
- **No attempt bound/backoff.** Deferred. `requeueRunningReplays` requeues every
  `running` row on the first pass after the lock; deterministic/worker-thread
  failures become `failed`, but an infrastructure exit can retry every pass.
- **One claim per 60-second pass.** Deferred; no batch drain, so queued replays
  wait sequentially.
- **Claim row-lock comment/transaction and coverage first-bar equality.** Deferred
  (documentation/DB-e2e gaps).
- **DB e2e gaps.** Deferred: the DB suites are CI-first; local runs skip.

**Task 5 — report/read**

- **Report body is not re-hashed on read.** Deferred. The read service checks the
  schema and identity columns (`runId`, `reportHash`, `dataSnapshotId`,
  `eventCount`, `eventHash`) but does not recompute `reportHash` from JSONB;
  tampering that keeps the columns consistent is out of the threat model.
- **No persisted prefix-length column.** Deferred; the prefix is derivable from
  the snapshot/first candle, and notes say “up to 180 days”.
- **Corrupt-report status corner.** Fixed on the main path (`409
SANDBOX_REPLAY_STATE_INVALID`) and the Markdown error path now preserved by
  `fcd2f77`; a residual unexpected-status 500 remains only for an unmodelled
  exception.
- **No engine-import assertion test.** Deferred; the isolation suite checks
  imports/table names, not that the report service cannot import the engine.
- **Duplicate hash statement in notes.** Deferred (cosmetic).

**Task 6 — e2e**

- **No `allowPartial` success e2e.** Deferred; the service/coverage unit tests
  cover the shortened-window path.
- **Singleton index drop before `try`; empty reloaded assertion; over-stated
  no-rerun comment; immutability label; truncation invariant note.** Deferred
  (test robustness/comment wording).

**Task 7 — UI**

- **Preflight→create race.** Deferred. Coverage can change between preflight and
  POST; the server re-checks and returns `409`, which the UI surfaces, but the
  stale preflight is not auto-refreshed/re-confirmed.
- **Stale preflight on a long-lived form.** Deferred; same recovery gap.
- **Unused pending input; unused `sandboxReplayCanDownloadReport` helper (tests
  only); truncated preflight warnings; fixed 50-row history cap; “запуска”
  copy; `createDisabled` ignores form validation.** Deferred (UI polish; no
  wrong state or mutation).

**Design-level deferrals**

- **Full event journal not persisted** (design choice): only `eventCount` /
  `eventHash`; row-level events need a compressed artifact.
- **Running replay cannot be cancelled**; bounded by the 15-minute timeout.
- Only 30/90/180-day presets, 1–3 tokens, 1h only.
- No notifications, PDF or scheduled replays.
- **Generated `bytea` quoting.** The committed SQL uses unquoted `bytea` and
  `db:generate` reports no drift; re-check a future regeneration.
- **Migration `0053` apply/deploy** intentionally not done (owner gate below).

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
