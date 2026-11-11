# ADR 0030 — Unified market quotes, live values, wallet session restore

## Status

Accepted and deployed on 2026-11-11. Migration `0028` added `market_quotes` after a verified encrypted backup and restore check.

## Context

The dashboard, portfolio, trades, and reports valued positions from the `prices` table, which only contained manual/imported observations. The token base used CoinGecko live prices. XNY therefore showed `0.00571055` in the portfolio and `0.00502655` in the token base, and the dashboard could stay unchanged for hours because nothing refreshed `prices`.

The owner also reported that WalletConnect asked to connect again after reload, wanted a fan indicator instead of a text countdown, wanted flashing only on values that actually changed, and asked whether last-update times could be shown in tables.

## Decision

- **One price source for all calculations.** `PricingService.latestForAssets` reads `market_quotes` first and falls back to the latest manual `prices` row only when no quote exists. Portfolio, dashboard, trades, statistics, and watchlist all use the same quote map.
- **DexScreener first for contract tokens.** A background `MarketQuoteRefreshService` runs every 60 seconds. For BSC/Ethereum assets with a contract it calls DexScreener, selects the deepest pair where the token is the base token, and requires at least `$25,000` liquidity. This gives the executable DEX price (XNY `0.0050`). Low-liquidity tokens fall back to CoinGecko.
- **CoinGecko fallback.** Native assets (BNB/ETH), tokens without a contract, and low-liquidity tokens use CoinGecko `/coins/markets`. That refresh runs every 10 minutes to stay within the demo API limits. Cash equivalents are fixed at `$1.00000000`.
- **Persisted quote metadata.** `market_quotes` stores one row per asset: `price_usd`, `change_24h_pct`, `source`, `liquidity_usd`, `fetched_at`, `changed_at`. `fetched_at` updates on every successful check; `changed_at` updates only when the price actually changes. The app role has SELECT/INSERT/UPDATE and no DELETE.
- **Last updated in the UI.** Positions, trades, the main list, and the token base show a compact relative check time (`12 с назад`, `3 мин назад`) with a tooltip containing the exact change time, check time, and source. Using the check time avoids making actively refreshed but unchanged prices look stale. The dashboard shows the newest position quote time in the crypto card.
- **Value-level highlighting.** A `LiveValue` component compares the displayed formatted value and flashes a green background only when it changes. Whole-card flashing is removed.
- **Fan indicator.** The header shows a small fan icon on live routes. It spins while the route's live queries are fetching, with a minimum visible spin, and stops when they are idle or failing. The countdown and text are removed.
- **Wallet session restore.** WalletConnect initializes on app start, restores an existing session silently, reads the actual chain, and shares one provider between header and drawers. The selected chain is persisted; the header shows `Восстанавливаю…` while the session is being restored. If the session has expired, the user connects once.
- **Monthly net profit stays realized.** The dashboard card remains Net P&L from Статистика (realized + income − fees). It is intentionally not driven by current prices; unrealized P&L and capital are.
- **Pending signature cancellation remains unchanged.** The owner chose not to disconnect WalletConnect to cancel a pending signature; the drawer explains that the request must be rejected in the wallet.

## Consequences

- XNY and every other asset now have one consistent price across portfolio, dashboard, trades, and token base.
- The dashboard updates on its polling interval as quotes change; it no longer relies on a stale manual price row.
- DexScreener coverage is not universal; low-liquidity or unsupported tokens fall back to CoinGecko and may update every 10 minutes.
- `market_quotes` is additive. The API role must be granted SELECT/INSERT/UPDATE and denied DELETE. Migration `0028` is additive and requires the usual pre-deploy backup.
- The quote refresher uses an in-process running guard; if the API is scaled to multiple replicas, add a Postgres advisory lock to avoid duplicate refreshes. The fan indicates fetching, not a guaranteed price change. Value flashes only when the formatted value changes, so unchanged or rounded values stay static.
- WalletConnect sessions can still expire; reconnecting once is unavoidable. If the wallet reports an empty account list (for example while locked), the app clears the session and asks to connect again rather than showing a dead connected state. A restored session avoids repeated QR/connect prompts.
- Realized monthly P&L does not move with live prices by design; unrealized positive/negative and equity do.
