# Sandbox Stage 2 — review request

Date: 2026-11-24
Branch: `feat/sandbox-stage-2`
Stage 1C base: `3771b67` (accepted by the owner on 2026-11-24)
Stage 2 docs base: `67c8c32` (design, ADR 0084, plan)
Task 8 base: `efb28e4`
Frozen code head: `2e631c4` (Stage 2 review fixes + deterministic core
fail-closed fix; CI green) plus the final docs/packet commit. Previous heads
`4acc900`/`e4dadda` and `5fe93cf`/`b4b1e03` predate this scoped re-review fix.
Status: **Stage 2 signed off by the independent whole-branch review on 2026-11-25, accepted by the owner and deployed** (`3a6f94a`, deployment `ad0b0b73-2df2-46bd-a403-f83074c598c5`, migration `0052` applied). Owner report: `docs/reviews/2026-11-25-sandbox-stage-2-report.md`.

CI: draft PR #324, first DB execution failed 10 tests (test defects only); fixed
in `b1f8bf2` (CI green) and the review findings in `e01c5cd` (CI green). A
temporary one-off live-smoke step failed once on `2b49bf5` because GitHub's US
runners get HTTP 451 from Binance; the smoke became environment-aware
(CAKE/GeckoTerminal strict, Binance skipped when unreachable) and passed on
`05082b6` and `cd31bca` (CAKE 4320/4320, tick fill, report, stop). That temporary
step was removed in `b4b1e03`. The whole-branch review fixes are in `4acc900`
(CI green); the scoped re-review's deterministic-core finding is fixed in
`2e631c4` (CI green), which also provisions `nexter_app` in CI so the runtime
grant suite executes.

Review this as one whole-branch Stage 2 review. The scope is paper only: no real
money, exchange orders, wallets, keys, signing or real-ledger writes.

## Scope

- Owner-only `Песочница` (`/sandbox`) with `Обзор`, `Запуски`, `Журнал`, `Отчёты`.
- New additive `sandbox_*` schema (migration `0052`), separate from old AI tables.
- Persistent runs, append-only hash-chained events, ledger/engine snapshots,
  projections, 180-day 1h candle store and coverage.
- 60-second live paper runner under one advisory lock; one decision per closed
  1h bar; next-quote paper fills with Stage 1C fees/slippage/liquidity.
- Owner controls: create draft, start, pause, resume, stop, archive, close one
  trade. No manual buy/add/override.
- Read API, deterministic JSON/Markdown reports, audit, feature flag, rollback,
  runbook, fake-clock e2e and opt-in live-provider smoke.

## Out of scope

- Real money, exchange execution, wallets, keys, signing, swaps, real ledger.
- Old AI/`ai-trading`/`trading-bots`/search imports or `ai_*`/`market_candles` reads.
- Strategy fitting/optimization or Stage 1B/1C rule changes.
- Multi-timeframe live decisions (Stage 2 is 1h).
- Push notifications/Telegram/Viber, native mobile, Stage 3 forward run.
- PDF export and `sandbox_reports` snapshotting.

## Tasks and commits

| Task | Scope                                            | Commits                                                                            | Review                            |
| ---- | ------------------------------------------------ | ---------------------------------------------------------------------------------- | --------------------------------- |
| Docs | Design, ADR 0084, plan                           | `67c8c32`                                                                          | n/a                               |
| 1    | Schema/migration/module flag                     | `3aa78c4`, `777ff89`                                                               | complete (scoped re-review clean) |
| 2    | Token universe, 1h ingestion, coverage           | `2e5752a`, `8c3560d`                                                               | complete (scoped re-review clean) |
| 3    | Event log, run store, projections                | `dcafb66`, `6216dc2`, `68a5933`                                                    | complete (scoped re-review clean) |
| 4    | Live broker/runner/lifecycle/controls            | `03d8e80`, `8d945bd`                                                               | complete (scoped re-review clean) |
| 5    | Read API, contracts, reports                     | `ee33db6`, `a6844b9`                                                               | complete (scoped re-review clean) |
| 6    | UI shell, run list/setup, controls               | `69a907a`, `09d09c0`                                                               | complete (scoped re-review clean) |
| 7    | UI dashboard/journal/reports/close               | `88b414b`, `efb28e4`                                                               | complete (scoped re-review clean) |
| 8    | Fake-clock e2e, live smoke, security/ops, packet | `e1da565`, `b1f8bf2`, `e01c5cd`, `05082b6`, `b4b1e03`, `4acc900`, `2e631c4` + docs | **awaiting whole-branch review**  |

