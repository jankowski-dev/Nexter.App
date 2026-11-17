# ADR 0066 — Trading page tabs and block layout

## Status

Accepted. 2026-11-17. No migration.

## Context

The `Торговля` workspace had four tabs (`Портфель`, `Ордера`, `Роботы`, `Стратегии`). `Портфель` mixed consolidated token summaries with the main token list, while `Ордера` rendered the trade journal as a wide table with source/closed columns and small P&L typography. The owner asked for a clearer separation between consolidated portfolio data, manual buying, and the trade journal, and for each record to read as a block rather than a table row.

The owner also asked for five tabs. The current journal and the historic design (`Портфель`, `Основной список`, `Сделки`) imply the fifth tab is `Сделки`: it keeps the full journal/history, while `Ручной` is the buying surface.

## Decision

### Tabs

The trading workspace has five tabs in this order:

1. `Портфель` — consolidated portfolio by token plus active trades.
2. `Ручной` — the main default-group token list for manual purchases.
3. `Сделки` — the full trade journal (active, profitable, losing, closed) with filters.
4. `Роботы` — paper-trading bots.
5. `Стратегии` — strategy documentation.

Hash compatibility: `#trades` and `#orders` open `Ручной` (the former `Ордера` position), `#manual` also opens `Ручной`, and `#deals`/`#journal` open `Сделки`.

### Portfolio

- The four summary cards remain.
- `Портфель по токенам` remains a set of consolidated token blocks.
- A new `Активные сделки` section shows each open trade as a narrow block. Clicking it opens the read-only asset drawer, where the existing active-order cards can open the sell drawer. The portfolio block itself has no sale column or closed-date column.
- The main token list is removed from this tab.

### Manual

`Ручной` contains the default-group main token list. Each token is a clickable block with token icon/name, price and 24h change, an interactive three-month weekly chart, 7d/30d/1y changes, market cap and a `Купить` button. Clicking the block opens the token card; clicking `Купить` opens the existing buy drawer without bubbling. The list keeps its sort selector and direction toggle.

### Deals

`Сделки` keeps the journal filters and active/profitable/losing/closed views, but renders each group as a block:

- Result is the largest metric and is colored by P&L.
- Return is signed (`formatPct`) and slightly stronger than secondary metrics.
- Update time is slightly stronger than the old muted timestamp.
- Average price, invested remaining cost, holding days and opened date are right-aligned in a muted grid.
- The `Источник` and `Закрыта` table columns are removed; the source is not shown. Closed groups show a small `Закрыта <date>` line at the bottom only in the full journal.
- The active journal block still opens the existing sell drawer; the portfolio active block opens the read-only asset drawer instead.
- The page keeps the existing 25-row pagination and `Загрузить ещё`.

### Chart

The main list uses the existing `GET /api/v1/watchlist/:id/chart?days=90` endpoint. The client samples twelve evenly spaced weekly points, always keeping the first and last point, and renders an interactive SVG sparkline. Hovering shows the date and price. No new API or persistence is required; the existing chart cache applies.

## Consequences

- Consolidated portfolio data and active trades are visible together; manual buying has its own surface; the full journal remains available as `Сделки`.
- Each deal/token is a block with a stronger P&L/result hierarchy and no table chrome.
- The main list performs one cached chart request per visible token. The default group is small; the existing server-side chart cache bounds the cost.
- Selling remains available from the asset drawer and the full journal; the portfolio overview is read-only.
- No backend, schema, ledger, swap, bot, or AI changes.
