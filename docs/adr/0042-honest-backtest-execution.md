# ADR 0042 — Honest historical backtest execution

## Status

Accepted for UI-47 on 2026-11-14. No migration.

## Context

The CYCLE audit showed that the 365-day result of +1462.39% was not a sale-price arithmetic bug. CoinGecko `market_chart` returned one USD point per day for the long window, and the importer converted that point into a candle with `open = high = low = close`. The engine's gap rule then sold every take-profit at `open × 0.999`, booking thin-market one-day prints as fills. 363 of 364 CYCLE candles were flat, and 99.7% of the reported profit came from fills above the 4% target.

The audit also found a real engine defect: when a protective take-profit or stop-loss fired, the loop executed the sell and `continue`d, so `definition.evaluate` was never called that day. Stateful strategies therefore did not advance their high-water mark, crash mode or add counters on protective-exit days.

The free GeckoTerminal daily OHLCV endpoint gives true high/low for BSC/Ethereum pools, but currently returns about 184 daily candles (roughly six months), not a full year. A one-year request cannot always use true OHLC.

## Decision

- **Mark data quality per candle.** `HistoricalCandle` and `BotCandle` gain an optional `synthetic` flag. CoinGecko sample-derived candles are marked `synthetic: true`; GeckoTerminal OHLCV candles are marked `false`. The flag is stored in the immutable run snapshot and the preview; the contract field is optional so existing runs remain readable.
- **Prefer true OHLC when it covers the requested period.** For BSC/Ethereum contract tokens the service asks GeckoTerminal first. If it returns at least the requested number of daily candles, that series is used. Otherwise the longer series wins: if CoinGecko has more history than GeckoTerminal, CoinGecko is used and marked synthetic; if GeckoTerminal still has more, it is kept. This preserves the requested period instead of silently shortening a 365-day run to the available 184 GeckoTerminal days.
- **Conservative synthetic exits.** For synthetic candles the engine does not use open/high/low as if they were true OHLC:
  - take-profit fills at the configured threshold (a limit order is assumed to fill at its limit, not at a sampled spike);
  - stop-loss fills at the close (a market stop is assumed to fill at the only end-of-day observation, which is conservative);
  - no `(гэп)` reason is emitted for synthetic candles; reasons explicitly say `синтетическая свеча`.
    Real OHLC candles keep the existing intrabar threshold, gap-at-open and stop-first rules.
- **Advance strategy state on protective exits.** After a protective sell the engine still calls `definition.evaluate` with the post-exit position (usually `null`) and the reset `buyCount`, applies `nextState`, and then ignores the decision's action for that same candle. This keeps stateful strategies consistent without allowing a second same-day round trip.
- **Surface the limitation.** The stand shows an amber warning when the preview contains synthetic candles and recommends a period up to 180 days when GeckoTerminal covers the pool. The PDF adds a `Качество данных` row and changes the stop/take-profit wording for synthetic runs. Old CoinGecko runs without the flag are inferred as synthetic in the PDF.
- **Tests.** Source selection covers GeckoTerminal-first, longer-CoinGecko fallback, keeping GeckoTerminal when it has more history, and the no-contract path. Engine tests cover synthetic take-profit, synthetic stop-loss and `evaluate` being called on a protective take-profit candle.

## Consequences

- A new 365-day CYCLE replay on the stored CoinGecko candles now returns **+5.82%** (52 trades, 18 take-profits, max drawdown 48.13%, buy-and-hold +171.03%) instead of +1462.39%. The take-profits fill at the 4% threshold, not at the sampled spikes.
- A 180-day CYCLE replay on true GeckoTerminal OHLC returns **−6.75%** (34 trades, 14 take-profits, max drawdown 31.46%, buy-and-hold +501.70%). The shorter true-OHLC period is not directly comparable to the 365-day run, but it shows the strategy underperformed the rally.
- Existing runs are immutable and are not rewritten. New runs use the corrected engine; old PDFs label CoinGecko data as synthetic because the flag is absent.
- The free GeckoTerminal window is about six months. Longer true-OHLC history would require a paid provider, pagination or another source and is not part of this change.
- No schema change, migration, ledger, swap or signing change.
- Production release on 2026-11-14: PR #119 merged as `e6fc70b`, deployment `6ebf2d82-a47a-4e77-a937-dbfd0d6d2686`, bundle `assets/index-C5881s6H.js`, `/ready` 200.
