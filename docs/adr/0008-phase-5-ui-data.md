# ADR 0008 — Phase 5 MVP-1 UI data contracts

## Status

Accepted for Phase 5.

## Context

Phase 5 turns the accepted accounting/import backend into the full MVP-1 UI: dashboard, portfolio, trades, trade detail, watchlist, settings, data quality, and export. The existing schema already has `settings` and `audit_log`; trade groups have no notes; the watchlist and portfolio snapshot tables are absent.

Phase 5 must not invent financial values. Historical market prices are not available for the imported Notion history, so an equity curve cannot be reconstructed at historical market values without inventing prices.

## Decision

### Trade groups

- Add `trade_groups.notes` for the trade-detail notes field. Notes are product metadata, not ledger data.
- Add read endpoints `GET /trade-groups` and `GET /trade-groups/:id` returning the group, asset, legs, lots, lot consumptions, audit entries, and notes.
- Add `PATCH /trade-groups/:id` for notes only, audited.
- Add `POST /trade-groups/:id/sells`, which delegates to the existing manual sell path with `tradeGroupId`. FIFO remains global for manual sells; the group identifies the trade context.
- A compensating `POST /trade-groups/:id/reverse` is deferred to Phase 6. Ordinary ledger corrections remain new transactions, never deletes.

### Watchlist

- Add `watchlist`: `(user_id, asset_id)` unique, thesis, tags, priority, `archived_at`, timestamps.
- Archive is soft (`DELETE` sets `archived_at`); list hides archived entries unless requested.
- On the first watchlist read for an owner, backfill from the latest committed Notion import's source rows: thesis from `Описание`, tags from `Топ`/`Дашборд`/`П-Мкап`, linked by asset symbol. Backfill is audited once.
- Price and 24h change use the latest `prices` row and the latest row at least 24 hours older. If no 24h price exists, the change is `null`, not invented.

### Settings

- Use the existing `settings` table. `baseCurrency` is fixed USD for MVP-1, `taxMethod` is fixed FIFO, and `displayCurrency` is fixed USD.
- Editable: `timezone` and `includeGasInCostBasis`.
- `GET /settings` creates the default row if missing. `PATCH /settings` is audited.

### Audit log

- Add read-only `GET /audit-log` with cursor pagination and action/entity/date filters.
- The owner sees entries for their user and system entries with `user_id = null`.

### Dashboard aggregates

- `GET /dashboard/allocation` — current cash/asset allocation at latest prices.
- `GET /dashboard/pnl` — realized P&L, income, adjustments, and fees by month.
- `GET /dashboard/active-positions` — current non-cash positions.
- `GET /dashboard/recent-trades` — recent trade groups.
- `GET /dashboard/data-quality` — unknown chain/contract, missing prices, missing gas, unreconciled, unverified assets, negative balances.
- `GET /dashboard/equity-curve` — month-end cash + positions valued at **current** prices, labelled `valuation = current-prices`. It is not a historical market valuation. The response includes a note; the UI labels it explicitly. True historical equity needs daily price snapshots, which remain a later phase.

### Pagination

- Transactions, trade groups, watchlist, audit log, and exports use cursor pagination where lists can grow. Existing `GET /transactions` keeps `transactions` and adds optional `page` metadata for compatibility.

### Export

- `GET /export/transactions.csv|json`, `GET /export/positions.csv|json`, `GET /export/trade-groups.csv|json`.
- Exports are read-only, authenticated, and audited once per generation (`export.generated`). CSV is generated server-side with proper quoting.

### Manual entry

- The UI uses the existing `POST /transactions` ledger API. The form preview is display-only; submitted money is decimal strings. The server remains the source of validation.
- Supported types: buy, sell, swap, transfer, deposit, withdrawal, income, adjustment. Fees are optional.

### OpenAPI

- The runtime Swagger document remains enabled in development/test. The frontend continues to use the shared Zod contracts (`@nexter/contracts`) as its typed API client, which are the same contracts used by the server. A separate generated OpenAPI client is not added in Phase 5; this is recorded as a deliberate tooling choice rather than a second hand-written client. Phase 6 can add generated types if needed.

## Consequences

- Watchlist and trade notes are additive, reviewable schema changes.
- The dashboard is honest about unavailable historical prices; the equity curve is explicitly current-price valued.
- Trade reversal remains a compensating-transaction design for Phase 6.
- Settings remain intentionally narrow for MVP-1 (USD/FIFO fixed).
- All mutations (watchlist, settings, trade notes, exports) are audited.
