# Sandbox Stage 2 — Песочница UI, live paper loop and persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the signed-off sandbox core as an owner-facing `Песочница` with persistent runs, a live paper loop on 1h data, an auditable event/ledger store, owner controls, and dashboard/journal/report UI.

**Architecture:** New `apps/api/src/modules/sandbox/` module importing `@nexter/sandbox-core`; new additive `sandbox_*` Postgres tables (Drizzle + migration `0052`); a 60-second advisory-locked runner that advances each running run on a new closed 1h bar; a new `apps/web/src/features/sandbox/` section with `Обзор`/`Запуски`/`Журнал`/`Отчёты`; a feature flag `SANDBOX_ENABLED`.

**Tech Stack:** NestJS, Fastify, Drizzle/Postgres, React 19 + TanStack Router/Query, Zod contracts, decimal.js, `@nexter/sandbox-core`.

**Design:** `docs/superpowers/specs/2026-11-24-sandbox-stage-2-ui-live-design.md`

**ADR:** `docs/adr/0084-sandbox-stage-2-ui-live.md`

**Base:** Stage 1C merged as `3771b67`; owner accepted the Stage 1 report on 2026-11-24.

**Status:** Stage 2 independently signed off; owner acceptance pending. Final code head `2e631c4`, final docs head `2d100b0`; report `docs/reviews/2026-11-25-sandbox-stage-2-report.md`.

## Global Constraints

- Paper only. No real money, exchange execution, wallets, keys, signing or swaps. The real ledger is untouched.
- No imports from old AI/`ai-trading`/`trading-bots`/old search; no reads/writes of `market_candles` or `ai_*` tables. The sandbox uses its own `sandbox_*` schema and the existing market-data HTTP clients.
- Owner-only API/UI; reuse auth/2FA/CSRF/rate limits; no public signup.
- Every mutation writes `audit_log`. Events are append-only; no DELETE grants.
- Money is decimal strings in core/API/contracts; DB numeric/decimal. No JS floats for money.
- Live fills are paper approximations at the first quote after the closed bar; the report labels `live-paper`.
- Same 1h decision cadence, Stage 1B/1C rules and defaults; no strategy/risk changes.
- The Stage 1B/1C package behavior must remain unchanged; its golden tests must keep passing.
- Migration `0052` is additive; take an encrypted backup and document rollback before production apply.
- Feature flag `SANDBOX_ENABLED`; off hides the nav/API/runner and leaves tables inert.
- No third-party analytics/trackers; no secrets in logs/events/screenshots.
- Run `npx pnpm@10.20.0` from the repo root; tests/typecheck/lint/format green per task.

## Review Focus

1. **Schema isolation and grants** — new tables only, no DELETE on events, no old-AI coupling. Tested in Task 1.
2. **Look-ahead and live fill honesty** — decision on closed candles, fill at the first quote after the close, labelled live-paper. Tested in Task 4.
3. **Persistence/restart** — engine/ledger/event chain/equity survive a restart; replay verifies the chain. Tested in Tasks 3/4/8.
4. **Owner controls and autonomy** — start/pause/resume/stop/close only; no manual buy/add; invalid transitions 409; audit. Tested in Tasks 4/5/7.
5. **Report truth** — dashboard/journal/report agree with the persisted ledger and events. Tested in Tasks 5/8.
6. **Rollback/security** — feature flag, owner-only, no secrets/real money. Tested in Task 8.

---

## File Structure

```
packages/db/src/schema/index.ts                 + sandbox_* tables
packages/db/drizzle/0052_sandbox_stage2.sql     additive migration + grants
packages/db/drizzle/meta/_journal.json          migration journal

apps/api/package.json                           + @nexter/sandbox-core
apps/api/src/app.module.ts                      + SandboxModule
apps/api/src/shared/config/env.ts               + SANDBOX_ENABLED
apps/api/src/modules/sandbox/
  sandbox.module.ts
  sandbox.controller.ts                         owner-only API
  sandbox.repository.ts                         Drizzle queries
  sandbox-tokens.service.ts
  sandbox-data.service.ts
  sandbox-event-log.ts
  sandbox-live-broker.ts
  sandbox-run.service.ts
  sandbox-runner.service.ts
  sandbox-report.service.ts
  sandbox.types.ts
  tests

packages/contracts/src/sandbox.ts               Zod contracts
apps/web/src/features/sandbox/                  page/tabs/forms/hooks
apps/web/src/app/router.tsx                     + /sandbox
apps/web/src/app/root-layout.tsx                + nav entry
apps/web/src/lib/i18n.ts                        + nav/page messages
```

