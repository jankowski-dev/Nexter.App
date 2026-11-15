# ADR 0049 — Unified trade order and manual operation surfaces

## Status

Accepted for UI-59 on 2026-11-15. No migration.

## Context

Buying, selling and manual ledger operations grew through separate entry points: a generic manual trade dialog, on-chain buy/sell drawers, a manual operation dialog and an on-chain exchange drawer. The owner defined a stricter model:

- creating an order is only possible from `Купить` in the main token list on the Trade page;
- closing an order is only possible from the active orders list or from the consolidated asset drawer;
- both order modals have `Ончейн` and `Вручную` tabs;
- exchange, deposit, withdrawal and adjustment are one manual operation form with four tabs;
- order action buttons stay fixed in the modal footer.

## Decision

### Buy order

`TokenBuyList` is the only buy entry point. Its `Купить` button opens `TokenTradeDrawer` with `initialMode="buy"`. The asset drawer and the old `Ручная сделка` header action no longer offer a buy path. The main list is the allowlist boundary because it shows only the owner's default `Основная` watchlist group.

### Sell / close order

Active rows in the orders tab and active order cards in the consolidated asset drawer open the same `TokenTradeDrawer` with `initialMode="sell"` and the selected `tradeGroupId`. Closed orders stay read-only in the order journal and open their detail page. The sell modal no longer offers `Купить ещё`; a new buy must go through the main list.

### Two channels

`TokenTradeDrawer` renders `Ончейн` and `Вручную` tabs for both buy and sell:

- on-chain keeps the existing Kyber preview, wallet approval, submission and tracking flow;
- manual reuses `POST /transactions` with the existing idempotency keys;
- manual buy fixes the asset and asks for wallet, payment asset, token amount, paid amount, date and notes;
- manual sell fixes the order and asks for wallet, proceeds asset, token amount, proceeds amount, date and notes;
- if on-chain is unavailable (kill switch, disabled execution, missing allowlist entry), the drawer opens the manual tab and the on-chain notice links to it.

The visible action buttons moved from a sticky block inside the body into the `Drawer` footer, so content length cannot move them.

### Operations

`ManualOperationDialog` is the only operations surface. It has four tabs: `Обмен`, `Пополнение`, `Вывод`, `Корректировка`. The on-chain exchange entry point was removed from the Operations page and the `income` tab was removed from the unified form. Existing income transactions remain readable in the journal; new income-like corrections use `Корректировка`.

### Shared manual form

The old `ManualTradeDialog` was replaced by `ManualOrderForm`, embedded in the order drawer. The footer submit button uses the HTML `form` attribute to submit the embedded form. Manual writes invalidate positions, token summaries, order groups, operations, dashboard and the asset drawer.

## Consequences

- There is exactly one buy entry and one sell entry, which reduces accidental purchases of tokens outside the working watchlist.
- On-chain and manual channels share one modal but keep separate execution paths; manual entries do not require a wallet connection.
- Existing API contracts and the ledger are unchanged. No migration is required.
- Removing `Доход` from the operation tabs is a UI decision; the backend endpoint still accepts `income` for historical/API compatibility.

## Verification

- `format:check`, `typecheck`, `lint`, web tests, API tests and build pass.
- E2E flows were updated for the new buy/sell tabs, the four-tab operation dialog and the removed on-chain exchange entry.
- The footer is rendered by `Drawer`, outside the scrollable body.

## Production release (2026-11-15)

PR #145 merged as `2403d662`; deployment `130a3e50-66d6-447a-a038-45507cb77aba`; bundle `assets/index-CVqMeRiW.js`; `/health` and `/ready` 200. No migration.
