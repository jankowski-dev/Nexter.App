# Adaptive regime strategy — design

Date: 2026-11-23
Status: approved in principle; first prototype

## Intent

The 12 static long-only strategies either pass or fail as a fixed rule set. The
3-token retest showed the gap clearly: BASED produced a real
`crash_protected_grid` recommendation with 3/3 positive and 3/3 active cycles,
while QUICKAI and IRYS produced zero because their holdout regimes were
bearish/choppy. The owner wants one strategy that changes behavior by regime:
hold and trail in an uptrend, cut a crash quickly, sleep after a loss, and stay
out when there is no edge.

This is a reaction system, not a prediction system. It classifies the current
regime with lag and chooses an action; it never claims to know the future.

## Strategy

- Key: `adaptive_regime`
- UI name: `Адаптивный режим`
- Icon: `layers`
- Long-only (spot/paper), no shorting.
- Stateful; state persists per bot/token and per backtest run.

### States

| State      | Meaning                                                                | Action                                        |
| ---------- | ---------------------------------------------------------------------- | --------------------------------------------- |
| `DORMANT`  | no confirmed uptrend, or cooldown                                      | no entries                                    |
| `UPTREND`  | fast trend above slow and long trend                                   | hold, trail winners                           |
| `PULLBACK` | uptrend and price pulled back to the fast average                      | buy                                           |
| `CRASH`    | drawdown from high-water mark above threshold, or high volatility drop | exit, enter cooldown                          |
| `COOLDOWN` | after a stop/crash                                                     | no entries until the timer ends               |
| `RECOVERY` | cooldown ended, waiting for trend confirmation                         | no entries until fast > slow and price > fast |

### Signals

Daily aggregates from `ctx.candles` (1d, or 1h/4h aggregated to complete UTC
days) with fallback to `ctx.history` when candles are missing:

- fast SMA (`trendFastDays`, default 7);
- slow SMA (`trendSlowDays`, default 30);
- long SMA (`trendLongDays`, default 90; up to 180 if available);
- ATR(14) as a percentage of price;
- high-water mark since entry;
- drawdown from the high-water mark.

### Entry

- Only when `fast > slow` and (when the long average exists) `slow > long` and
  `price > slow`.
- Buy when price is at or below `fast * (1 - pullbackPct / 100)`.
- Adds are allowed up to `maxAdds` while the uptrend remains valid and price is
  still below the fast average.
- No entries during cooldown or while the regime is `DORMANT`.

### Exit

Exits use the current close/spot. Intrabar wicks are not used for adaptive
stops/trailing; the generic engine stop is not configured for this strategy.

- Hard stop: `avgCost * (1 - atrStopMult * atrPct / 100)`.
- Trailing: after price reaches `avgCost * 1.08`, trail at
  `highWater * (1 - trailPct / 100)`.
- Crash: drawdown from `highWater` at or above `crashDrawdownPct`; sell and
  start a 24-hour cooldown.
- If the fast average falls below the slow average, exit the position and go
  to `DORMANT` (trend break).
- No take-profit cap; the trailing stop is the profit mechanism.

### Parameters (8)

| Key                | Default | Range  |
| ------------------ | ------: | ------ |
| `trendFastDays`    |       7 | 3–14   |
| `trendSlowDays`    |      30 | 14–60  |
| `trendLongDays`    |      90 | 60–180 |
| `pullbackPct`      |       3 | 1–10   |
| `atrStopMult`      |     2.5 | 1–5    |
| `trailPct`         |       4 | 1–10   |
| `crashDrawdownPct` |      10 | 5–20   |
| `maxAdds`          |       2 | 1–3    |

Fixed: ATR period 14, trailing activation 8%, cooldown 24 hours, no generic
take-profit.

## Data and live/backtest parity

- Add `StrategyContext.candles?: BotCandle[]`.
- `runBacktest` passes the candles it is already using.
- The bot runner loads `market_candles` for `definition.candleTimeframe` (1d for
  the adaptive strategy) from the retention window; if the table has fewer than
  60 daily candles, the strategy falls back to daily aggregates from
  `ctx.history` (30 days of quotes). The 6-month trend is only available when
  candles exist; otherwise the long filter degrades gracefully to the available
  slow trend.
- `historySampling: 'hourly'` remains for the quote history fallback.

## Search mode

Add `strategyMode: 'legacy' | 'adaptive'` to search and cycle requests,
default `legacy`.

- `legacy` (default): the existing 12 AI-eligible strategies, **excluding**
  `adaptive_regime`.
- `adaptive`: only `adaptive_regime`.
- The two modes are exclusive; the adaptive strategy is never mixed with the
  12 in one search.
- UI: a Switch «Только адаптивная стратегия» in the manual search and cycle
  forms. The mode is stored in the run artifact and shown in history/results.
- The adaptive strategy remains manually selectable in bot creation/backtest.

## Prototype and pilot

1. Implement the Decimal strategy and the candle context.
2. Implement the native fast runtime with parity tests; otherwise a 10k pilot
   is too slow.
3. Add the toggle and generator filter.
4. Run 10k adaptive variants on BASED, QUICKAI and IRYS.
5. Success criteria:
   - at least one candidate on BASED with 2+ positive and 2+ active cycles,
     DD ≤ 20%, holdout > 0;
   - the strategy is not forced to trade in QUICKAI/IRYS if the regime is bad;
     `DORMANT` is a valid outcome;
   - the adaptive mode does not produce more flat-block recommendations than
     the legacy mode;
   - native/Decimal parity for the holdout.

Only after the pilot do we consider 100k/200k, production defaults or removing
the 12 strategies. The 12 remain the default until the adaptive pilot proves
better.

## Non-goals

- No shorting, leverage, auto-start or budget reallocation.
- No threshold changes to OOS/holdout gates.
- No migration; `market_candles` already exists.
- No guarantee of a recommendation in a bearish regime.

## Risks

- More parameters than the static strategies; the 10k pilot must watch for
  overfitting.
- Daily candles may be missing for non-AI tokens; the fallback is weaker.
- The native runtime must match the Decimal strategy exactly or the search will
  select a different behavior than the bot.
- The regime filter can lag a sharp reversal; the crash exit is the safety net.

## Rollback

Remove the strategy key from the registry and the toggle from the search
requests. No data migration; existing bots keep their stored configs.
