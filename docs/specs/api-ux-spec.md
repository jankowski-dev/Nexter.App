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

## Key UX flows

- First-run setup → recovery codes → 2FA → dashboard.
- Login → 2FA → dashboard.
- Notion upload → mapping → reconciliation → commit.
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
