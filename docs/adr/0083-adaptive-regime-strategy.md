# ADR 0083 — Adaptive regime strategy and exclusive search mode

Status: accepted, 2026-11-23.

## Context

The 12 static long-only strategies are fixed rule sets. The 3-token retest
showed the gap: BASED produced a real `crash_protected_grid` recommendation with
3/3 positive and 3/3 active cycles, while QUICKAI and IRYS produced zero because
their holdout regimes were bearish/choppy. Near-misses repeatedly failed on
drawdown or a negative last cycle even when OOS was strong.

The owner approved one adaptive strategy that changes behavior by regime, plus
an exclusive toggle: adaptive-only or the existing 12.

## Decision

1. **Add `adaptive_regime` («Адаптивный режим»).**
   - Long-only, stateful.
   - States: `DORMANT`, `UPTREND`, `PULLBACK`, `COOLDOWN`; `CRASH` is an exit event that writes `COOLDOWN`, and `RECOVERY` is the post-cooldown wait.
   - Daily SMA fast/slow/long trend, ATR(14), high-water mark.
   - Entry: pullback to the fast average in a confirmed uptrend; adds up to
     `maxAdds`.
   - Exit: ATR hard stop, crash drawdown, trend break, or trailing stop after
     +8%; exits use the current close/spot (no intrabar wick fills).
   - Crash/stop exits enter a 24-hour cooldown; no entries during cooldown.
   - Parameters: `trendFastDays`, `trendSlowDays`, `trendLongDays`,
     `pullbackPct`, `atrStopMult`, `trailPct`, `crashDrawdownPct`, `maxAdds`.
2. **Pass candle context to strategies.**
   - `StrategyContext.candles?: BotCandle[]`.
   - `StrategyDefinition.candleTimeframe?: '1d' | '4h' | '1h'`.
   - Backtests pass their candles; the bot runner loads `market_candles` for the
     configured timeframe. The strategy falls back to daily aggregates from
     hourly quote history when candles are missing.
3. **Add an exclusive search mode.**
   - `strategyMode: 'legacy' | 'adaptive'`, default `legacy`.
   - `legacy`: the existing 12 AI-eligible strategies, excluding adaptive.
   - `adaptive`: only `adaptive_regime`.
   - The adaptive strategy has `aiEligible: false`, so the AI Analyst/lab does
     not propose it; the adaptive search includes it explicitly.
   - UI: «Только адаптивная стратегия» Switch in manual search and cycle forms.
4. **Add a native fast runtime for adaptive_regime.**
   - Precomputes daily bars/SMA/ATR; mirrors the Decimal state machine.
   - Parity with Decimal in `same-close` and `next-open`.
   - Keeps a 10k pilot practical (~24 ms/variant on the synthetic probe).

## Why a separate mode

Mixing 12 static strategies with the adaptive one would make a 10k pilot
diluted: the adaptive strategy would receive only 1/13 of variants. The owner
wants to evaluate it on its own without changing the default legacy search.
The mode is not a production default flip; the 12 remain the default.

## Consequences

- Positive: the adaptive strategy can be tested with 10k variants on BASED,
  QUICKAI and IRYS without touching the 12.
- Positive: live and backtest use the same candle context for the daily regime.
- Positive: the strategy can stay DORMANT in a bad regime instead of forcing
  entries.
- Negative: eight parameters increase overfitting risk; the 10k pilot and
  holdout gates are the guard.
- Negative: `market_candles` must exist for the live 6-month trend; otherwise
  the long filter degrades to the available history.
- Negative: adaptive mode is not included in the default analyst proposals.
- Rollback: remove the key from the registry and the mode toggle; no migration.

## Pilot

Run 10k adaptive variants on BASED, QUICKAI and IRYS before any 100k/200k or
default change. Success: at least one BASED candidate with 2+ positive and 2+
active cycles, DD <= 20%, holdout > 0; no forced trading in a bad regime; no
flat-block recommendations.
