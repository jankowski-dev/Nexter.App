# ADR 0070 — Per-order protection and delayed buys

Status: accepted (2026-11-18)

## Context

The previous UI-72 implementation exposed stop-loss, take-profit and delayed buys as global automation rules with a separate `Автоматизация` tab and settings page. The owner clarified that these are **per-order options** inside the buy/edit-order modal. They must not be a global application feature.

## Decision

1. Add nullable `stop_loss_pct` and `take_profit_pct` to `trade_groups` and `swap_orders`, plus `last_protection_event_key` on `trade_groups` for one notification per event per day. Additive migration `0048`.
2. Add `pending_orders` for delayed buys: asset, amount USD, trigger price, optional stop-loss/take-profit, status (`pending`, `proposed`, `cancelled`, `done`), timestamps.
3. The buy modal gets a `Защита и отложенная покупка` block:
   - stop-loss/take-profit percentages apply only to the created order;
   - the delayed-buy checkbox replaces the immediate form with amount/trigger/protection fields and creates a pending order.
4. Manual buys pass the percentages through `createManual`; the ledger stores them on the new trade group. On-chain buys pass them through the quote request; the order stores them and the tracker applies them when accounting creates the trade group.
5. The close/edit-order drawer shows a `Защита этой сделки` editor. It updates `trade_groups.stop_loss_pct`/`take_profit_pct` via `PATCH /trade-groups/:id/protection`; clearing a field removes that protection.
6. `OrderProtectionRunnerService` ticks every 60 seconds under an advisory lock. It:
   - evaluates open/partial trade groups with protection against fresh quotes and the group's remaining cost basis;
   - sets `pending_orders.status='proposed'` when the trigger price is reached;
   - sends notifications with links to the trade card or token list;
   - never writes ledger or swap tables.
7. `Ордера` gains a `Отложенные покупки` panel: view, edit amount/trigger/protection, cancel.
8. The global `Автоматизация` tab, settings page and the global automation module registration are removed. The old `automation_*` tables and contracts may remain dormant for history; no new global rules are created. The per-order runner replaces the global runner.

## Consequences

- Protection settings are visible and editable in the order workflow, not buried in settings. Each trade group/pending order has its own values.
- There is still no server-side signer: notifications are proposals; the owner confirms the actual buy/close in the existing flows.
- Existing trade groups have null protection until the owner sets it. Existing pending orders table is new.
- The migration is additive. `nexter_app` gets SELECT/INSERT/UPDATE and no DELETE on `pending_orders`. A pre-migration backup is required.
- The old global automation tables are now dropped by ADR 0072 / migration `0050`; per-order protection and delayed buys remain.

## UI-74 addendum (2026-11-18)

- TP/SL cards have quick `+5/10/20/50%` buttons and show the target price/projected USD result.
- Existing-order protection auto-saves (700 ms debounce, blur, close); empty values disable it.
- Delayed buy keeps the market header and mutually converts amount/price/quantity.
- Sell forms have percentage quick buttons; the execution layout uses a chain icon and a single metrics row.
- The full-card link is removed from active flows; the route remains for closed trades/diagnostics.