Tests are co-located. Use existing app patterns for auth guards, audit, DB DI, money, UI components and TanStack Query.

---

### Task 1: ADR, sandbox schema/migration, feature flag and API module scaffold

**Files:**

- Create: `docs/adr/0084-sandbox-stage-2-ui-live.md` (already authored by the controller; verify/commit)
- Modify: `docs/decisions.md` (already authored)
- Modify: `docs/superpowers/specs/2026-11-24-sandbox-stage-2-ui-live-design.md` (status)
- Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/drizzle/0052_sandbox_stage2.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`
- Modify: `apps/api/package.json` (+ `@nexter/sandbox-core`)
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/shared/config/env.ts` (+ `SANDBOX_ENABLED`, default true)
- Create: `apps/api/src/modules/sandbox/sandbox.module.ts`
- Create: `apps/api/src/modules/sandbox/sandbox.controller.ts` (status only)
- Create: `apps/api/src/modules/sandbox/sandbox.types.ts`
- Create: `apps/api/src/modules/sandbox/sandbox.module.spec.ts` (status/flag)

**Produces:** the sandbox schema and an owner-only `GET /api/v1/sandbox/status` returning `{enabled, version}`; no run/data behavior yet.

- [ ] **Step 1: Schema**

Add the `sandbox_*` tables to the Drizzle schema. Follow the existing column/typing/index style. Required tables and key columns:

- `sandbox_tokens`: `id uuid pk`, `userId`, `tokenKey` text, `symbol`, `name`, `chain`, `contractAddress`, `coingeckoId`, `enabled` boolean, timestamps; unique `(userId, tokenKey)`.
- `sandbox_candles`: `tokenKey`, `timeframe`, `openTime` timestamptz, `open/high/low/close/volumeUsd` numeric(30,18), `source`, `fetchedAt`; pk `(tokenKey, timeframe, openTime)`.
- `sandbox_runs`: `id uuid pk`, `userId`, `name`, `status` (`draft|running|paused|stopped|failed`), `initialCapitalUsd`, `cashUsd`, `equityUsd`, `peakEquityUsd`, `dayStartEquityUsd` numeric(18,2), `settings` jsonb, `engineState` jsonb, `ledgerState` jsonb, `lastBarClose` timestamptz nullable, `eventSeq` int default 0, `eventHash` text, `lastTickAt`, `error`, `createdAt/updatedAt/startedAt/pausedAt/stoppedAt/archivedAt`.
- `sandbox_run_tokens`: `runId`, `tokenKey`, `symbol`, `chain`, `contractAddress`, `enabled`; pk `(runId, tokenKey)`.
- `sandbox_events`: `runId`, `seq`, `clockTime`, `module`, `eventType`, `severity`, `tokenId`, `strategyId`, `regime`, `payload` jsonb, `hash`, `prevHash`, `recordedAt`; pk `(runId, seq)`.
- `sandbox_positions`: `runId`, `tokenId`, `strategyKey`, `strategyVersion`, `amount`, `avgCostUsd`, `costBasisUsd`, `marketPriceUsd`, `marketValueUsd`, `openedAt`, `stopLossPct`, `takeProfitPct`, `feesPaidUsd`; pk `(runId, tokenId)`.
- `sandbox_trades`: `runId`, `tradeId`, `tokenId`, `strategyKey`, `strategyVersion`, entry fields, exit fields, `entryCostBasisUsd`, `realizedPnlUsd`, `status`; pk `(runId, tradeId)`.
- `sandbox_ledger_entries`: `runId`, `sequence`, `entryId`, `clockTime`, `tokenId`, `side`, `intentId`, `amount`, `priceUsd`, `notionalUsd`, `feeUsd`, `costBasisReleasedUsd`, `positionCostBasisAfterUsd`, `cashAfterUsd`, `positionAmountAfter`, `positionAvgCostAfter`, `realizedPnlUsd`, `reasonCode`; pk `(runId, sequence)`.
- `sandbox_equity_points`: `runId`, `clockTime`, `equityUsd`, `cashUsd`, `positionsValueUsd`, `drawdownPct`; pk `(runId, clockTime)`.
- `sandbox_intents`: `runId`, `intentId`, `tokenId`, `side`, `strategyKey`, `strategyVersion`, `status`, `requestedUsd`, `requestedAmount`, `filledUsd`, `filledAmount`, `priceUsd`, `feeUsd`, `reasonCode`, `strategyReasonCode`, `reasonText`, `decisionTime`, `fillTime`; pk `(runId, intentId)`.
- `sandbox_reports`: `runId`, `reportHash`, `report` jsonb, `createdAt`; pk `(runId, reportHash)`.

