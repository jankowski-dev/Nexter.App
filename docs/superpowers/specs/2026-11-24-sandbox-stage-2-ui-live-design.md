# Sandbox Stage 2 — Песочница UI, live paper loop and persistence design

Date: 2026-11-24
Status: **Stage 2 in progress** (Task 1 schema/scaffold; Stage 1C signed off and accepted)
Scope: Stage 2 only. No real money, exchange execution, wallets, signing or live trading. Stage 3 (4–8 week forward paper run) starts only after Stage 2 is signed off and the owner accepts it.

Base: Stage 1C design `docs/superpowers/specs/2026-11-24-sandbox-stage-1c-paper-execution-design.md` (signed off; merged as `3771b67`).

## 1. Intent

Expose the proven sandbox core as an owner-facing `Песочница` section with a persistent live paper loop:

```
1h market data -> Stage 1B decision engine -> next-open/live paper fills
               -> Stage 1C ledger -> persisted state/events
               -> owner dashboard, journal and reports
```

The owner can create a run, choose the token universe, capital and limits, start/pause/resume/stop it and close an individual trade. The system remains autonomous within the approved limits; there is no manual buy, override or real execution.

Stage 2 is split internally:

- **2A — headless:** schema, data ingestion, persistence, live loop, API.
- **2B — UI:** `Песочница` navigation, run setup/list, dashboard, journal, reports and controls.

## 2. Goals and non-goals

### Goals

1. Owner-only `Песочница` section, independent of the old AI/legacy modules.
2. Sandbox token universe and 1h candle store, separate from old AI tables.
3. Persistent runs: state, ledger, events, positions, trades, intents and equity survive restarts.
4. A 60-second scheduler that advances each running run when a new 1h bar closes, under an advisory lock.
5. Live paper fills at the first available quote after the decision bar close, with Stage 1C fees/slippage/liquidity and IOC outcomes.
6. Owner controls: create draft, start, pause, resume, stop, close an individual trade, archive; no manual buys.
7. Dashboard, journal and report artifacts (JSON/Markdown) built from the persisted evidence.
8. Audit every mutation; owner-only auth; CSRF; no secrets; no real money.
9. Feature flag and rollback; a Stage 2 review gate.
10. A fake-clock end-to-end test and a short live paper smoke before sign-off.

### Non-goals

- Real money, exchange orders, wallets, keys, signing, swaps or the real ledger.
- Old AI/legacy imports or reuse of `market_candles`/`ai_*`/`trading_bots` data.
- Strategy fitting/optimization; changing Stage 1B/1C rules.
- Multi-timeframe live decisions; Stage 2 is 1h.
- Mobile-native app; the existing responsive web shell is reused.
- Push notifications/Telegram/Viber in Stage 2 (the existing notification center may show run events).
- Stage 3 forward validation.

## 3. Defaults

| Setting               |                                                                                        Default |
| --------------------- | ---------------------------------------------------------------------------------------------: |
| Timeframe             |                                                                                             1h |
| Initial paper capital |                                                                                         $1,000 |
| Warmup data           |                                                                         180 days of 1h candles |
| Live tick             |                                                                                     every 60 s |
| Decision cadence      |                                                                 one decision per closed 1h bar |
| Fees / slippage       |                                                                       25 bps / 10 bps per side |
| Liquidity cap         |                                                               1% of the last closed bar volume |
| Max pending           |                                                                                    1 bar (IOC) |
| Cooldown after stop   |                                                                                            24h |
| Stage 1B limits       | `DEFAULT_SETTINGS` (5 positions, 20% token, 40% strategy, 10% cash, 2% daily, 15% DD, 1% risk) |
| Run history           |                                                             all runs retained; archive is soft |

All values are configuration. Stage 1B/1C remain the source of truth for decision, fill and accounting rules.

## 4. Architecture

```
apps/api/src/modules/sandbox/
  sandbox.module.ts
  sandbox.controller.ts          owner-only HTTP
  sandbox-tokens.service.ts      universe + data coverage
  sandbox-data.service.ts        1h candle ingest/read (GeckoTerminal/Binance/CoinGecko)
  sandbox-run.service.ts         run lifecycle, controls, projections
  sandbox-runner.service.ts      interval + advisory lock + per-run tick
  sandbox-live-broker.ts         fills from latest quote + Stage 1C plan/ledger
  sandbox-event-log.ts           EventLog backed by sandbox_events
  sandbox-report.service.ts      JSON/Markdown report from persisted state
  sandbox.repository.ts          Drizzle queries
  tests
apps/web/src/features/sandbox/    page, tabs, forms, charts, hooks
packages/contracts               sandbox schemas
packages/db/src/schema            sandbox_* tables
packages/db/drizzle/0052_*.sql   additive migration
```

