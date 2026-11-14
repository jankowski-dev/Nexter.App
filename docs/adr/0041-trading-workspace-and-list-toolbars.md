# ADR 0041 — Trading workspace, list toolbars, and scoped loading

## Status

Accepted for UI-46 on 2026-11-14. No migration.

## Context

The owner asked for a navigation and layout cleanup after the paper-trading features landed:

- the route loader covered and tinted the whole app, including the sidebar and header;
- `Портфель` was the top-level name, but the page is now the trading workspace with four tabs;
- the header sync indicator only appeared on a hard-coded list of routes;
- the testing stand used a long strategy dropdown and the parameters/results were stacked vertically;
- strategy cards had no direct path into testing with that strategy selected;
- the portfolio lacked consolidated per-token trading metrics, and orders lacked per-order invested/average-price columns;
- the token-base group filter was a row of buttons, and list pages had different search/sort layouts and archive controls.

The logo/login redesign was explicitly deferred because the source files were not supplied.

## Decision

- **Scoped loading.** `RouteLoadingOverlay` is rendered inside `<main>` with `absolute inset-0`, not at the app root. Page transitions cover only the content area; the sidebar and header remain interactive.
- **Global sync indicator.** `LiveRefreshIndicator` uses `useIsFetching()` without a route predicate, so the header shows `Синхронизация данных` on every authenticated page.
- **Trading workspace.** The top-level label becomes `Торговля`; `/portfolio` keeps four tabs: `Портфель`, `Ордера`, `Роботы`, `Стратегии`. `Портфель` is the consolidated view; `Ордера` is the existing trade-group journal.
- **Consolidated token summaries.** `GET /api/v1/portfolio/token-summaries` aggregates trade groups per asset. For open orders it sums remaining cost basis (invested), unrealized P&L split into positive/negative, and remaining amount; for all orders it sums realized P&L and buy+sell turnover. The break-even price is `sum(remaining cost basis) / sum(remaining amount)`. Counts are open orders and total orders. The response is computed by the pure `aggregateTokenSummaries` helper and covered by a unit test.
- **Portfolio layout.** Stats cards are ordered `Стоимость позиций`, `Капитал`, `Кэш`, `Вложено из фиата`; the positions-count card is removed. Consolidated token cards show the token icon and the metrics above, without current price or change columns. The main watchlist token list stays below with quotes and buy actions.
- **Orders.** The orders table adds `Инвестировано` (remaining cost basis) and `Средний курс` (remaining cost basis / remaining amount) per order. Existing sorting, filtering, and columns are unchanged.
- **Testing stand.** Strategies are selected with cards instead of a dropdown. `/testing?strategy=<key>` preselects the strategy. Strategy cards in the `Стратегии` tab and the strategy drawer expose `Тестировать`; the drawer selects the strategy in place when already on the stand.
- **Backtest layout.** The stand is a two-column grid on wide screens: token/period/parameters on the left; chart, run statistics, PDF action, and the run journal on the right. Run parameters are expanded by default.
- **Shared controls.** `Select` is the single styled select (custom chevron, focus ring, disabled state). `ListToolbar` and `TabGroup` provide the uniform list header: search on the left, sort/filter tabs on the right. They are used by notes, tasks, operations, the token base, and the vault.
- **Token base.** Group buttons become a `Select` in the same row as sorting; a trash action deletes the selected non-default group. The contract-search block loses its explanatory description, and the separate `Сортировка` label is removed.
- **Archive cleanup.** Archive filters/switches and restore actions are removed from notes, tasks, the token base, and the vault. Deletes remain soft archives under the existing APIs, but archived rows are no longer listed. Notes sort by last change or creation; the vault sorts by last change or title. Finance account/category and habit archive controls remain because they are management states, not list-retrieval filters.
- **Preserved behavior.** The sidebar and header stay fixed on scroll, as confirmed by the owner. No ledger, swap, signing, or private-key behavior changes.

## Consequences

- One new read-only endpoint and one pure helper; no schema change or production migration.
- The portfolio summary loads all trade groups in pages of 100 and is independent of the positions list, so tokens with open orders still appear if the positions query is temporarily stale.
- Archived records remain in the database and can be restored by an operator if ever needed; the UI no longer exposes that path.
- The testing URL parameter is intentionally read on mount; the `Тестировать` action performs a full navigation so the stand starts with clean state.
- CoinGecko/backtest data limitations identified in the CYCLE audit are unchanged and are not fixed by this UI batch.

## Update (UI-49, 2026-11-14)

The portfolio token cards now aggregate **only active trade groups**. Closed groups are excluded, and realized P&L and buy+sell turnover are calculated only from the currently open groups. The card count is the number of active orders. `ordersCount` remains in the response for compatibility but equals the active count.

UI-50 later replaced the displayed active turnover with `Капитал` (`currentValueUsd`: active remaining cost basis plus active unrealized P&L), laid the metrics out in one row with a prominent P&L, removed the card descriptions, and added sorting to the main token list.
