# ADR 0088 — Portfolio equity points for hourly capital history

Status: accepted, 2026-11-25.

## Context

`portfolio_snapshots` stores one row per owner per local day, overwritten by the hourly snapshot
job. The existing `GET /dashboard/equity-curve` therefore has daily resolution only. The owner
wants an equity chart with hours/days/months in `Крипта → Обзор`. Hourly history cannot be
reconstructed honestly from daily snapshots or current quotes.

## Decision

1. Add `portfolio_equity_points` with one row per owner per UTC hour (`bucket_at`), storing cash,
   positions value and equity at capture time.
2. `PortfolioSnapshotService.capture` continues to upsert the daily snapshot and additionally
   upserts the current UTC hour point. The hourly write is audited as
   `accounting.portfolio_equity_point`.
3. For `hour`, `GET /dashboard/equity-series?range=hour` reads the last 24 hourly points. For
   `day` and `month`, it uses the existing daily snapshots (last 30 days / last 12 month-ends).
4. Existing daily snapshots are not rewritten into hourly points, and no synthetic hours are
   produced. The UI states that hourly collection started at deploy time and shows a collection
   note until at least two points exist.
5. Rows are retained; no DELETE grant exists. A future retention policy can archive old hourly
   points after the daily/monthly history is sufficient.

## Consequences

- Positive: honest intraday history for the new chart, with no change to the existing
  `equity-curve` contract.
- Positive: daily/monthly charts keep using the established snapshot data.
- Negative: the first 24 hours after deploy have little hourly history; the empty/collection
  state is intentional.
- Negative: one extra row per owner per hour (about 8,760 rows per owner per year).
- Rollback: deploy the previous image; the table stays inert and no data restore is required.
