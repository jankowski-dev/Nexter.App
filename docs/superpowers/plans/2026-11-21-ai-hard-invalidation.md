# AI Bot Hard Invalidation Signals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the read-only AI bot health monitor with hard invalidation signals: stop-loss hit, take-profit hit and stale/missing quotes for open positions.

**Architecture:** The health service already loads AI bots, candidates, equity snapshots and error events. Add open `bot_positions` and latest `market_quotes`, pass them into the pure `evaluateAiBotHealth` helper, and emit advisory `review`/`stop` reasons. The monitor never stops a bot.

**Tech Stack:** NestJS, Drizzle/Postgres, Zod, Vitest, supertest e2e.

**Spec:** `docs/plans/ai-trading-2026-11.md` §10 (Invalidation: stop/take, stale/missing data) and §11 (stale quotes 5 minutes, max DD/daily loss).

## Global Constraints

- Advisory only: never call start/stop or mutate a bot from the health monitor.
- Owner starts and stops bots manually.
- No new table or migration; reuse `bot_positions` and `market_quotes`.
- Money/price values remain decimal strings in API payloads.
- UI copy is Russian.
- A bot without percentage stop/take params (for example `static_limit`) must not receive false stop/take signals.

## Review Focus

- A missing or stale quote must not crash health evaluation or hide other reasons.
- Stopped and draft bots must not receive runtime position/quote reasons.
- Multiple positions must not duplicate the same reason code.
- Stop/take must use the bot's own strategy params, not a global default.
- Quote age uses `market_quotes.fetched_at`, not the bot tick timestamp.

---

### Task 1: Contracts and pure health signals

**Files:**

- Modify: `packages/contracts/src/ai-trading.ts`
- Modify: `apps/api/src/modules/ai-trading/ai-health.helpers.ts`
- Test: `apps/api/src/modules/ai-trading/ai-health.helpers.spec.ts`

**Interfaces:**

- Produces: reason codes `QUOTE_STALE`, `STOP_HIT`, `TAKE_HIT`; `AiHealthInput.strategyParams`, `.positions`, `.quotes`.
- Consumes: existing `AiHealthInput`/`AiHealthResult`.

- [ ] **Step 1: Write failing helper tests**

Add tests: a position at avg cost 100 with quote 94 and `stopLossPct: 5` → `STOP_HIT`/`stop`; quote 106 with `takeProfitPct: 5` → `TAKE_HIT`/`stop`; a quote older than 15 minutes → `QUOTE_STALE`/`stop`; a missing quote → `QUOTE_STALE`; a stopped bot with the same position/quote → no new reasons; two positions crossing the stop produce one `STOP_HIT`; empty `strategyParams` produces no stop/take.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx pnpm@10.20.0 --filter @nexter/api exec vitest run src/modules/ai-trading/ai-health.helpers.spec.ts`
Expected: FAIL because the fields/codes do not exist.

- [ ] **Step 3: Extend contracts and helper**

Add the three codes to `aiBotHealthReasonSchema`. Extend `AiHealthInput` with `strategyParams`, `positions` (`assetId`, `symbol`, `avgCostUsd`) and `quotes` (`Record<assetId, {priceUsd, fetchedAt}>`). In `evaluateAiBotHealth`, when `status === 'running'` and positions exist:

- quote missing or `now - fetchedAt > 15 min` → one `QUOTE_STALE` reason;
- positive `stopLossPct`/`takeProfitPct` from `strategyParams`; compute P&L vs `avgCostUsd`; crossing → one `STOP_HIT`/`TAKE_HIT` reason;
- deduplicate by code; skip invalid prices/costs.

- [ ] **Step 4: Run helper tests**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/ai-trading.ts apps/api/src/modules/ai-trading/ai-health.helpers.ts apps/api/src/modules/ai-trading/ai-health.helpers.spec.ts
git commit -m "feat: add hard AI bot invalidation signals"
```

### Task 2: Load open positions and quotes in the monitor

**Files:**

- Modify: `apps/api/src/modules/ai-trading/ai-health.service.ts`
- Test: `apps/api/test/ai-trading.e2e.spec.ts`

- [ ] **Step 1: Add the failing e2e fixture**

After the accepted draft bot is created, update it to `running` with `startedAt`, insert an open `botPositions` row at avg cost `100`, upsert a current `marketQuotes` row at `90`, then call `GET /ai-trading/bots/health` and assert the bot has `level='stop'` and `STOP_HIT`.

- [ ] **Step 2: Run it to verify it fails**

Expected: no `STOP_HIT` because the service does not load positions/quotes.

- [ ] **Step 3: Implement loading**

In `evaluateRows`, after snapshots/errors, select `botPositions` joined to `assets` for the bot ids and `marketQuotes` for the unique position asset ids. Group positions by bot and quotes by asset. Pass `strategyParams: bot.strategyParams`, positions and quotes to `evaluateAiBotHealth`.

- [ ] **Step 4: Run API tests/typecheck**

Run the AI e2e (CI or disposable Postgres), AI unit tests, `typecheck`, `lint`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/ai-trading/ai-health.service.ts apps/api/test/ai-trading.e2e.spec.ts
git commit -m "feat: evaluate AI positions against live quotes"
```

### Task 3: Verification and release

- [ ] Run full `pnpm test`, `typecheck`, `lint`, `build`.
- [ ] Open a PR, wait for CI, merge, deploy, verify `/health`, `/ready` and the bundle.
- [ ] Update `AGENTS.md`, `docs/decisions.md` and `docs/project/api.md`.

## Rollout

1. Contracts/helper signals.
2. Service position/quote loading.
3. Deploy with `/health`/`/ready` checks; no migration.
