# API & UX Spec

## API conventions

- Base `/api/v1`.
- JSON, camelCase.
- Session cookie + CSRF header.
- `Idempotency-Key` for POST mutations.
- Cursor pagination `{ data, page: { nextCursor, hasMore } }`.
- ISO 8601 UTC dates.
- Decimal strings for money.
- Error envelope `{ error: { code, message, details, requestId } }`.

## MVP-1 routes

`/setup`, `/login`, `/2fa`, `/recovery`, `/dashboard`, `/portfolio`, `/portfolio/assets/:id`, `/trades`, `/trades/:id`, `/import`, `/watchlist`, `/settings`, `/settings/security`, `/settings/accounts`, `/settings/audit`, `/settings/data-quality`.

## MVP-2 routes

`/swap`, `/swap/history`.

## MVP-1 endpoints

Auth, dashboard, positions, accounts, assets, trade groups, transactions, imports, watchlist, settings, audit, health, readiness.

Phase 5 additions:

- Dashboard: `GET /dashboard/summary`, `/equity-curve`, `/allocation`, `/pnl`, `/active-positions`, `/recent-trades`, `/data-quality`.
- Portfolio: `GET /positions`, `/positions/:assetId`, `/portfolio/assets/:assetId`, `/accounts`, `/accounts/:id`, `/assets`, `/assets/:id`.
- Trades: `GET /trade-groups` (cursor/filters), `GET /trade-groups/:id`, `PATCH /trade-groups/:id` (notes), `POST /trade-groups/:id/sells`.
- Transactions: `GET /transactions?limit&cursor&type&subtype&source&assetId&tradeGroupId&from&to&search` returns `{ transactions, page }`.
- Watchlist: `GET /watchlist`, `POST /watchlist`, `PATCH /watchlist/:id`, `DELETE /watchlist/:id` (soft archive).
- Settings/audit/export: `GET/PATCH /settings`, `GET /audit-log`, `GET /export/transactions.csv|json`, `/export/positions.csv|json`, `/export/trade-groups.csv|json`.
- The equity curve uses current prices for historical holdings (`valuation = current-prices`) because historical prices are unavailable; the UI labels this explicitly.
- Trade reversal is deferred to Phase 6.

Notion import endpoints:

- `POST /api/v1/imports/notion/preview` — accepts `{ fileName?, source[], orders[], transactions[] }`, stages the export, returns summary and row statuses. It never writes the ledger.
- `GET /api/v1/imports` — import history.
- `GET /api/v1/imports/:id` — import summary and rows.
- `GET /api/v1/imports/:id/reconciliation` — stored control, current deltas, and valuation.
- `POST /api/v1/imports/:id/commit` — applies a preview in one transaction; re-runs existing-row detection under the user lock.
- `POST /api/v1/imports/:id/rollback` — removes the newest import's ledger effects while no later activity exists.

The raw Notion export can exceed the default Fastify 1 MiB body limit. The preview requires `Content-Type: application/x-notion-import+json` and accepts up to 10 MiB; `application/json` returns `415`, and a `preParsing` guard rejects the import content type outside the preview route. Other routes keep the default 1 MiB. The browser sends the raw file text without `JSON.parse`, so money values never pass through a JS number.

## Key UX flows

- First-run setup → recovery codes → 2FA → dashboard.
- Login → 2FA → dashboard.
- Notion upload → mapping → reconciliation → commit. The `/import` page accepts `Source.json`, `Orders.json`, and `Transactions.json`, shows current totals, active cost, the reconstructed 429-order control baseline, known post-snapshot changes, current valuation at Source prices, warnings, errors, and import history. Commit and rollback require confirmation. Selecting a new file clears the previous preview. After commit the page shows cash, positions, equity, net deposits, realized/unrealized/total P&L from the accounting API.
- Manual buy → group → partial sell → FIFO P&L.
- Transfer without P&L; gas as expense/cost basis.
- Income creates lot and income posting.
- Adjustment requires reason and audit.
- Session revoke, recovery, export.

## UI states

Every screen has loading skeleton, empty state, error state, forbidden state, offline banner, and partial-data warning. Forms validate inline, guard unsaved changes, and show a preview before financial mutations.

## Accessibility

Keyboard navigation, focus rings, ARIA labels, `aria-current`, skip link, contrast, not color-only P&L. Russian UI, dark theme.

## Performance

Dashboard <1s, lists <500ms, import preview <5s on 429 rows. Server-side aggregation, cursor pagination, virtualized tables, short-lived cache.

Phase 5 dashboard aggregate endpoints are read-only and derived from the ledger. Trade-group list uses a single aggregate query; the recent-trades dashboard card reuses it with limit 5. Export streams the same service data and is audited per generation.
