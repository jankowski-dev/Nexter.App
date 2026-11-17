# ADR 0068 — persisted daily price history cache

Status: accepted (2026-11-17)

## Context

The token list renders a 3-month weekly chart for every token. Before this change the chart endpoint fetched GeckoTerminal/CoinGecko history on demand and kept it only in process memory (`MarketDataService.historyCache`). A cold page with 45 tokens started 45 parallel HTTP requests, each making 2–3 provider calls. Public provider limits were exceeded, the clients silently returned empty arrays, and part of the charts stayed empty. The cache was lost on every deploy/restart, and the portfolio asset chart bypassed it entirely. Candle prices were also formatted with 8 decimals, so tokens priced below `1e-8` were dropped.

## Decision

1. Add an additive `market_history` table keyed by `chain:contract:coingeckoId` (not by watchlist entry), storing up to 365 daily points as JSONB with 18-decimal price strings, `source`, `fetched_at`, `next_attempt_at` and `failures`.
2. `MarketDataService.getPriceHistory` reads the DB first, serves fresh data for 24 hours, and slices the requested range from the stored 365-day series. Provider fetches happen only when the row is stale/missing.
3. Provider fetches are serialized through a single promise queue with a 1.5-second minimum interval. Failed/empty fetches keep the previous points and use exponential retry delays (30 minutes, 2 hours, 12 hours, 24 hours). Successful fetches reset the retry state.
4. Candle prices use `priceString()` (`toFixed(18)`) instead of the 8-decimal `usdString()`, preserving micro-cap prices.
5. The web `WeeklyPriceChart` waits until the card is near the viewport (`IntersectionObserver`, 240px root margin) before requesting its chart. React Query keeps the 24-hour `staleTime`, 7-day `gcTime`, and disables focus/reconnect refetches.
6. The migration is additive: no existing table is altered, `nexter_app` gets SELECT/INSERT/UPDATE and no DELETE, and old code ignores the table.

## Consequences

- 45 concurrent chart requests become 45 lazy requests; each token triggers at most one external history fetch per successful day, serialized across the API process.
- A deploy no longer loses chart data. After the first cold fill, charts render from the DB.
- The first load after deploy can take up to ~1–2 minutes to fill all tokens because provider calls are deliberately serialized; already-fetched charts appear as they arrive.
- Empty/error results keep the last known series and retry with backoff instead of overwriting good data.
- The cache is shared by watchlist and portfolio chart paths as long as both call `MarketDataService.getPriceHistory`; the portfolio path still needs to be migrated in a follow-up.
- No ledger, swap, accounting or auth data is touched. Rollback is a redeploy of the previous image; the table can remain.
