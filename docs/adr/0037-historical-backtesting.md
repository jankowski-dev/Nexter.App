# ADR 0037 — Historical backtesting with daily bars

## Status

Accepted for UI-38 on 2026-11-13. Migration `0036` is additive. Production rollout requires a verified backup, a restore check, and a provider smoke test.

## Context

Paper bots only accumulate a forward record after they are started. The owner wants to evaluate a built-in strategy against history before committing paper capital, see individual trades on a chart, download a PDF report, and keep a per-strategy run journal.

The system already has:

- a code strategy registry with Zod-validated params and a shared `StrategyDecision` contract;
- daily market quotes but no historical OHLC store;
- an immutable audit pattern and decimal-only money handling.

## Decision

- **Daily bars, not ticks.** Backtests use one bar per UTC day and execute at that day's close with simulated fee/slippage. Intraday and tick backtests are out of scope.
- **Reuse the strategy registry.** `runBacktest` calls the same `StrategyDefinition.evaluate` used by the runner. This prevents a second, drifting strategy implementation.
- **Data providers.** CoinGecko `market_chart` is primary for assets with a `coingecko_id`; daily points are grouped by date. GeckoTerminal daily OHLCV is the fallback for contract tokens on BSC/Ethereum, using the top pool by reserve. A 30-candle minimum is enforced. Provider responses are cached in memory for one hour and snapshotted into the run.
- **Immutable runs.** `bot_backtest_runs` stores strategy key/params, asset, period, source, stats, candles, trades, and equity curve. There is no update/delete path. The API role gets only SELECT/INSERT; UPDATE/DELETE are revoked.
- **PDF on demand.** `pdfmake` with the bundled Roboto font generates a Russian report from the stored snapshot. Local file access is restricted to the pdfmake font directory and URL access is denied. The PDF is not stored.
- **UI flow.** The strategy drawer contains token search, period selection, a loading spinner, a full-width daily chart, progressive trade markers (blue buys, green profitable sells, red losing sells), stats after the run, a PDF link, and a run journal.
- **Tests.** The engine is unit-tested with synthetic candles, including forced end-of-period close and buy-and-hold comparison. E2E seeds the historical cache to avoid external calls and verifies preview/run/list/detail/PDF.

## Consequences

- Backtests are comparative and do not model pool depth or intraday moves. Results are not a guarantee of future returns.
- The first preview for a token may take a few seconds; the UI shows a centered spinner.
- A provider outage can block new previews. Cached runs remain readable and PDFs still download because the snapshot is stored.
- Runs are owner-scoped. Tokens must be active entries in the owner's token base, matching the bot creation rule.
- The PDF is generated on every download; this is CPU work but runs are small (one page or a few).
- No real ledger, swap, signing, or key material is involved.
