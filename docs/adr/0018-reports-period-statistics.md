# ADR 0018 — Period reports and trade statistics

## Status

Accepted for UI-4 (2026-11-09).

## Context

The Reports page reused dashboard endpoints: current equity, all-time realized P&L, all-time fees, and current positions. It had no period filter, no trade-level statistics, no gas breakdown, no per-asset realized result, and no period-scoped export. The owner wants reports for a chosen period without tax calculations or new accounting rules.

## Decision

- **Report endpoint.** `GET /api/v1/reports?from=YYYY-MM-DD&to=YYYY-MM-DD` returns a period summary, monthly buckets, per-asset realized results, and operation counts. `from`/`to` are optional and inclusive. Dates are interpreted as local calendar dates in the user's configured timezone. The maximum range is 10 years.
- **Realized P&L.** Sum of `lot_consumptions.realized_pnl_usd` for disposals whose transaction `occurred_at` falls in the period. The existing FIFO accounting remains the source of truth.
- **Trade statistics.** Profit factor, win rate, gross profit, and gross loss group the period's consumptions by `trade_group_id`. Disposals without a trade group (for example crypto-to-crypto exchanges) contribute to realized P&L but not to win rate. A trade group is counted when it has at least one consumption in the period; break-even groups are excluded from the win/loss denominator.
- **Fees.** `transactions.fees_usd` within the period. Fees capitalized into cost basis or proceeds by the accounting policy are already reflected in realized P&L and are not counted again. Fees are shown for information; the report does not invent a separate tax or expense treatment.
- **Gas.** Sum of `swap_orders.network_fee_usd` for `CONFIRMED` orders confirmed in the period. Gas is shown separately and is not subtracted from report P&L because it may already be part of the recorded execution cost or fees.
- **Cash flows.** Deposits, withdrawals, income, and adjustments come from wallet-account postings. `netDepositsUsd = deposits − withdrawals`. Withdrawals are displayed as a positive amount.
- **Monthly buckets.** Calendar months in the user's timezone. `netPnlUsd = realized + income + adjustments − fees`; gas is not subtracted there either.
- **Asset breakdown.** Realized P&L, proceeds, cost basis, consumption count, and distinct trade groups per asset. Fee-asset lot reductions with no proceeds and no realized P&L are excluded because they are not disposals.
- **Exports.** Existing CSV/JSON exports accept optional `from`/`to` date parameters. Transaction exports filter by `occurred_at`; trade-group exports filter by `opened_at`; position exports remain current-state. The Reports page scopes the transaction export to the selected period and labels the other exports as current/all-time.
- **No tax logic.** Reports are bookkeeping statistics only. No tax rates, tax lots, or jurisdiction rules are added.

## Consequences

- Period reports are deterministic and reconcile with FIFO lot consumptions, not with UI-only estimates.
- A period may show different totals than the all-time dashboard, which is expected.
- Different timezones can move transactions at month boundaries; the report states its timezone.
- Gas remains informational to avoid double counting.
- Exports remain append-only reads and are audited with the selected period.