Indexes: runs `(userId, status, archivedAt)`, events `(runId, clockTime)`, equity pk, intents `(runId, decisionTime)`, candles pk, tokens unique. FKs to `users`/`sandbox_runs` where the existing style uses them; no cascade deletes.

- [ ] **Step 2: Migration and grants**

Generate/add migration `0052_sandbox_stage2.sql` following the existing journal pattern. Include `GRANT` for the app role:

- `SELECT, INSERT, UPDATE` on tokens, candles, runs, run_tokens, positions, trades, ledger_entries, equity_points, intents, reports;
- `SELECT, INSERT` only on `sandbox_events`;
- sequence usage as needed;
- no DELETE.

Add indexes declared in Drizzle. Run `npx pnpm@10.20.0 db:generate`/the repo's migration workflow; do not hand-edit generated SQL unless the repo pattern requires it.

- [ ] **Step 3: API dependency**

Add `"@nexter/sandbox-core": "workspace:*"` to `apps/api/package.json`; run `pnpm install`; commit `pnpm-lock.yaml`. Confirm `pnpm --filter @nexter/api build` resolves the package (build order; if needed, add the package to the API build pipeline/tsconfig references).

- [ ] **Step 4: Feature flag and module scaffold**

Add `SANDBOX_ENABLED` to the env schema (boolean, default true). Register `SandboxModule` in `app.module.ts`. Add `GET /api/v1/sandbox/status` (owner-only guard) returning `{enabled, version: 'sandbox-stage-2'}`; when disabled return `{enabled:false}` or 404 per the app's feature-flag pattern. Do not add run/data endpoints yet.

- [ ] **Step 5: Tests**

- migration/test DB creates the tables/indexes/grants; `sandbox_events` has only SELECT/INSERT for the app role;
- status requires auth and returns the flag;
- module boots with the sandbox-core dependency;
- existing API tests unaffected.

- [ ] **Step 6: Verify and commit**

```bash
npx pnpm@10.20.0 --filter @nexter/api test
npx pnpm@10.20.0 --filter @nexter/api typecheck
npx pnpm@10.20.0 --filter @nexter/api build
npx pnpm@10.20.0 lint
npx pnpm@10.20.0 format:check
git add packages/db apps/api apps/api/package.json pnpm-lock.yaml docs
git commit -m "feat(sandbox): add stage 2 schema and api scaffold"
```

---

### Task 2: Sandbox token universe, candle ingestion and coverage

**Files:**

- Create: `apps/api/src/modules/sandbox/sandbox-data.service.ts`
- Create: `apps/api/src/modules/sandbox/sandbox-tokens.service.ts`
- Create: `apps/api/src/modules/sandbox/sandbox.repository.ts`
- Create: `packages/contracts/src/sandbox.ts` (token/coverage schemas; export from the contracts index)
- Modify: `apps/api/src/modules/sandbox/sandbox.controller.ts` (owner-only token/coverage endpoints)
- Modify: `apps/api/src/modules/sandbox/sandbox.module.ts`
- Tests: service/controller specs with fake market clients; DB test DB.

- [ ] **Step 1: Contracts and universe CRUD**

Zod schemas for `SandboxToken` (id, tokenKey, symbol, name, chain, contractAddress, coingeckoId, enabled), create/patch, and `SandboxCoverage` (tokenKey, timeframe, available, required, first/last, gaps, synthetic, stale). Endpoints: `GET/POST /sandbox/tokens`, `PATCH /sandbox/tokens/:id`, `POST /sandbox/tokens/:id/refresh`, `GET /sandbox/coverage`. Owner-only; audit mutations (`sandbox.token_created`/`updated`/`refreshed`).

- [ ] **Step 2: Data service**