The API imports `@nexter/sandbox-core` (workspace dependency). No old AI/trading-bot module is imported. `market-data` clients may be reused for HTTP fetching; no old AI data service/table is reused.

## 5. Data

### 5.1 Tables

- `sandbox_tokens`: owner token universe (sandbox token id, symbol/name, chain, contract, coingecko id, enabled).
- `sandbox_candles`: `(token_key, timeframe, open_time)` primary key, OHLCV decimal strings/numeric, source, fetched_at. `token_key` is the sandbox provider key (`bsc:0x…`, `binance:BTCUSDT`), not an old AI asset id.
- `sandbox_runs`: run identity/config/status, cash/equity/peak/day-start projections, engine and ledger JSONB snapshots, last bar close, event seq/hash, last tick/error, timestamps, archived_at.
- `sandbox_run_tokens`: immutable per-run token snapshot (token key/symbol/chain/contract).
- `sandbox_events`: append-only hash-chained events `(run_id, seq)`; payload JSONB + key columns; SELECT/INSERT only.
- `sandbox_positions`, `sandbox_trades`, `sandbox_ledger_entries`, `sandbox_equity_points`, `sandbox_intents`: query projections rebuilt from the ledger/engine after each tick; SELECT/INSERT/UPDATE, no DELETE. `sandbox_positions.market_price_usd` stores the **exact** tick mark (the raw provider close, up to 18 decimals), not the core `PortfolioPosition.marketPriceUsd` 8-decimal display value. The 2-decimal market value/equity still come from the core mark.
- Optional `sandbox_reports`: reserved for an explicit snapshot job. Stage 2 reports are generated on demand from persisted state; a GET never writes this table.

The engine/ledger JSONB is the source of truth; projection tables serve the UI and report. Every tick writes state + projections + events in one transaction.

Report identity follows the persisted chain: `configVersion` is the event chain's version (all events must agree) and `dataSnapshotId` is the **last** persisted tick snapshot, i.e. the snapshot represented by the current run state/equity. `replayEventChain` must match the run's event count/hash, and recomputing the final mark from the exact `market_price_usd` values must reproduce `sandbox_runs.equity_usd` and the last equity point within one cent per position; otherwise the API returns `409 SANDBOX_REPORT_NOT_READY` and publishes no report. Pending intents are excluded from `report.intentJournal` (they remain visible through `GET /runs/:id/intents`) and hindsight counterfactuals are omitted, because they were never persisted and later backfilled candles would change the hash; both are stated in the JSON `notes`/`pendingIntents` and the Markdown.

### 5.2 Ingestion

- At run start, fetch 180 days of 1h candles for each run token (GeckoTerminal for BSC/ETH contracts; Binance for the curated majors; CoinGecko `1h` fallback marked synthetic). Upsert by `(token_key, timeframe, open_time)`.
- The scheduler fetches the latest 1h candles every tick and upserts; the run uses only closed candles (`closeTime <= now`).
- Coverage endpoint reports required/available candles, first/last, gaps, synthetic flags and staleness. A run cannot start without the warmup history unless the owner explicitly starts with the available window (warning, reduced regime confidence).
- No candle is fabricated to fill a gap except the explicitly labelled CoinGecko synthetic fallback.

## 6. Run lifecycle

Statuses: `draft`, `running`, `paused`, `stopped`, `failed`.

- **draft:** owner edits name, universe, capital and Stage 1B/1C settings. No money, no data snapshot yet.
- **start:** validate config/tokens/coverage; freeze the config/token snapshot; warm up the data; create the ledger ($initial) and a valid empty engine state (`{ tokens: {} }`) **before** the status becomes `running`; the next tick at the next closed 1h bar. Audit `sandbox.run_started`.
- **running:** the runner ticks; decisions/fills/events/equity persist; owner cannot edit config, only pause/stop/close a trade.
- **pause:** no new decisions or fills; open positions stay marked; status paused; the runner skips. Audit `sandbox.run_paused`.
- **resume:** continue from the next closed bar; no gap fill. Audit `sandbox.run_resumed`.
- **stop:** stop decisions, generate the final report, mark positions/open trades at the last close, status stopped. Audit `sandbox.run_stopped`.
- **failed:** a data/engine/reconciliation error that cannot be recovered; error stored; no further ticks; report with the last good state. Audit `sandbox.run_failed`.
- **archive:** soft hide a terminal run; no DELETE. Audit `sandbox.run_archived`.

`loadRun` fails closed when a non-draft run still has the schema-default `{}` state, so the start transaction must persist the initial ledger and `{ tokens: {} }` together with the status change; the first tick depends on both.

