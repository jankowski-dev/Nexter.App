# Adaptive Regime Strategy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `adaptive_regime` paper strategy, pass candle context to strategies, and add an exclusive legacy/adaptive search mode for a 10k pilot.

**Architecture:** `StrategyContext.candles` gives the strategy daily/4h/1h context in both backtest and live runs. The strategy is a stateful long-only regime machine (DORMANT/UPTREND/PULLBACK/CRASH/COOLDOWN/RECOVERY) with ATR/trailing exits. A native search runtime keeps the 10k pilot practical. Search/cycle requests gain `strategyMode`, defaulting to legacy (12 strategies, no adaptive); adaptive mode runs only the new strategy.

**Tech Stack:** TypeScript, NestJS, Drizzle (no migration), Zod contracts, React/Vite, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-23-adaptive-regime-strategy-design.md`

## Global Constraints

- Long-only; no shorting, leverage, auto-start or budget reallocation.
- No OOS/holdout threshold changes.
- Adaptive and legacy modes are exclusive; default is legacy.
- The adaptive strategy is manually selectable for bots/backtests in both modes.
- No migration; `market_candles` already exists.
- Russian UI; English identifiers; Decimal money.
- The 10k pilot runs before any 100k/200k or default flips.

## Review Focus

- `StrategyContext.candles` must be present in both backtest and live paths, but optional for old strategies and tests.
- The Decimal strategy and native runtime must match; a mismatch would make the search select different behavior than the bot.
- The strategy must stay DORMANT in a downtrend and not force entries.
- Cooldown/crash/trailing state must persist across ticks and folds.
- `strategyMode` must not accidentally include the adaptive strategy in legacy mode or the 12 in adaptive mode.
- Missing/short daily candles must degrade gracefully, not crash.

---

### Task 1: Candle context in backtest and live runner

**Files:**

- Modify: `apps/api/src/modules/trading-bots/strategies/types.ts`
- Modify: `apps/api/src/modules/trading-bots/backtest/backtest.engine.ts`
- Modify: `apps/api/src/modules/trading-bots/bot-runner.service.ts`
- Test: `apps/api/src/modules/trading-bots/backtest/backtest.engine.spec.ts`

**Interfaces:**

- Produces: `StrategyContext.candles?: BotCandle[]`; `StrategyDefinition.candleTimeframe?: '1d' | '4h' | '1h'`.
- The backtest passes its `candles` to `evaluate`.
- The bot runner loads `market_candles` for `candleTimeframe` and passes them.

- [ ] Add a failing engine test whose strategy records `ctx.candles?.length` and asserts it equals the backtest candle count.
- [ ] Run the test, watch fail.
- [ ] Add `candles` to `StrategyContext`, pass it in `runBacktest`, and add `candleTimeframe` to `StrategyDefinition`.
- [ ] Run the test, watch pass.
- [ ] Add a failing bot-runner/unit test or code-level probe for `loadCandles` (if the runner test harness is too heavy, add a pure helper test for mapping `market_candles` rows to `BotCandle`).
- [ ] Add `loadCandles` to the bot runner, gated by `definition.candleTimeframe`; import `marketCandles`; map columns.
- [ ] Pass `candles` in the runner's `definition.evaluate` call.
- [ ] Run API typecheck and backtest tests.
- [ ] Commit.

### Task 2: Decimal adaptive regime strategy

**Files:**

- Modify: `apps/api/src/modules/trading-bots/strategies/index.ts`
- Modify: `apps/api/src/modules/trading-bots/strategies/indicators.ts` if a daily/ATR helper is missing
- Test: `apps/api/src/modules/trading-bots/strategies/strategies.spec.ts` or a new `adaptive-regime.spec.ts`

**Interfaces:**

- Produces: `adaptiveRegime` definition, key `adaptive_regime`, 8 params, stateful, long-only.
- State: `{ hwm, trailStop, cooldownUntil, phase }`.

- [ ] Write failing tests for:
  - DORMANT in a falling series (no buy);
  - buy on a pullback in an uptrend;
  - trailing exit after a rise and giveback;
  - crash exit and cooldown (no immediate re-entry);
  - recovery after cooldown/trend confirmation.
- [ ] Run tests, watch fail.
- [ ] Implement `adaptiveRegime` with daily aggregation, SMA/ATR, state machine, ATR stop, trailing, crash/cooldown.
- [ ] Add the definition to the registry and strategy icons.
- [ ] Run tests, watch pass.
- [ ] Run API typecheck and strategy tests.
- [ ] Commit.

### Task 3: Native fast runtime and parity

**Files:**

- Modify: `apps/api/src/modules/ai-trading/ai-fast-strategies.ts`
- Test: `apps/api/src/modules/ai-trading/ai-fast-backtest.spec.ts`

**Interfaces:**

- Produces native `adaptive_regime` runtime used by `createFastRuntime`.
- Parity with the Decimal strategy in `same-close` and `next-open`.

- [ ] Add a failing parity test for `adaptive_regime` (fast vs `runBacktest`) on seeded 1h candles, including a crash and a recovery.
- [ ] Run the test, watch fail.
- [ ] Implement the native runtime: precompute daily SMA/ATR and per-candle daily index; mirror the Decimal state transitions with numbers, Decimal fills.
- [ ] Run the parity test; fix any mismatch.
- [ ] Add the strategy to the all-strategy parity test.
- [ ] Run API ai-trading tests.
- [ ] Commit.

### Task 4: Exclusive search mode and UI toggle

**Files:**

- Modify: `packages/contracts/src/ai-trading.ts`
- Modify: `apps/api/src/modules/ai-trading/ai-search.helpers.ts` (generator filter)
- Modify: `apps/api/src/modules/ai-trading/ai-search.service.ts`
- Modify: `apps/api/src/modules/ai-trading/ai-cycle.service.ts`
- Modify: `apps/web/src/features/ai-trading/ai-trading-page.tsx`
- Test: `apps/web/src/features/ai-trading/ai-cycle.test.ts`
- Test: `apps/api/src/modules/ai-trading/ai-search.helpers.spec.ts`

**Interfaces:**

- Produces `strategyMode: 'legacy' | 'adaptive'` on search/cycle requests (default legacy); `generateSearchVariants(..., strategyKeys?)`.
- Search results/cycle store the mode.
- UI Switch «Только адаптивная стратегия».

- [ ] Write failing contract tests for the mode default and parsing.
- [ ] Add `strategyMode` to contracts; run tests, watch fail then pass.
- [ ] Add a generator filter test: legacy excludes `adaptive_regime`; adaptive includes only it.
- [ ] Implement the filter and service wiring.
- [ ] Add the Switch to manual search and cycle forms; send the mode; show the active mode.
- [ ] Run web/API tests and typecheck.
- [ ] Commit.

### Task 5: Docs, ADR, guide, pilot

- [ ] Add ADR 0083.
- [ ] Update `docs/decisions.md`; guide v1.4 with the strategy, states, data and toggle; rebuild PDF; bump settings `?v=5`.
- [ ] Run full `pnpm test`, typecheck, lint, build, format.
- [ ] Push/deploy; verify health/ready/bundle/PDF.
- [ ] Owner runs 10k adaptive on BASED, QUICKAI, IRYS; analyze JSONs before 100k/200k or defaults.

## Rollback

Remove `adaptive_regime` from the registry, remove the toggle/mode default, and revert the candle context. No migration; existing bots keep stored configs.
