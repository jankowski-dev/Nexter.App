# ADR 0067 — Unified Crypto workspace

## Status

Accepted. 2026-11-17. No migration or server change.

## Context

Crypto-related navigation was spread across four sidebar entries under the `Крипта` accordion: `Торговля`, `Операции`, `База токенов`, `Статистика`. The owner wants one `Крипта` menu item and one visual workspace where the crypto sections switch with tabs.

## Decision

- The sidebar and mobile navigation contain one `Крипта` link to `/portfolio`.
- The page title is `Крипта` and the tab list has seven entries:
  1. `Обзор` — summary cards, consolidated token blocks, active trades and the `Основной список` token blocks.
  2. `Токены` — the token base (`WatchlistPage`).
  3. `Ордера` — the full trade journal (`TradesPanel` journal mode).
  4. `Операции` — the operations journal (`OperationsPage`).
  5. `Роботы` — paper bots (`TestingPage` bots mode).
  6. `Стратегии` — strategy documentation (`TestingPage` strategies mode).
  7. `Статистика` — portfolio/trade statistics (`ReportsPage`).
- The existing `/operations`, `/watchlist` and `/statistics` routes render the same `CryptoPage` shell with their tab selected. Old links continue to work and no hard redirect is required. Tab switches use `history.replaceState` to canonicalize the URL to `/portfolio#<tab>`.
- Embedded pages (`OperationsPage`, `WatchlistPage`, `ReportsPage`) accept an `embedded` prop. Their `PageHeader` becomes a compact `h2` instead of a second page-level `h1`, preserving the section title and actions without competing with the `Крипта` header.
- Hash compatibility: `#trades`/`#deals`/`#journal` -> `Ордера`, `#watchlist` -> `Токены`, `#reports` -> `Статистика`, `#manual` -> `Обзор`.
- `Основной список` moves from the former `Ручной` tab to the bottom of `Обзор`; the old `Ручной` tab is removed. `TokenBuyList` is otherwise unchanged.
- No API, ledger, swap, bot, AI or schema changes.

## Consequences

- The owner has one crypto navigation entry and one tabbed workspace.
- Direct URLs for operations/tokens/statistics still work and show the same shell with the correct tab.
- The operations and token base actions remain in their compact section headers; no global header action duplication.
- The page is longer on `Обзор` because it now includes the main token list at the bottom, as requested.
