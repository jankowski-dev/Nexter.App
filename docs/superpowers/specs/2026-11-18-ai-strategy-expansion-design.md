# AI Strategy Expansion Design

**Date:** 2026-11-18
**Status:** approved by owner request "Добавляй 4 разные стратегии"
**Scope:** AI trading strategy registry, long-only paper engine, no schema change.

## Intent

The registry currently has seven strategies but only three distinct behaviours: trend/momentum,
range/mean-reversion and crash protection. The AI lab needs more genuinely different candidates so
it can cover transitions, false breakouts and different volatility regimes without adding
near-duplicates.

This change adds four close-based strategies. They fit the current `StrategyContext` (close
history, current price, position, buy count, optional state) and need no new market data or
database tables.

## Strategies

### 1. `donchian_breakout` — Пробой канала

Buys when the current close breaks above the highest close of the previous `channelPeriod` candles
(plus a small buffer). Exits on the opposite channel, take-profit or stop-loss. Unlike
`momentum_breakout`, it does not require SMA alignment or a 24h change threshold.

Parameters:

- `channelPeriod` 5–200, default 20
- `exitPeriod` 3–100, default 10
- `breakoutBufferPct` 0–5, default 0.2
- `takeProfitPct` 0.1–100, default 10
- `stopLossPct` 0.1–50, default 5

### 2. `bollinger_reversion` — Возврат к Bollinger

Buys when price closes below the lower Bollinger band and exits when price returns above the mean
plus a small buffer, take-profit or stop-loss. Unlike `mean_reversion`, the entry threshold adapts
to recent volatility.

Parameters:

- `period` 10–100, default 20
- `stdDev` 0.5–5, default 2
- `exitAboveMeanPct` 0–10, default 0.5
- `takeProfitPct` 0.1–100, default 8
- `stopLossPct` 0.1–50, default 5

### 3. `squeeze_breakout` — Выход из сжатия

Buys only when Bollinger bandwidth is compressed and price closes above the upper band; exits on a
return below the mean, take-profit or stop-loss. It targets the transition from a quiet range into
a directional move.

Parameters:

- `period` 10–100, default 20
- `stdDev` 1–4, default 2
- `squeezeThresholdPct` 0.5–10, default 2
- `breakoutBufferPct` 0–5, default 0.2
- `takeProfitPct` 5–50, default 12
- `stopLossPct` 1–20, default 5

### 4. `failed_breakout` — Неудавшийся пробой

Long-only failed breakdown: when price closes below prior support, the strategy remembers that
level; if price then closes back above it, it buys the reclaim. Exits on take-profit or stop-loss.
State is stored in `StrategyContext.state`, so it works in both backtests and paper bots.

Parameters:

- `lookback` 10–100, default 20
- `breakdownBufferPct` 0–5, default 0.5
- `takeProfitPct` 5–30, default 8
- `stopLossPct` 1–20, default 4

## Shared indicators

Add to `strategies/indicators.ts`:

- `rollingLow(samples, period)`
- `rollingHighBefore(samples, period)` and `rollingLowBefore(samples, period)` (exclude current candle)
- `standardDeviation(samples, period)`
- `bollingerBands(samples, period, stdDev)` returning mean/upper/lower/bandwidth percent

All use `Decimal` and return `null` when history is insufficient.

## Contracts and UI

- Extend `botStrategyKeys` in `packages/contracts/src/trading-bots.ts` with the four keys.
- Add four icons to `apps/web/src/features/testing/strategy-icon.tsx`: `channel`, `bands`, `squeeze`,
  `reversal`.
- The AI lab, strategy cards, bot form and backtest UI consume the registry automatically.

## Non-goals

- No shorting, pairs trading, order-book, volume or ATR strategies. Those need a wider market-data
  context and are a later phase.
- No `no_trade` pseudo-strategy in this change; that needs an explicit candidate state and UI.
- No schema migration, no real orders, no wallet/signing changes.

## Verification

- Registry count and key order updated in `strategies.spec.ts`.
- Each strategy gets buy/hold/sell tests with deterministic close histories.
- Parameter validation tests for new schemas.
- Existing backtest engine tests must remain green.
- `pnpm format`, typecheck, lint, API tests, web tests and build.
- CI e2e/analysis will automatically see the new registry entries.

## Rollback

Revert the feature commit; no migration or data changes. Existing bots keep their stored strategy
keys and are unaffected.
