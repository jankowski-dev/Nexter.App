# ADR 0078 — Next-open execution for AI search backtests

Status: accepted, 2026-11-22.

## Context

The AI search evaluated a strategy decision at a candle close and filled it at the **same close**. The independent audit (H5) confirmed this look-ahead: the engine observes the close, decides, and trades at the same price. The ablation on a 26-candle gap fixture moved return from **130.44%** (same close) to **120.78%** (next open), with drawdown 9.40% → 10.24% and profit factor 10.92 → 9.62. On a 1h fixture the difference was small (|Δ| ≤ 0.32 pp) because `open[i+1]` is close to `close[i]`, but the bias is real and one-sided.

The audit also concluded that 0 recommendations is mostly an honest market outcome; H5 is a separate metric rebase, not a way to manufacture recommendations. Thresholds, fold count, holdout policy and top-10 remain unchanged.

## Decision

Add an `execution` option to the backtest engines:

- `same-close` — legacy behavior, kept as the default for existing trading-bot backtests and PDFs.
- `next-open` — the AI search and its final holdout default. A decision made at close `i` is queued and filled at `open[i+1]` with the same fee/slippage model.

Execution model:

1. At candle `i`, a pending decision from close `i-1` is executed at `open[i]` before the candle's protective checks.
2. Stop-loss and take-profit remain intrabar: synthetic candles use the close, real candles use open/low/high with the existing gap and threshold rules.
3. The strategy is evaluated at close `i`. Its decision is queued for `i+1`. A decision on a candle with a protective exit is not queued (the position was closed by the stop/take).
4. A decision on the last candle has no next open and is ignored; any open position is force-closed at the last close as before.
5. Buy/sell gates (`maxAdds`, position presence) are re-checked at execution.

The fast native engine mirrors the same pending-order logic. `evaluateVariantFolds` receives the execution mode; the durable worker pool forwards it; the holdout `runBacktest` uses the same mode. `AI_SEARCH_EXECUTION=same-close` forces the legacy mode for rollback; the search request also exposes `execution` for comparison.

The signal screen still counts entry signals at closes; it remains a safe upper bound because next-open can only execute a subset of those signals.

## Consequences

- Positive: AI search and holdout metrics no longer contain the same-close look-ahead; OOS, drawdown and holdout are more realistic.
- Positive: the fast engine and the Decimal engine match in both modes: **330/330** extended next-open parity plus the focused engine tests.
- Neutral: bot backtests and their PDFs stay on `same-close` until a separate rebase; the option is available.
- Negative: metrics and recommendations change. Returns generally fall; drawdown may rise; the existing 0-recommendation outcome can persist.
- Negative: a queued order can fill at a gap far from the signal close, which is the intended realism.
- Rollback: set `AI_SEARCH_EXECUTION=same-close`, or send `execution: "same-close"` in the search request. No schema change or migration.
