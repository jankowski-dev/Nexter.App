# ADR 0031 — Multi-period market changes and icon caching

## Status

Accepted for UI-16 on 2026-11-11. Migration `0029` is additive.

## Context

The token base and portfolio show only a 24-hour price change. The owner asked to see 7-day, 30-day, and 1-year changes in the token base, `Позиции по активам`, and `Основной список`, and to sort the token base by market capitalization and by each period in both directions. CoinGecko exposes 7-day, 30-day, and 1-year changes in one `/coins/markets` request, but does not expose exactly three months. The owner chose to omit the three-month period rather than add a quote-history table.

The owner also suspected that token icons were downloaded again on every refresh. The icon proxy set a browser cache header, but the global no-store interceptor and the absence of a server-side cache left avoidable refetches.

## Decision

- **Persist the available periods.** `market_quotes` gains nullable `change_7d_pct`, `change_30d_pct`, `change_1y_pct`, and `market_cap_usd`. The migration only adds columns; table-level grants for `nexter_app` continue to apply.
- **CoinGecko is the period source.** The 10-minute CoinGecko refresh requests `price_change_percentage=24h,7d,30d,1y`. Market cap and period changes are merged into every asset that has a CoinGecko id, including assets whose price comes from DexScreener. DexScreener remains the primary price and 24-hour source. Assets without a CoinGecko id show `—` for periods that cannot be resolved.
- **No three-month history.** The UI shows 24h, 7d, 30d, and 1y only. A 90-day value would require either a history table or a mislabeled CoinGecko field, so it is not shown.
- **API surface.** `Position`, the portfolio asset quote, and watchlist entries expose the period fields; watchlist entries also expose `marketCapUsd`. Cash equivalents report zero changes.
- **Sorting.** The token base sorts loaded entries client-side by market cap, 24h, 7d, 30d, or 1y with an ascending/descending toggle. Null values stay last. The page still loads 50 entries per cursor page; sorting applies to loaded entries.
- **Icon cache.** The API keeps an in-memory 24-hour icon cache with in-flight request coalescing, a 200-entry bound, and an 8 MB byte budget. `/api/v1/watchlist/icon` is exempt from the global `Cache-Control: no-store` header, so the existing `public, max-age=86400, immutable` response is honored by the browser. Uploaded data URLs bypass the proxy as before.

## Consequences

- Period fields update every 10 minutes. DexScreener-driven prices still update every 60 seconds, while their period changes and caps refresh on the CoinGecko cadence.
- Tokens without CoinGecko coverage, including many new contract tokens, have no cap or multi-period change until CoinGecko lists them.
- `market_quotes` remains additive; no history table and no destructive migration. Production migration `0029` requires the usual verified backup.
- The in-memory icon cache is per API process. A restart empties it; multiple replicas each keep their own copy. This is acceptable for small PNG/WebP icons and removes repeated upstream calls in the common single-replica deployment.
- Client-side sorting is limited to the entries already loaded. If the owner's token base grows beyond one page, server-side sorting should replace it in a later change.