The owner can close one token: a manual close request is queued; the next tick emits a sell intent at the current quote, bypassing strategy exits but still applying the sell risk checks (data/liquidity). This is the only manual trade action. Audit `sandbox.trade_close_requested`.

## 7. Live runner

`SandboxRunnerService` runs every 60 s under `pg_try_advisory_lock('nexter:sandbox-runner')`, like the existing bot runner. For each `running` run:

1. Load the run config, engine state, ledger, token snapshot and last bar close.
2. Fetch/upsert the latest 1h candles for the run tokens; find the latest closed bar close > `last_bar_close`.
3. If no new bar, update `last_tick_at` and exit.
4. Fill pending intents and manual close requests at the first available quote after the previous decision (the quote at/after the bar close), using the Stage 1C `planBuyFill`/`planSellFill` with a synthetic fill candle: `open = quote price`, `volumeUsd = last closed bar volume`, plus the Stage 1C fee/slippage/liquidity.
5. Build the marked portfolio at the new close (equity, cash, day-start, peak), the `ClockedMarketView` from `sandbox_candles`, and call the Stage 1B `DecisionEngine` with the persisted state.
6. Queue intents for the next tick, overlay post-stop cooldowns, persist the new engine/ledger state, projections, equity point and events; update `last_bar_close`.
7. Reconcile the ledger; on discrepancy mark the run failed and do not project new state.

Live fills are a paper approximation: the decision uses closed candles; the fill uses the first quote after the close, never a historical close. The report labels the execution mode `live-paper`.

## 8. Persistence and event log

`SandboxEventLog implements EventLog` over `sandbox_events`:

- `append` validates via the Stage 1A schema, computes the next hash/prevHash/seq from the run's `event_seq`/`event_hash`, inserts, and updates the run row in the same transaction.
- `sandbox_runs.event_seq` stores the number of persisted events (the sequence the next event receives; 0 for an empty chain), not the last sequence. `event_hash` is the head hash (`GENESIS_HASH` when empty).
- `events`/`hash` read the run's chain; the run is the single writer (advisory lock + status).
- Events are append-only; no update/delete grant.
- `sandbox_events.payload` stores the full canonical event (including `recordedAt`/`timing` metadata; the hash excludes them).
- A replay verifier recomputes every hash and the final chain from the stored payload and compares the recomputed event count/head with the run row, so a truncated `event_seq`/`event_hash` fails closed.

`SandboxRunStore` reads/writes `engine_state`, `ledger_state` and the projections in one transaction. The JSONB state is validated by the package types on read; unknown strategy/regime keys fail closed.

## 9. API and contracts

Owner-only, same auth/CSRF as the app; no public signup. All mutations write `audit_log` and return the updated contract.

```
GET    /api/v1/sandbox/overview
GET    /api/v1/sandbox/tokens
POST   /api/v1/sandbox/tokens
PATCH  /api/v1/sandbox/tokens/:id
POST   /api/v1/sandbox/tokens/:id/refresh
GET    /api/v1/sandbox/coverage
GET    /api/v1/sandbox/runs
POST   /api/v1/sandbox/runs                 (draft)
GET    /api/v1/sandbox/runs/:id
PATCH  /api/v1/sandbox/runs/:id             (draft only)
POST   /api/v1/sandbox/runs/:id/start
POST   /api/v1/sandbox/runs/:id/pause
POST   /api/v1/sandbox/runs/:id/resume
POST   /api/v1/sandbox/runs/:id/stop
POST   /api/v1/sandbox/runs/:id/archive
POST   /api/v1/sandbox/runs/:id/close/:tokenId
GET    /api/v1/sandbox/runs/:id/positions
GET    /api/v1/sandbox/runs/:id/trades
GET    /api/v1/sandbox/runs/:id/intents
GET    /api/v1/sandbox/runs/:id/events?afterSeq=&limit=
GET    /api/v1/sandbox/runs/:id/equity
GET    /api/v1/sandbox/runs/:id/report.json
GET    /api/v1/sandbox/runs/:id/report.md
```

Zod contracts live in `@nexter/contracts`. Monetary values are decimal strings. The API never exposes secrets, keys or wallet data.

## 10. UI

A top-level `Песочница` sidebar/mobile entry (`/sandbox`), independent of old AI. Russian, light theme, USD, existing components.

