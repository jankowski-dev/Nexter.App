# ADR 0055 — Trailing stop strategy

## Status

Accepted for UI-62 on 2026-11-16. No migration.

## Context

The strategy registry had momentum, mean reversion, grid, trend pullback, DCA and a crash-protected grid, but no way to let a winner run while protecting accumulated profit. The owner asked for a Trailing Stop module.

## Decision

Add the system strategy `trailing_stop` (`Трейлинг-стоп`) to the code registry.

- Entry: a close above the highest close of the previous `entryLookback` days plus `breakoutBufferPct`.
- While in a position, the strategy persists the maximum price in `StrategyState.peak`.
- Before activation, a hard stop at `hardStopPct` below average cost protects the position.
- Once the peak reaches `activationPct` above average cost, a trailing stop at `trailPct` below the peak becomes active.
- Both exits return `sell`; the trailing stop never moves down.
- When flat, `peak` resets to the current price.

Parameters: `entryLookback`, `breakoutBufferPct`, `activationPct`, `trailPct`, `hardStopPct`.

## Consequences

- The strategy uses the existing `state` persistence in `bot_signals.strategy_state` and in backtest runs; no schema change.
- `stopLossPct`/`takeProfitPct` are intentionally absent, so the generic backtest protective exits do not duplicate the trailing logic. `stopLossEnabled` still disables the hard stop.
- In a sideways market the breakout entry can produce false signals; this is documented in the strategy guide.

## Verification

- Unit tests for breakout entry, pre-activation hold, trailing exit, hard stop and flat-state reset.
- Registry test count updated to seven strategies.

## Production release

Pending.