Reuse `GeckoTerminalClient`, `BinanceClient`, `CoinGeckoClient` from `market-data` (HTTP only; no old AI service/table). For a token, fetch 1h OHLCV for the last 180 days (or the provider max), normalize to decimal strings, upsert `sandbox_candles` by PK in chunks. GeckoTerminal for BSC/ETH contracts, Binance for the curated majors, CoinGecko 1h synthetic fallback marked `synthetic`. Serialize requests with the existing client behavior; no 429 retry storm.

- [ ] **Step 3: Coverage**

Compute available/required (180d × 24), first/last, gap count, synthetic flag and staleness (last close vs now). A start/preflight helper returns `ok|partial|missing` and a warning. No fabricated gaps beyond the labelled synthetic source.

- [ ] **Step 4: Tests**

- CRUD + audit + owner guard;
- upsert idempotency and decimal strings;
- source fallback and synthetic flag with fake clients;
- coverage counts/gaps/stale;
- no `market_candles`/`ai_*` query or old module import (targeted grep in review).

- [ ] **Step 5: Verify and commit**

```bash
git add packages/contracts apps/api/src/modules/sandbox
git commit -m "feat(sandbox): add token universe and candle data"
```

---

### Task 3: DB event log, run store and projections

**Files:**

- Create: `apps/api/src/modules/sandbox/sandbox-event-log.ts`
- Create: `apps/api/src/modules/sandbox/sandbox.repository.ts` (extend)
- Create: `apps/api/src/modules/sandbox/sandbox.types.ts` (run/state types)
- Tests: event-chain spec, run-store spec, projection spec.

- [ ] **Step 1: Event log**

`SandboxEventLog implements EventLog` over `sandbox_events`:

- `append(input)`: validate with the Stage 1A schema; read the run's `eventSeq`/`eventHash` (or the last event) inside the tick transaction; build the chained event with the Stage 1A hash; insert; update the run's seq/hash. The runner is the single writer (advisory lock).
- `eventSeq` is the event count / next sequence (0 for empty), not the last seq; `eventHash` is the head hash (genesis when empty).
- `events()`/`hash()` load the run's chain; a `verify()` helper recomputes every hash and the final hash from the stored payload and compares the count/head with the run row.
- Events append-only; no update/delete.

- [ ] **Step 2: Run store**

Persist `engine_state`, `ledger_state` (JSONB) plus the run cash/equity/peak/day-start/status/lastBarClose/eventSeq/eventHash; validate the state shapes on read; reject unknown strategy/regime keys. One transaction per tick for state + projections + events.

- [ ] **Step 3: Projections**

Write `sandbox_positions` (from the ledger), `sandbox_trades` (closed + open), `sandbox_ledger_entries`, `sandbox_equity_points` and `sandbox_intents` from the Stage 1C results. Idempotent for a tick (delete-free upsert by PK; the harness may overwrite a projection row with the same key, but events/state remain append-only/versioned by the run).

- [ ] **Step 4: Tests**

- seq starts 0, genesis prevHash, hash chain links, append-only;
- replay/verify after reload; corrupted payload detected;
- engine/ledger state round-trip, unknown key rejected;
- projections match the ledger/trades/intents; transaction rollback leaves no partial state;
- no DELETE grant used.

- [ ] **Step 5: Verify and commit**

```bash
git add apps/api/src/modules/sandbox packages/db
git commit -m "feat(sandbox): persist runs, events and projections"
```

---

### Task 4: Live runner, broker, lifecycle and owner controls

**Files:**

- Create: `apps/api/src/modules/sandbox/sandbox-live-broker.ts`
- Create: `apps/api/src/modules/sandbox/sandbox-runner.service.ts`
- Create: `apps/api/src/modules/sandbox/sandbox-run.service.ts`
- Modify: `apps/api/src/modules/sandbox/sandbox.controller.ts` (start/pause/resume/stop/archive/close)
- Tests: runner with fake clock/quote/data, broker math, lifecycle.

- [ ] **Step 1: Live broker**

Use Stage 1C `planBuyFill`/`planSellFill`/`applyBuyFill`/`applySellFill` with a synthetic fill candle `{open: quote.price, volumeUsd: lastClosedBar.volumeUsd}`; fees/slippage/liquidity from the run settings; IOC; rejection/expiry. No historical close as fill. A `live-paper` execution mode.

- [ ] **Step 2: Runner**