- **Обзор:** active run summary (equity, P&L, drawdown, cash, positions), equity chart, token regime/phase/health, last decision, data freshness; start/pause/stop controls.
- **Запуски:** list with status/equity/return; create draft (name, universe, capital, limits), start/pause/resume/stop/archive; run detail.
- **Журнал:** events, intents (filled/partial/rejected/expired), trades, risk checks, "why not" alternatives; filters by token/type/severity.
- **Отчёты:** JSON/Markdown download for the selected run; summary cards. The report is labelled `live-paper`, its hash is deterministic, and it recomputes the same equity as the dashboard/equity point from exact marks. Pending intents and omitted counterfactuals are stated explicitly; archived runs remain downloadable read-only.
- **Настройки запуска:** Stage 1B/1C defaults (positions, exposure, cash buffer, daily loss, max DD, risk, cooldown, fees/slippage) with a "reset to defaults" action; the owner cannot edit while running.
- **Close trade:** a ConfirmDialog from a position card; the next tick sells; a toast/status.

The UI must not offer manual buy/add/override or real execution. Empty/loading/error states are explicit; a failed run shows the error and the last report.

## 11. Security and operations

- Owner-only; reuse auth/2FA/CSRF/rate limits; no new public routes.
- No secrets, keys, seed phrases, wallets, signing or real ledger. Paper money only.
- Every mutation audited (`sandbox.*`); events append-only; no DELETE grant.
- Feature flag `SANDBOX_ENABLED` (default on for the owner; off hides the nav/API/runner) and a rollback: stop runners, disable the flag, keep tables/reports.
- Runner: advisory lock, single writer per run, stale-tick/last-error health, graceful shutdown.
- Migration `0052` is additive; before production apply, take an encrypted backup, verify restore, record SHA-256 and rollback (disable flag + revert code; tables can remain inert).
- Health: `GET /sandbox/overview` exposes last tick, active runs, failed runs, data staleness; `/health` remains the service probe.
- No third-party analytics/trackers.

## 12. Testing

- Schema/migration: tables, indexes, grants, no DELETE on events; migration applied in the test DB.
- Data: candle ingestion/upsert/coverage, source fallbacks, synthetic flags, stale/gap reporting; no old tables.
- Event log: hash chain, seq, payload round-trip, append-only, replay verification.
- Runner: fake clock/quote; bar detection, next-quote fill, fees/slippage/liquidity, cooldowns, manual close, pause/resume/stop, error/failed path, reconciliation failure.
- API: owner-only, contracts, audit, lifecycle transitions, invalid transitions (409), report endpoints.
- UI: run setup validation, start/pause/stop, dashboard, journal filters, report download, empty/error states.
- End-to-end: a fake-clock live run produces a deterministic persisted chain and report; a short real-quote smoke (no real money) before sign-off.
- Security: no secrets/old imports; CSRF/auth; audit.

## 13. Review gate

Independent review after each task and one Stage 2 whole-branch review. Gate:

- schema isolation and grants; no old AI tables/imports;
- live fills are look-ahead-free and labelled;
- persistence/reconciliation/event chain survive restart;
- owner-only controls and audit; no real money/wallets;
- UI covers the owner workflows without manual buys;
- data staleness/coverage and failure paths are explicit;
- feature flag/rollback and backup plan verified.

Stage 3 (4–8 week forward paper run) must not start until Stage 2 is signed off and the owner accepts the Stage 2 report.

## 14. Success criteria

1. Owner can create, start, pause, resume, stop and archive a sandbox run from the UI.
2. The live loop advances on new 1h bars, persists state/events, and survives an API restart.
3. Dashboard/journal/report show the same equity, positions, trades and events as the persisted ledger.
4. No manual buy/add/real execution path exists; only pause/stop/close-trade.
5. No old AI/legacy import or table is used.
6. Reconciliation and event-chain verification pass for every tick.
7. A short live-quote smoke and a fake-clock end-to-end test pass; the feature flag/rollback works.
8. Independent Stage 2 review clean; owner accepts the Stage 2 report.

## 15. Open assumptions

- The owner's token universe has 1h history from GeckoTerminal/Binance/CoinGecko; tokens without 180 days can start with a warning and reduced confidence.
- Railway runs one API instance; the advisory lock protects against overlap if it scales.
- The existing `market-data` HTTP clients are reusable; no old AI service/table is imported.
- Live fills are paper approximations at the first quote after the close; not exchange fills.
- Reports are JSON/Markdown; a PDF export is a later enhancement.

## 15.1 Stage 3 follow-ups (not addressed in Stage 2)

- The event log replays/copies the full run chain on every tick, which is O(n²) I/O over a long forward run; a snapshot/checkpoint or incremental chain loader is a Stage 3 item.
- Event payloads are hashed after JSONB storage; the current canonical stringify/round-trip is stable, but any future change to JSON canonicalization or hash-visible fields needs an explicit replay/migration plan.
