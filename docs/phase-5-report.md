# Phase 5 — MVP-1 UI Report

Date: 2026-11-04

Status: **implementation complete; pending independent review and acceptance.**

## Scope completed

- ADR `0008-phase-5-ui-data.md`.
- Migration `0008_common_the_spike.sql`:
  - `watchlist` table with soft archive, tags, priority, `(user_id, asset_id)` unique;
  - `trade_groups.notes`.
- Backend APIs:
  - `GET /dashboard/summary` extended with ROI and active-position count;
  - `GET /dashboard/equity-curve`, `/allocation`, `/pnl`, `/active-positions`, `/recent-trades`, `/data-quality`;
  - `GET /trade-groups`, `GET /trade-groups/:id`, `PATCH /trade-groups/:id`, `POST /trade-groups/:id/sells`;
  - `GET /portfolio/assets/:assetId`;
  - cursor pagination/filters for `GET /transactions`;
  - watchlist CRUD with Notion Source backfill;
  - settings GET/PATCH with audit;
  - audit-log read API with filters;
  - CSV/JSON export for transactions, positions, and trade groups;
  - trade-detail audit includes import-level audit entries for imported groups.
- Frontend:
  - full dashboard with KPI cards, current-price equity curve, allocation, monthly P&L, active positions, recent trades, and data-quality banner;
  - portfolio positions/accounts tabs and asset detail with lots, prices, trade groups, and transactions;
  - trades positions/activity tabs with filters, pagination, and trade detail with legs, lots, consumptions, audit, notes, and add-sell action;
  - watchlist cards with add/edit/archive, thesis, tags, priority, price, and 24h change when available;
  - settings general form, accounts list, audit log, data quality, and export;
  - global manual-entry dialog for buy, sell, swap, transfer, deposit, withdrawal, income, and adjustment;
  - shared Russian dark-theme UI primitives: badges, dialog, select, textarea, skeleton, empty/error states, SVG charts.

## Verification

- `pnpm typecheck` — pass.
- `pnpm lint` — pass.
- `pnpm format:check` — pass.
- `pnpm build` — pass.
- API tests — **52 passed, 1 skipped** with the disposable PostgreSQL test database. The skipped test is the opt-in real 431-row import test.
- Real 431-row import e2e (`NOTION_EXPORT_DIR`) — import plus Phase 5 dashboard/trade-group/portfolio/watchlist/audit/export/equity-curve assertions pass.
- Playwright — **3 tests pass**: auth flow, Notion import UI, and the Phase 5 MVP-1 UI flow (dashboard, portfolio asset detail, trades, trade note, watchlist CRUD, settings save, CSV download, manual deposit).

## Design decisions

- The equity curve is explicitly valued at **current prices** (`valuation = current-prices`). Historical market prices are unavailable for the imported history; the UI labels the curve rather than inventing historical prices.
- Closed imported orders keep their per-order lot; imported active lots remain in the manual global-FIFO pool, as documented in ADR 0007.
- Watchlist backfill uses the latest committed Notion import's Source rows once per owner; thesis comes from `Описание`, tags from `Топ`/`Дашборд`/`П-Мкап`.
- Settings remain intentionally narrow for MVP-1: USD and FIFO are fixed; timezone and gas-in-cost-basis are editable.
- Trade reversal is deferred to Phase 6; notes are editable and audited, but ledger corrections remain append-only.
- The runtime Swagger document remains the API documentation; the shared Zod contracts remain the typed client. A separate generated OpenAPI client is a Phase 6 tooling improvement.

## Known limitations

- Trade-group reverse/compensating reversal is not implemented.
- Equity curve uses current prices for historical holdings; true historical valuation needs daily snapshots (Phase 6).
- Watchlist priority is editable but not drag-sorted; list is priority-desc then newest.
- Settings accounts are read-only; account creation/renaming is deferred.
- Manual-entry preview is approximate; the server remains the authority for FIFO, fees, and validation.
- Trade-group list P&L-sign filtering is applied after the page query; the UI does not expose it yet.
- Export is server-generated and audited; very large exports may take longer than the normal list budget.
- OpenAPI client generation is deferred as documented in ADR 0008.
- Full UAT, performance hardening, backup restore test, and security review remain Phase 6.

## Review history

Pending independent Phase 5 review.