Branch diff from `3771b67` through `2e631c4`: 148 files, +40,553/−111
(including tests, fixtures, docs, contracts, core helpers, the migration
snapshot and the test typecheck/CI/review fixes); this packet adds documentation
only. No production data or production configuration was changed by this branch.

## Commands and outputs (local, 2026-11-24)

| Command                                                               | Result                                                                                                                                                                                                    |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx pnpm@10.20.0 test`                                               | exit 0 (full gate before the final review-fix round): API **73 files passed / 25 skipped; 468 passed / 151 skipped**. Core **552 passed**. Contracts **55 passed**. Web **258 passed**. DB **1 passed**.  |
| Review-fix focused API tests                                          | **35 unit tests passed** (runner/run/report; the DB event-log test ran in CI), plus typecheck/build/lint/format green; CI's full API run is **624 passed / 4 skipped** on `2e631c4`.                      |
| `npx pnpm@10.20.0 typecheck`                                          | all packages/apps pass; **API now also typechecks `test/**/*.ts`** via `apps/api/tsconfig.test.json` (262 pre-existing test type errors fixed mechanically)                                               |
| `npx pnpm@10.20.0 build`                                              | web + sandbox-core + API pass (existing chunk-size warning only)                                                                                                                                          |
| `npx pnpm@10.20.0 lint`                                               | clean                                                                                                                                                                                                     |
| `npx pnpm@10.20.0 format:check`                                       | “All matched files use Prettier code style!”                                                                                                                                                              |
| Stage 1B/1C goldens (`decision-engine.golden`, `paper-runner.golden`) | **2 files / 6 tests passed**; goldens unchanged                                                                                                                                                           |
| Fake-clock e2e                                                        | **green in CI** (3/3 on `e01c5cd`); locally only the unauthenticated 401 route test runs, the three DB-gated tests skip (no Postgres)                                                                     |
| Live provider ingestion smoke                                         | local: Binance **4320/4320 `ok`** and GeckoTerminal **4320/4320 `ok`**; one-off CI: Gecko **4320/4320 `ok`**, Binance **HTTP 451 → unavailable, BTC assertions skipped** (environment-aware by design)    |
| Live tick smoke (`sandbox-live-tick-smoke.e2e.spec.ts`)               | **passed** in one-off CI run 45461431183: CAKE 4320/4320 `ok`, two real closed bars (17:00→18:00 UTC), sell **filled**, 17 events, report `af725870…`, run stopped; Binance is not required by this smoke |

Environment fact: this workspace has no PostgreSQL server or Docker, so every
`NEXTER_TEST_DB=1` suite is skipped locally. Draft PR #324 supplied the first
real database execution.

### CI evidence — draft PR #324

| Head      | Run                                                                                     | Result                                                                                         |
| --------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `6d21ed9` | [run 45438632692](https://github.com/jankowski-dev/Nexter.App/actions/runs/45438632692) | **failure**: first DB execution, 5 files / 10 tests                                            |
| `b1f8bf2` | [run 45442051125](https://github.com/jankowski-dev/Nexter.App/actions/runs/45442051125) | **success** after the 10 CI test defects were fixed                                            |
| `e01c5cd` | [run 45450320973](https://github.com/jankowski-dev/Nexter.App/actions/runs/45450320973) | **success** after the independent-review test/evidence findings                                |
| `4b20fcd` | [run 45454768964](https://github.com/jankowski-dev/Nexter.App/actions/runs/45454768964) | **success** (interim docs/packet head)                                                         |
| `b363154` | [run 45456619303](https://github.com/jankowski-dev/Nexter.App/actions/runs/45456619303) | **success**: interim docs head                                                                 |
| `2b49bf5` | [run 45458959683](https://github.com/jankowski-dev/Nexter.App/actions/runs/45458959683) | **failure**: one-off live smoke, Binance HTTP 451/0 rows                                       |
| `05082b6` | [run 45461431183](https://github.com/jankowski-dev/Nexter.App/actions/runs/45461431183) | **success**: one-off live smoke (CAKE strict, Binance skipped)                                 |
| `cd31bca` | [run 45463903353](https://github.com/jankowski-dev/Nexter.App/actions/runs/45463903353) | **success**: one-off live smoke repeated; CAKE 4320/4320, fill, report, stop                   |
| `b4b1e03` | [run 45466287752](https://github.com/jankowski-dev/Nexter.App/actions/runs/45466287752) | **success**: final code head, temporary one-off step removed (output-only CI; DB suites green) |
| `8983bde` | [run 45468500668](https://github.com/jankowski-dev/Nexter.App/actions/runs/45468500668) | **success**: interim docs head (superseded)                                                    |
| `4acc900` | [run 45479363737](https://github.com/jankowski-dev/Nexter.App/actions/runs/45479363737) | **success**: Stage 2 review fixes; app role provisioned, grant suite runs, API 621 passed      |
| `4422dbe` | [run 45481336585](https://github.com/jankowski-dev/Nexter.App/actions/runs/45481336585) | **success**: docs/packet head before this final head correction                                |
| `2e631c4` | [run 45486431945](https://github.com/jankowski-dev/Nexter.App/actions/runs/45486431945) | **success**: deterministic core fail-closed fix; API 624 passed, event-log/grant suites green  |

All 10 first-run failures were test defects/isolation, not product behavior:

1. `sandbox-tokens`: mutations after `POST /auth/2fa/enable` used the
   pre-rotation CSRF token; the helper now returns `csrfFrom(enabled)`.
2. `sandbox-candles`/`sandbox-live-runner`: candle rows are shared market data
   with no owner FK; a fixture left `high < close`, and the live runner loaded
   every row for the token. Fixtures are self-consistent and every candle
   consumer (`candles`, `live-runner`, `sandbox.e2e`, `tokens`) truncates
   `sandbox_candles` explicitly; `sandbox-candles` also cleans up in `afterAll`.
3. `sandbox-read`: a hard-coded position amount from an old fee model; the
   expectation now derives from `makeOpenLedger()`.
4. `sandbox-event-log`: Drizzle wraps the PG unique violation. The test now
   matches the wrapped `/Failed query|duplicate key|unique/i` message **and**
   inspects `error.cause` for PG `23505` when present, while keeping the
   invariant (no rows, genesis in-memory chain, run head 0).
5. `sandbox-run-store`: the NUL-in-JSONB fixture failed on the run update before
   any projection. Both rollback tests now use a projection-only
   `sandbox_trades.realized_pnl_usd numeric(18,2)` overflow (the run JSONB
   update succeeds), then assert the whole tick — run state, events, positions
   and equity — rolled back.

The temporary one-off live-smoke step first failed on `2b49bf5` only because
GitHub's US runners receive **HTTP 451** from Binance before the CAKE leg. The
smoke was made environment-aware: CAKE/GeckoTerminal is fetched first and stays
strict (`available === required`, `status === 'ok'`, `gaps 0`, `stale false`,
`4320` rows, 18dp/contiguous); a zero-row or mixed-source Binance response is
logged as unavailable and only the BTC assertions are skipped, never a partial
or synthetic BTC series. The live tick smoke now trades CAKE only. On `05082b6`
the one-off step passed: Gecko **4320/4320 `ok`**, Binance **HTTP 451 → skipped**,
tick smoke bars `17:00→18:00 UTC`, **sell filled**, **17 events**, report
`af7258708f3606176de12b5c576c87532eee553c26dacf7a68984ea52791ae08`, run
stopped. The normal test step remained green.

Review follow-ups included in `e01c5cd`: test typecheck (`tsconfig.test.json`
wired into `pnpm --filter @nexter/api typecheck`), a real `SANDBOX_ENABLED=false`
e2e (`/status` 200, `/tokens` and `/overview` 404 `SANDBOX_DISABLED`), exact
(sorted) audit-action rows instead of a Set, stop-with-open-position and
report-after-archive coverage, strict `available === required`/`status === 'ok'`
smoke assertions, and the manual live-tick workflow.

### Stage 2 whole-branch review fixes (`4acc900`)

- **Important 1 — transient DB errors no longer kill a run.** The runner
  classifies fail-closed `SandboxPersistenceError` codes
  (`STATE_INVALID`/`EVENT_CHAIN_DESYNC`/`EVENT_PAYLOAD_INVALID`) and every
  `SandboxLiveTickError` code as terminal; all other errors (pool timeout/reset,
  unknown infrastructure) log a warning, best-effort touch `last_tick_at`, keep
  the run `running` and retry on the next 60-second pass. No intents are
  expired and `failed` is not set. `SANDBOX_RUN_NOT_FOUND` is intentionally
  transient. Unit tests cover transient `loadRun`/`commitTick` recovery and
  terminal persistence/reconciliation failure (intents expired, audited).
- **Important 2 — runtime grant gate now runs in CI.** CI runs
  `APP_DB_USER=nexter_app APP_DB_PASSWORD=… pnpm db:provision-app` after
  migrations. `sandbox-schema.e2e.spec.ts` no longer early-returns when the role
  is missing: it asserts the role exists and runs the
  `has_table_privilege`/precision checks against `nexter_app` (CI 4/4 passed).
  The API test connection still uses the postgres superuser; static SQL/
  provisioning assertions remain.
- **Minor 3 — atomic stop/archive + pending expiry.** New repository helpers
  `transitionRunAndExpire`/`archiveRunAndExpire` perform the conditional
  transition and pending-intent expiry in one transaction; the service audits
  the actual expired count/timestamp. The lifecycle DB test now also seeds a
  pending row after stop and verifies archive expires it (all rows expired).
- **Minor 4 — typed report 409.** `SandboxReportService.generate` wraps the
  persisted-run read/map path and maps `SandboxPersistenceError` to
  `409 SANDBOX_REPORT_NOT_READY`; corrupt JSONB/event payloads no longer escape
  as 500. Two focused tests cover corrupt run state and corrupt event payload.
- **Minor 7 — coverage warning wording.** The stale warning now says the last
  candle is older than one closed 1h bar instead of “2 hours”.
- **Minor 9 — pending-intent conflict visibility.** The runner records a warning
  when `insertPendingIntents` persists fewer rows than queued, making the
  manual-close-vs-engine same-tick race visible without changing behavior; the
  partial unique index remains the guard. The exact race stays in deferred items.
- **Minor 8 — packet head/evidence** is this update: code head `2e631c4`, CI run
  [45486431945](https://github.com/jankowski-dev/Nexter.App/actions/runs/45486431945),
  runtime grant suite green (API 624 passed / 4 skipped).

### Scoped re-review fix (`2e631c4`)

The scoped re-review found that the transient classifier retried deterministic
core failures forever. Fixed by:

- wrapping the core `buildEvent`/schema/JSON validation in
  `SandboxEventLog.append`; a `ZodError`/`NonJsonValueError` now becomes the typed
  `SANDBOX_EVENT_PAYLOAD_INVALID` persistence error and the run fails closed;
- extending the explicit terminal list with `PaperLedgerError`,
  `PaperExecutionInputError`, `PaperRunError`, `CandleValidationError`,
  `ClockBackwardsError`, `EventChainError`, `NonJsonValueError`,
  `DecisionInputError`, `DecimalInputError`, `ZodError` and
  `SandboxLiveBrokerError`; `SANDBOX_RUN_NOT_FOUND` stays transient;
- focused tests: invalid event schema/JSON at the log level, a typed payload
  error from the tick, and a `PaperLedgerError` from the tick all mark the run
  `failed` and expire intents; the transient DB tests still keep it `running`;
- the runbook now states that deterministic engine/event/persistence errors
  mark `failed`, while DB/provider/unknown infrastructure errors retry.

DB-gated suites executed by CI (all green in `e01c5cd`, `4acc900` and `2e631c4`):

- `sandbox-schema.e2e.spec.ts` — tables/indexes/precision plus the **runtime**
  `nexter_app` grant checks (role provisioned in CI).
- `sandbox-tokens.e2e.spec.ts`
- `sandbox-candles.e2e.spec.ts`
- `sandbox-status.e2e.spec.ts` (owner-path test)
- `sandbox-event-log.e2e.spec.ts`
- `sandbox-run-store.e2e.spec.ts`
- `sandbox-projections.e2e.spec.ts`
- `sandbox-live-runner.e2e.spec.ts`
- `sandbox-run-lifecycle.e2e.spec.ts`
- `sandbox-read.e2e.spec.ts`
- `sandbox-disabled.e2e.spec.ts` (flag-off e2e)
- `sandbox.e2e.spec.ts` — full fake-clock flow, restart, controls, reports,
  audit and owner isolation; **passed in CI**.

The live provider smokes are never run by the normal CI workflow. The ingestion
smoke is opt-in via `SANDBOX_LIVE_SMOKE=1` + `NODE_ENV=development`. The live
tick smoke needs both a disposable Postgres and real providers and is manual:
`.github/workflows/sandbox-live-smoke.yml` (`workflow_dispatch` only; Postgres 17
with migrations). A dispatch attempt with the available agent token returned
`403 Resource not accessible by personal access token` (needs `actions:write`),
so the workflow itself was not dispatched. A temporary one-off CI step ran the
same two files and **passed** on `05082b6` and `cd31bca`
([run 45461431183](https://github.com/jankowski-dev/Nexter.App/actions/runs/45461431183),
[run 45463903353](https://github.com/jankowski-dev/Nexter.App/actions/runs/45463903353));
that step was removed in `b4b1e03`, so normal CI does not depend on providers.

## Schema, migration and grants

Migration `packages/db/drizzle/0052_sandbox_stage2.sql` is **additive and
unapplied in production**. It creates:

`sandbox_tokens`, `sandbox_candles`, `sandbox_runs`, `sandbox_run_tokens`,
`sandbox_events`, `sandbox_positions`, `sandbox_trades`,
`sandbox_ledger_entries`, `sandbox_equity_points`, `sandbox_intents`,
`sandbox_reports`.

- `sandbox_events`: append-only (`SELECT/INSERT` only; UPDATE and DELETE revoked).
- No DELETE grant on any `sandbox_*` table; the provisioning script is authoritative.
- `sandbox_intents` gained nullable `stop_loss_pct`/`take_profit_pct` and a
  partial unique index on pending `(run_id, token_id, side)` during Task 4
  (amended in place because `0052` was unapplied).
- Money/price columns are `numeric`; `sandbox_positions.market_price_usd` stores
  the exact tick mark (up to 18 decimals) so reports reproduce the equity curve.
- Closed positions are delete-free zero tombstones; closed trades keep history.
- Jobs/background work remain in the API process; no new service.

Production apply order (owner approval required): encrypted backup + restore
check + SHA-256 → `node packages/db/dist/migrate.js` with
`MIGRATION_DATABASE_URL` → `pnpm db:provision-app` for `nexter_app` → deploy with
`SANDBOX_ENABLED=true` → `/health`, `/ready`, sandbox overview → optional live
smoke. Rollback: set `SANDBOX_ENABLED=false` (or `0`), stop running runs, revert
the API/UI image; the tables stay inert and can be dropped later with a separate
approved destructive migration. There are no rows to restore on rollback.

## Data sources and live-paper semantics

- GeckoTerminal true 1h OHLCV for BSC/Ethereum contracts; Binance for a curated
  majors allowlist; CoinGecko `1h` fallback marked `synthetic`.
- 180 days (4320 bars) warmup, bounded 4321-row read window per token.
- Coverage exposes available/required/first/last/gaps/synthetic/stale/status.
  A run may start with a partial window only with explicit owner confirmation;
  missing data always blocks.
- Decisions use **closed** candles only (`closeTime <= decision bar close`).
- Fills happen at the **first live quote after** the decision bar (quote bar
  open >= decision time), never at the historical close. Fees 25 bps, slippage
  10 bps, liquidity cap 1% of the last closed bar volume; strategy intents are
  IOC and expire after one bar; a manual close is owner intent and does not
  expire until it fills or the run stops/archives/fails.
- Rejections, partial fills, expiry, risk checks, cooldowns and the manual close
  are persisted as terminal intent rows and events. Stop/take protection from
  the decision is carried into the fill.
- Reports and the API label execution as `live-paper`; Markdown states it and
  that counterfactuals are omitted.
- There is no wallet/key/signing/real execution path, and no manual buy/add.

## Live loop, controls and inventory

Runner: 60 s interval, `pg_try_advisory_lock(hashtext('nexter:sandbox-runner'))`,
release in `finally`, one tick per closed 1h bar (`last_bar_close` guard),
`FOR UPDATE` re-read so pause/stop/archive wins over an in-flight tick. One
tick persists events + engine/ledger state + projections + equity point in one
transaction; reconciliation failure marks the run `failed` and stops it.

Statuses: `draft`, `running`, `paused`, `stopped`, `failed`; archive is a soft
hide. Invalid transitions return `409`; no manual buy/add route exists.

API (owner auth + CSRF, 24 routes, only `GET /status` survives the flag off):

```
GET  status tokens coverage overview runs runs/:id
GET  runs/:id/{positions,trades,intents,events,equity,report.json,report.md}
POST tokens, tokens/:id/refresh, runs, runs/:id/{start,pause,resume,stop,archive,close/:tokenId}
PATCH tokens/:id, runs/:id
```

UI: top-level `Песочница`; `Обзор` (health, run summary, equity, positions,
token regime/decision/risk, last decision, freshness, controls, close-trade
confirmation), `Запуски` (list, create/edit draft, token universe add/refresh,
start/pause/resume/stop/archive), `Журнал` (events with hashes/why-not/risk,
intents, trades, risk checks, filters, load more), `Отчёты` (identity, 17
summary cards, strategy/token tables, equity, positions/trades/intents,
JSON/Markdown download). No manual buy/add/override and no real execution.

## Audit and security evidence

- Every sandbox mutation writes `audit_log`: `sandbox.run_created`,
  `run_updated`, `run_started`, `run_paused`, `run_resumed`, `run_stopped`,
  `run_archived`, `run_failed`, `trade_close_requested`, `token_created`,
  `token_updated`, `token_refreshed`. The Task 8 e2e asserts the full set for the
  exercised flow; failure is covered by the runner unit test.
- The Task 8 e2e asserts 401 `AUTH_REQUIRED` for every data/read/control route,
  CSRF rejection (403) for an authenticated POST without the header, `404` for
  `POST …/buy` and `…/add`, and cross-owner `404`s for detail/positions/report/pause.
- `sandbox-isolation.spec.ts` asserts: no old-AI/trading-bot imports, no
  `market_candles`/`ai_*`/`trading_bots` reads, no wallet/key/signing terms, no
  DELETE code path, and one advisory lock key.
- `sandbox.disabled.spec.ts` asserts `/status` stays readable, every other route
  is guarded, and the runner bootstrap exits when the flag is off.
- `sandbox-schema.e2e.spec.ts` (CI) asserts tables, indexes, numeric scales and
  the **runtime** no-DELETE/append-only grants for `nexter_app`; CI provisions
  the role before the test step, so the `has_table_privilege` checks execute and
  pass (4/4). `provision-app-role.mjs` revokes DELETE and UPDATE on evidence
  tables and remains self-checking.
- No secrets, keys, seed phrases, wallets or signing exist in the sandbox module.
  No public signup route was added.

## Tests and evidence

- 552 core tests, including the unchanged Stage 1B/1C goldens and event-chain replay.
- 55 contract tests (sandbox lifecycle/read/report schemas).
- 468 API tests locally (focused review-fix unit run: 35 passed); 151 skipped
  locally, and the full DB-gated set ran green in CI on `2e631c4` (API **624
  passed / 4 skipped**, including the fake-clock e2e, deterministic-error tests
  and event-log suite).
- 258 web tests (SSR/pure helpers, no DOM stack) including sandbox boundary checks.
- API `typecheck` now covers `test/**/*.ts` (`tsconfig.test.json`), so the new
  e2e suites are type-checked on every gate; the 262 pre-existing test type
  errors were fixed without `any`.
- New in Task 8: fake-clock e2e (DB-gated), opt-in provider ingestion smoke,
  manual live-tick smoke + `workflow_dispatch` workflow, flag-off e2e, static
  flag/lock/route security tests, exact audit rows, stop/archive coverage,
  Task 7 low fixes and `docs/runbooks/sandbox.md`. The review-fix round adds
  transient/terminal runner tests, report 409 tests, atomic stop/archive tests,
  and the CI app-role provisioning step.

Unverified due to environment (explicit):

1. The manual `workflow_dispatch` live-smoke workflow was not dispatched by the
   agent (no `actions:write`); the equivalent test ran in the temporary one-off
   CI step on `05082b6` and passed (CAKE strict, Binance HTTP 451 skipped, tick
   fill + report + stop). Binance data itself remains unverified from the CI
   network; the local run verified Binance 4320/4320.
2. A full live paper tick on a deployed environment; deferred to post-deploy
   verification with owner approval, and no production run is left started.
3. Production migration `0052` apply/rollback; not applied, no production access
   was used.
4. Real provider behavior beyond these smoke runs (public rate limits/geo rules).

## Deferred items (not blocking Stage 2, recorded for Stage 3/ops)

- Event log replays/copies the full chain per tick and report: O(n²) I/O over a
  long forward run; needs snapshot/checkpointing.
- Event payloads are hashed after JSONB storage; the current canonical
  stringify/round-trip is stable, but any canonicalization or hash-visible field
  change needs an explicit replay/migration plan.
- Transient DB/pool errors now keep the run `running` and retry on the next
  60-second pass, but there is no in-pass retry/backoff or jitter.
- Start warmup is synchronous (180-day provider fetch inside the start request);
  a cold start can be slow and should move to an explicit warmup state.
- Same-tick pending-intent drop: resolved rows may still be non-terminal when a
  new decision queues the same token/side; the partial unique index drops the
  duplicate and the runner now logs the persisted-vs-queued count, but there is
  no drop event yet.
- Report reads are not one `REPEATABLE READ` snapshot; a report generated while a
  tick commits can mix pre/post-tick rows (the chain/equity consistency gate
  fails closed with 409 rather than publishing a contradictory report).
- The live tick smoke asserts the fill when the provider returns a fresh quote
  and otherwise asserts an explicit pending intent; the one-off CI run filled,
  but there is no hard “must fill” assertion (provider freshness is external).
- Run list has no pagination cap beyond the contract limit (1–100) and no
  server-side search/sort.
- Stacked drawers can still need two Escape presses in one edge path.
- Equity chart reads at most 2000 points from the start; very long runs would
  show the earliest window rather than the latest.
- Reports are generated on demand (never written to `sandbox_reports`) and
  omit hindsight counterfactuals because they were never persisted.
- Journal event filters are client-side over loaded pages and say so.
- Reports fall back to the raw token id when a run token snapshot has no symbol.

## Gate

**Stage 3 (4–8 week forward paper run) must not start until Stage 2 is signed
off and the owner accepts the Stage 2 report.**

Requested review:

1. Schema isolation/grants and `0052` safety.
2. Look-ahead-free, honestly labelled live fills.
3. Persistence, reconciliation and event-chain restart behavior (especially the
   new DB-gated e2e in CI).
4. Owner-only controls, audit and no real-money path.
5. UI workflow completeness without manual buys.
6. Data staleness/failure paths, feature flag/rollback and runbook accuracy.