60-second interval + `pg_try_advisory_lock('nexter:sandbox-runner')`, enabled only when `SANDBOX_ENABLED` and not test. For each running run: load state; fetch/upsert candles; find a new closed bar `> lastBarClose`; fill pending intents/manual close; mark portfolio/equity/dayStart/peak; build `ClockedMarketView` + `DecisionEngine`; persist state/events/projections; reconcile; on failure set `failed` with the error. Stale/missing data: skip with a health warning, not a crash.

- [ ] **Step 3: Lifecycle/controls**

Draft create/edit; start validates config/tokens/coverage, freezes config, initializes the ledger (`createLedger(initial)`) and the engine state (`{ tokens: {} }`) in the same transaction that sets `running` (a non-draft run with `{}` must fail closed), then pause/resume/stop; archive only terminal; close trade queues a manual sell for the next tick; invalid transitions return 409; every mutation audits. No manual buy/add.

- [ ] **Step 4: Tests**

- new-bar detection, no duplicate tick for the same bar;
- quote fill price/fees/slippage/liquidity, partial/reject;
- engine integration and next state;
- cooldown after stop; manual close;
- pause/resume/stop/start idempotency/409;
- reconciliation failure → failed;
- restart/reload from persisted state;
- fake clock determinism (two identical ticks/states).

- [ ] **Step 5: Verify and commit**

```bash
git add apps/api/src/modules/sandbox apps/api/src/app.module.ts
git commit -m "feat(sandbox): add live paper runner and controls"
```

---

### Task 5: Read API, contracts and reports

**Files:**

- Modify: `apps/api/src/modules/sandbox/sandbox.controller.ts`
- Create: `apps/api/src/modules/sandbox/sandbox-report.service.ts`
- Modify: `packages/contracts/src/sandbox.ts`
- Tests: API e2e for overview/runs/detail/positions/trades/intents/events/equity/report; owner-only; 404/409.

- [ ] **Step 1: Read endpoints**

Implement the design §9 read endpoints: overview, runs list/detail, positions, trades, intents, events (`afterSeq`, limit), equity, report.json, report.md. Use the persisted projections/state; paginate; no-store; decimal strings; owner-only. Report generation uses the Stage 1C `buildReport`/`renderMarkdown` over the persisted state/events/final marks; the `live-paper` label; no wall-clock in the report hash.

- [ ] **Step 2: Tests**

- contracts parse/round-trip;
- owner-only/auth/404/409;
- dashboard/journal/report agree with the DB state;
- report hash stable for the same persisted run;
- events pagination/seq;
- no secrets/old imports.

- [ ] **Step 3: Verify and commit**

```bash
git add apps/api/src/modules/sandbox packages/contracts
git commit -m "feat(sandbox): add read api and reports"
```

---

### Task 6: UI shell, navigation, run list and setup

**Files:**

- Create: `apps/web/src/features/sandbox/sandbox-page.tsx`
- Create: `apps/web/src/features/sandbox/sandbox-api.ts` (or hooks)
- Create: `apps/web/src/features/sandbox/*` (tabs/list/setup)
- Modify: `apps/web/src/app/router.tsx` (+ `/sandbox`)
- Modify: `apps/web/src/app/root-layout.tsx` (nav)
- Modify: `apps/web/src/components/nav-icon.tsx` if a new icon is needed
- Modify: `apps/web/src/lib/i18n.ts` (`Песочница` etc.)
- Tests: route/nav, setup validation, list/empty, start/pause/stop wiring.

- [ ] **Step 1: Shell**

Top-level `Песочница` nav (desktop/mobile), route `/sandbox`, page heading and tabs `Обзор`/`Запуски`/`Журнал`/`Отчёты` (hash/deep link). The nav is hidden when `SANDBOX_ENABLED` is false.

- [ ] **Step 2: Run list/setup**

List runs with status/equity/return; create draft with name, token universe, initial capital and Stage 1B/1C settings (defaults + reset); validation; start/pause/resume/stop/archive actions with ConfirmDialog; owner-only errors; loading/empty/error states.

- [ ] **Step 3: Tests**

- nav/route/flag hidden;
- setup validation (capital, tokens, settings);
- list/empty/status;
- start/stop mutation calls and cache invalidation;
- Russian labels/theme.

- [ ] **Step 4: Verify and commit**

```bash
git add apps/web/src/features/sandbox apps/web/src/app apps/web/src/lib/i18n.ts
git commit -m "feat(sandbox): add песочница shell and run setup"
```

---

