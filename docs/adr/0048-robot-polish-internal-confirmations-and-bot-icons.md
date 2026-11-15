# ADR 0048 — Robot polish, internal confirmations and custom bot icons

## Status

Accepted for UI-57 on 2026-11-15. Migration `0040` adds a nullable bot icon column.

## Context

The owner reported a robot/portfolio polish batch:

- the robot token picker listed the whole token base instead of the default `Основная` watchlist group;
- browser confirmations still appeared in several modules;
- the price/quote architecture needed an explicit answer;
- robots need a custom icon with the strategy icon as the default;
- removing a token with an open position must keep the position until it closes;
- uptime must use explicit, readable units;
- the bot equity chart should match the portfolio token chart;
- the bot journals and order lists need 10-row limits and centered `Ещё`;
- closed orders must open the order page instead of the buy/trade drawer.

## Decision

### Robot token picker

The picker loads `GET /watchlist/groups`, selects the default group (`isDefault`, normally `Основная`), then loads `GET /watchlist?groupId=...`. Tokens that already belong to an edited bot but are outside the default group are appended to the picker so they can still be reviewed or removed. The backtest stand uses the same default-group list.

### Internal confirmations

A single `ConfirmProvider`/`useConfirm()` wraps the application. Every `window.confirm` was replaced with an internal `ConfirmDialog` promise. Confirmation titles, descriptions and labels are explicit; destructive actions use the `danger` button and non-destructive actions use `primary`. Native browser dialogs are no longer used, and the E2E flows now exercise the internal dialog.

### Quotes and prices

Current prices are centralized. `MarketQuoteRefreshService` runs `MarketQuoteService.refreshAll()` on the configured interval; it batches assets through DexScreener first and CoinGecko as fallback, then upserts `market_quotes`. Portfolio, dashboard, reports, watchlist and bots all read that table through `PricingService`/`MarketQuoteService`; `PricingService` falls back to manual `prices` rows only when an asset has no market quote. Historical chart candles are a separate on-demand GeckoTerminal/CoinGecko path, and KyberSwap quotes remain live per swap request because they must be executable. Subsystems do not fetch independent spot prices.

### Custom robot icon

Migration `0040` adds nullable `trading_bots.icon` (`text`). `botSummary` exposes `icon`, and create/update requests accept a PNG/JPEG/WebP data URL up to 250 KB. The web form reuses `compressTokenIcon` (128 px WebP), supports upload and reset, and renders `BotIcon` with the strategy icon fallback. Audit entries store `custom`/`null` instead of the full data URL.

### Token removal with an open position

`updateBot` no longer rejects removing a token that has an open position. It removes the token from `bot_tokens`, keeps the `bot_positions` row, preserves that token's strategy state, and writes a `token_removed` bot event. `BotRunnerService` processes the union of active tokens and open positions: orphaned positions continue through the normal strategy exit path but buy decisions are ignored, so no new positions are opened. The position remains until the strategy closes it or the owner uses `Закрыть позиции`.

### Uptime

Uptime uses explicit units: `7 с`, `5 мин 7 с`, `1 ч 11 мин`, `2 д 1 ч 11 мин`. A stopped or draft bot shows `—`. The counter resets on every start.

### Bot equity chart

The bot drawer reuses the portfolio chart presentation: a large current value, period change, range switch (`24ч`/`7д`/`30д`/`1г`), area line and tooltip. The equity endpoint accepts `days`; ranges above two days are downsampled in PostgreSQL by hour (up to 45 days) or day (longer), keeping at most one point per bucket.

### Journals and orders

Bot trades and bot events load 10 rows per page with a centered `Ещё`. The bot open-position list and the portfolio asset order list show 10 rows initially and reveal more with a centered `Ещё`.

### Closed orders

Rows in the portfolio order journal still open the trade drawer for active orders, but a `closed` group navigates to `/trades/$tradeId`. This matches the asset drawer, where every order card already links to the order page.

## Consequences

- The token picker may lag one group-query round trip; the selected token count is preserved while loading.
- Bot icons increase `trading_bots` row size by at most 250 KB. The list endpoint returns them; this is acceptable for a small number of personal bots.
- Orphaned positions are included in `openPositions`, so they continue to count against `maxPositions` until closed.
- Downsampled equity points are last-value-per-bucket, not averages, so the chart keeps actual capital levels.

## Verification

- `format:check`, `typecheck`, `lint`, web tests, API tests and build pass.
- New API coverage removes a token with an open position, verifies the position survives, then runs the runner and verifies the orphaned position closes on a sell signal.
- E2E flows use the internal confirmation dialogs for import commit/rollback, pin removal, vault deletion and token deletion.
