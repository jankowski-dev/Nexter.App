# ADR 0047 — Robot uptime, token trade summaries, and modal system

## Status

Accepted for UI-56 on 2026-11-15. No migration.

## Context

The owner requested a robot/portfolio/modal consistency batch:

- a visible runtime counter that resets on every start;
- colored bot statistic cards;
- a thinner equity line;
- per-token consolidated statistics for completed bot trades;
- 10-row bot journals with `Ещё`;
- a consistent modal footer, padding, delete/approval button system;
- the portfolio asset modal should gain a chart, drop lots/transactions, rename and enrich orders, keep the base modal open when buying, color its metrics, and stop linking to the separate full asset page;
- the main-list token modal should drop investors and keep only description, chart and links.

## Decision

- **Robot uptime.** `startedAt` is reset to `new Date()` on every start. The bot detail shows a live `В работе` card; the bot list appends a live uptime next to the last tick. Stopped/draft bots show `00:00:00`. `BotUptimeText` owns the one-second interval.
- **Bot summaries.** Bot cards use the shared tone surfaces. `GET /api/v1/trading-bots/bots/:id/trade-summaries` groups `bot_trades` by asset and returns realized P&L, gross profit, gross loss, trade count, wins and losses. The detail drawer renders a non-clickable per-token list; no schema change.
- **Journals.** `HISTORY_PAGE_SIZE` is 10 for bot trades and events; `Ещё` uses the existing offset pagination.
- **Equity line.** `LineChart` accepts `strokeWidth`; bot equity uses 2 px so sharp moves and points remain visible.
- **Modal system.** `Dialog` is now a fixed-height flex column with a fixed header and footer, and the content area scrolls independently. `Dialog`/`Drawer` use 24 px horizontal padding. Read-only modals close with `Готово`; edit forms keep `Отмена`/`Сохранить`. Delete actions use the full `danger` button, normally on the left, with the remaining actions on the right. Notes, tasks, token cards and bots follow this arrangement.
- **Portfolio asset modal.** It uses `watchlistId` from the asset-detail response to render `TokenPriceChart`, removes lots/transactions, renames `Сделки` to `Ордера`, and renders each order as a richer card with status, dates, P&L, invested/remaining/bought/sold values. Metric cards use the shared tone surfaces. `Купить` no longer closes the base modal; the trade drawer closes independently. The full asset page route, page and links are removed.
- **No execution changes.** Bot trades remain paper trades; no signing, ledger, session or migration changes.

## Consequences

- Uptime is derived from the server `startedAt`; a clock skew or a long-running tab is reflected directly. Restart resets it because start writes a fresh timestamp.
- The trade-summary endpoint performs one grouped query per bot detail load and is refreshed with the other bot queries.
- The fixed modal footer means content never pushes action buttons around; very tall forms scroll inside the modal body.
- Removing the full asset page eliminates one deep link; all needed asset information is in the drawer now.

## Verification

- Bot trade-summary SQL was checked against production bot trades (grouped rows returned correctly).
- Web typecheck, lint, web tests, API tests and build pass.
- Manually checked the asset drawer layout, order cards, chart and buy layering; token-info modal now contains only header, chart, description and links.

## Production release (2026-11-15)

PR #139 merged as `8f33201`; deployment `21765285-4e1d-4bad-ac17-58a17ec9398e`; bundle `assets/index-DsnCxUo-.js`; `/health` and `/ready` 200. No migration.
