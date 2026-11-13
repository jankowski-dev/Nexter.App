# ADR 0040 — Stateful strategies and crash-protected grid

## Status

Accepted for UI-45 on 2026-11-13. Migration `0038` adds `bot_signals.strategy_state` (additive).

## Context

The owner wants a custom strategy that behaves like a grid in normal conditions, but protects capital during a crash:

- remember the pre-crash high-water mark;
- at a 10% drop from that mark, pause buys and close the aggregate position if its P&L is at least −10%;
- keep a deeper loss open;
- at a 30% drop, reset the reference to the current price and start a new grid;
- resume a new high resets the protection.

The existing strategy contract is stateless: `evaluate(ctx)` receives price/history/position but cannot remember a high-water mark or crash mode across ticks/bars. The owner confirmed that the current one-aggregate-position-per-token model is acceptable; lot-level closing is not required.

## Decision

- **Stateful context.** `StrategyContext` gains optional `state: Record<string, unknown>`; `StrategyDecision` gains optional `nextState`. Existing strategies remain stateless and need no changes.
- **Persistence.** The runner stores per-bot/token state in `bot_signals.strategy_state` (migration `0038`). It loads state before each tick, passes it to `evaluate`, and upserts `nextState` together with the signal. The backtest engine keeps a run-local state and applies `nextState` after each bar.
- **Reset semantics.** Changing a bot's strategy/params or token list, and resetting the bot, clears its signal/state rows. Existing strategy state is not exposed in the API response; it is an execution concern.
- **Aggregate close.** The crash rule closes the whole aggregate position when P&L ≥ −`closeLossThresholdPct`; a deeper loss remains open. This matches the confirmed current model; per-lot closing would require a separate lot-level engine.
- **New strategy `crash_protected_grid` (`Защитная сетка`, custom).** Normal grid buys below the high-water mark and takes profit. At `crashTriggerPct` it enters crash mode, pauses buys and closes the aggregate position when allowed. At `resumeDropPct` it resets the high-water mark to the current price, resets the add counter and buys the first grid step of the new cycle. A new high clears crash mode.
- **No hard stop.** The strategy intentionally has no stop-loss parameter; the owner chose to hold deep losses through the crash. The stand hides the stop-loss toggle for strategies that do not define `stopLossPct`.
- **Tests.** Strategy tests cover crash close, deep-loss hold/30% resume and state transitions; engine test covers pause, crash close, resume and take-profit with persisted state.

## Consequences

- State is bounded: one JSON object per bot/token in `bot_signals`.
- A bot tick now loads signal states; this is a small indexed query by `bot_id`.
- The strategy is available to paper bots and backtests. Since it is stateful, a restart of the API does not lose state because it is in the database.
- The high-water mark is initialized from the first observed price if no state exists.
- Existing strategies continue to run statelessly; their behavior is unchanged.
- No real-trading, ledger, or signing changes.
