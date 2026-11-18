# AI Strategy Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four distinct close-based strategies to the long-only paper/AI registry without schema changes.

**Architecture:** Extend shared indicators, then add four `StrategyDefinition` objects to the existing registry, extend the shared strategy key enum, add icons, and cover each strategy with deterministic unit tests. The AI lab and bot UI pick the new strategies up automatically from the registry.

**Tech Stack:** TypeScript strict, Zod, decimal.js, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-18-ai-strategy-expansion-design.md`

## Global Constraints

- Long-only; no shorting, wallets, keys or real orders.
- All prices and money remain decimal strings; use `Decimal` from the shared money module.
- Russian UI copy and strategy labels/reasons.
- Strategy params must be Zod-validated with bounded defaults.
- No database migration.
- Existing strategies and bot behavior must not change.

## Review Focus

- A breakout must compare against the **previous** N candles, not include the current candle.
- Insufficient history must return `hold`, never throw.
- Failed-breakout state must survive across candles and reset after exit.
- Parameter defaults must satisfy every field range.
- New icons must fall back safely for unknown keys.

---

### Task 1: Shared indicators

**Files:**

- Modify: `apps/api/src/modules/trading-bots/strategies/indicators.ts`
- Test: `apps/api/src/modules/trading-bots/strategies/indicators.spec.ts` (create)

**Interfaces:**

- Produces: `rollingLow(samples, period): Decimal | null`, `rollingHighBefore(samples, period): Decimal | null`, `rollingLowBefore(samples, period): Decimal | null`, `standardDeviation(samples, period): Decimal | null`, `bollingerBands(samples, period, stdDev): { mean: Decimal; upper: Decimal; lower: Decimal; bandwidthPct: Decimal } | null`.

- [ ] Write failing tests for rolling low, previous-candle channel, standard deviation and Bollinger bands.
- [ ] Run `npx pnpm@10.20.0 --filter @nexter/api exec vitest run src/modules/trading-bots/strategies/indicators.spec.ts`; expect failure.
- [ ] Implement the five helpers with `Decimal`; return `null` when `period <= 0` or history is insufficient.
- [ ] Re-run the test; expect pass.

### Task 2: Contract keys and Donchian strategy

**Files:**

- Modify: `packages/contracts/src/trading-bots.ts`
- Modify: `apps/api/src/modules/trading-bots/strategies/index.ts`
- Modify: `apps/api/src/modules/trading-bots/strategies/strategies.spec.ts`

**Interfaces:**

- Produces: `donchianBreakout: StrategyDefinition` with key `donchian_breakout`.
- Contract keys extended by `donchian_breakout`, `bollinger_reversion`, `squeeze_breakout`, `failed_breakout`.

- [ ] Extend `botStrategyKeys` with the four keys.
- [ ] Add `donchianBreakout` to `strategyDefinitions`.
- [ ] Add tests: buys above prior channel high, holds inside channel/insufficient history, sells on take-profit/stop-loss/opposite channel.
- [ ] Run the strategy spec; expect failure, implement, re-run.

### Task 3: Bollinger reversion and squeeze breakout

**Files:**

- Modify: `apps/api/src/modules/trading-bots/strategies/index.ts`
- Modify: `apps/api/src/modules/trading-bots/strategies/strategies.spec.ts`

**Interfaces:**

- Produces: `bollingerReversion`, `squeezeBreakout` strategy definitions.

- [ ] Add tests for lower-band buy, mean exit, take-profit/stop-loss; squeeze buy only when bandwidth is compressed and price breaks the upper band; hold outside squeeze.
- [ ] Implement both with `bollingerBands`.
- [ ] Run tests; expect pass.

### Task 4: Failed breakout, registry expectations and icons

**Files:**

- Modify: `apps/api/src/modules/trading-bots/strategies/index.ts`
- Modify: `apps/api/src/modules/trading-bots/strategies/strategies.spec.ts`
- Modify: `apps/web/src/features/testing/strategy-icon.tsx`

**Interfaces:**

- Produces: `failedBreakout` with state `{ breakdownLevel: string }`.

- [ ] Add tests: holds on breakdown, buys on reclaim, resets state after exit, take-profit/stop-loss.
- [ ] Implement `failedBreakout`; clear state when a position is closed.
- [ ] Update registry test to expect 11 templates and the new key order.
- [ ] Add four icon visuals with safe fallback.
- [ ] Run `pnpm format`, `pnpm typecheck`, `pnpm lint`, API tests, web tests, `pnpm build`.
- [ ] Commit.