### Task 7: UI dashboard, journal, reports, controls and health

**Files:**

- Create: `apps/web/src/features/sandbox/sandbox-dashboard.tsx`
- Create: `apps/web/src/features/sandbox/sandbox-journal.tsx`
- Create: `apps/web/src/features/sandbox/sandbox-reports.tsx`
- Create: `apps/web/src/features/sandbox/sandbox-health.tsx`
- Modify: page/tabs/hooks
- Tests: dashboard numbers/positions, journal filters/pagination, report download, close trade, health/empty/error.

- [ ] **Step 1: Dashboard**

Equity chart (reuse the existing chart patterns), equity/P&L/DD/cash/positions, token regime/phase/health, last decision, data freshness; start/pause/stop; close-trade action on a position (ConfirmDialog, next-tick note).

- [ ] **Step 2: Journal/reports**

Events/intents/trades/risk checks with filters (token/type/severity) and pagination; "why not" alternatives; JSON/Markdown download; report summary; failed-run error state.

- [ ] **Step 3: Tests**

- dashboard values match contracts;
- filters/pagination;
- close-trade confirm/error;
- report download;
- empty/loading/error;
- no manual buy/add UI.

- [ ] **Step 4: Verify and commit**

```bash
git add apps/web/src/features/sandbox
git commit -m "feat(sandbox): add dashboard, journal and reports"
```

---

### Task 8: Fake-clock end-to-end, live smoke, security/ops, Stage 2 review packet

**Files:**

- Create: `apps/api/test/sandbox.e2e-spec.ts` (fake clock/quote/data, persisted chain, restart, controls)
- Create: `docs/reviews/2026-11-24-sandbox-stage-2-review-request.md`
- Modify: design/plan status
- Tests/gates.

- [ ] **Step 1: Fake-clock e2e**

Start a run with a fake data/quote service; advance several 1h bars; assert decisions/fills/ledger/equity/events persist; restart the API/app module and continue from the state; verify the event chain; pause/resume/stop/close; report hash; invalid transitions; no manual buy.

- [ ] **Step 2: Live smoke**

With `SANDBOX_ENABLED` and a small universe, create/start a run in a non-production environment for a short period (or a dry-run tick) and verify data ingestion, a tick, a persisted event, the dashboard/report and stop. No real money. Record evidence; do not leave a running production run unless the owner explicitly starts one.

- [ ] **Step 3: Security/ops**

Owner-only endpoints, auth/CSRF, audit coverage, no secrets/old imports, no DELETE grants, feature flag off behaves, advisory lock, restart recovery, migration/backup/rollback plan.

- [ ] **Step 4: Full gate**

```bash
npx pnpm@10.20.0 test
npx pnpm@10.20.0 typecheck
npx pnpm@10.20.0 build
npx pnpm@10.20.0 lint
npx pnpm@10.20.0 format:check
```

Plus the sandbox e2e and the existing Stage 1B/1C goldens. Fix failures; do not weaken tests.

- [ ] **Step 5: Review packet**

Scope/out-of-scope, base `3771b67`, head, commits/files, commands/outputs, schema/migration/grants, backup/rollback, data sources, live loop, controls, API/UI, audit/security, tests/evidence, deferred items, explicit gate: **Stage 2 must not start? no — Stage 3 must not start until Stage 2 is signed off and the owner accepts the Stage 2 report.**

- [ ] **Step 6: Status and stop**

Set design/plan status to `Stage 2 implemented; independent review gate`; commit the packet/docs; stop for independent review.

---

## Plan self-review

- **Spec coverage:** schema (Task 1), data (2), persistence/event log (3), runner/controls (4), read API/reports (5), UI shell/setup (6), dashboard/journal/reports (7), e2e/live smoke/security/review (8).
- **Review focus:** isolation/grants (1), look-ahead/fill honesty (4), persistence/restart (3/4/8), controls/autonomy (4/5/7), report truth (5/8), rollback/security (8).
- **Type consistency:** `sandbox_*` schema ↔ contracts ↔ repository ↔ services ↔ UI; the core package types are imported, not duplicated.
- **Money safety:** decimal strings at the core/API/contracts; DB numeric; no JS floats.
- **Scope guard:** paper only; no old AI/legacy imports/tables; no real money/wallets/signing; feature flag/rollback.
- **Migration safety:** additive `0052`, no DELETE, encrypted backup/verify before production apply; rollback documented.
