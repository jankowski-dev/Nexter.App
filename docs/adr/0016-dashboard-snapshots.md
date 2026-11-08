# ADR 0016 — Dashboard analytics and daily portfolio snapshots

## Status

Accepted for UI-2 (2026-11-08).

## Context

The dashboard equity curve currently values historical ledger balances at the latest prices. That is useful as an approximation but not a real historical curve. The owner also needs trade-quality metrics: profit factor, gross profit/loss, win rate, positive/negative unrealized P&L, free cash by asset, and gas paid.

The legacy Notion data will be retired at the clean cutover (ADR 0014), so reconstructing historical prices for it would add complexity without a durable benefit. The go-forward ledger needs an accurate daily curve.

## Decision

- **Snapshot table.** Migration `0017` adds `portfolio_snapshots` with a unique `(user_id, snapshot_date)` row and cash/positions/equity USD values.
- **Daily capture.** `PortfolioSnapshotService` runs in the API process, upserts the current day's snapshot on a configurable interval (default hourly), and uses the user's configured IANA timezone to choose the date. Concurrent API replicas are safe because the unique key makes the upsert idempotent.
- **Manual capture.** `POST /api/v1/dashboard/snapshot` lets the owner create/update today's snapshot immediately. Every capture writes an audit row.
- **Equity curve.** `GET /api/v1/dashboard/equity-curve` returns persisted daily snapshots when present (`valuation: daily-snapshots`); otherwise it falls back to the existing current-price approximation. History before the first snapshot is not reconstructed.
- **Dashboard metrics.** The summary adds:
  - gross realized profit/loss and profit factor, computed per closed trade group from realized P&L;
  - winning/losing closed groups and win rate;
  - positive and negative unrealized P&L across open positions;
  - free cash by cash-equivalent asset;
  - gas paid from confirmed swap orders (`network_fee_usd`).
- **No ledger mutation.** Snapshots and analytics are read-only with respect to the ledger. They do not create transactions, rewrite lots, or invent tax values.
- **Rollout.** `PORTFOLIO_SNAPSHOTS_ENABLED` defaults to true; `PORTFOLIO_SNAPSHOT_INTERVAL_SECONDS` defaults to 3600. The service is disabled in `NODE_ENV=test`; tests call the manual endpoint. Migration `0017` is additive.

## Consequences

- The forward curve becomes accurate after the first snapshot; legacy points are not backfilled.
- Profit factor is gross realized (before fees) and per trade group; fees are shown separately. No tax interpretation is implied.
- Gas is limited to confirmed swap orders. Imported/manual gas remains unknown and is not invented.
- Cash equivalents are valued at $1, matching the existing ledger valuation.
- The API process performs the capture; the worker remains unchanged.
