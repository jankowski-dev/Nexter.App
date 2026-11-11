# ADR 0032 — Incremental Notion refresh after the legacy baseline

## Status

Accepted for the UI-17 data refresh on 2026-11-11. No schema change.

## Context

The Phase 4 import was a one-time migration of 431 Notion orders. Its parser includes a hard-coded control snapshot: after removing orders 465/466 and treating 450/463 as closed after the snapshot, the remaining 429 orders must match the Phase 3 audit totals within `$0.01`.

The Notion source has since changed: five orders were added (467–471), and orders 458, 461, 462, 465, and 466 were closed. A full rollback-and-reimport is blocked because the production ledger now contains later manual activity (the BNB and ETH opening lots and the owner-requested ~$1 USDC→BNB swap); the rollback endpoint returns `409` until a compensating reversal or the go-live clean cutover. The owner wants the current Notion data reflected now, not at cutover.

## Decision

- **Use the existing incremental import.** `detectExisting` verifies buy lots and trade groups for rows that are new or need a status update; already-closed orders and existing transactions are skipped by source id without revalidating their historical amounts. New orders are added and changed orders are closed. The preview totals and the expected totals in the runbook are the manual control for the skipped rows. This is the same code path the production import already supports, and it does not touch unrelated ledger activity.
- **Scope the legacy control to the original export.** The 429-order control is applicable only when every order id is numeric and at most 466. Later exports get a warning that the baseline is not applicable, not a blocking error. The preview still reports full totals, counts, valuation, and per-row skip/update decisions for owner review.
- **Do not fabricate a new control snapshot.** There is no independent Phase 3-style audit for the new orders, so inventing expected totals would create false assurance. The per-row detection and the owner-reviewed preview are the control for this refresh.
- **No full replacement before the clean cutover.** A full replacement remains part of ADR 0014. Incremental refresh is deliberately additive so the existing ledger and later manual operations are preserved.

## Consequences

- The fresh export (436 orders, 417 closed, 19 active, 9 transactions) imports by adding five active orders and closing five existing orders.
- A malformed or unexpected later export no longer fails the legacy control automatically. The preview and its totals must be reviewed against the runbook; detection still errors on new/updated lot amount/cost mismatches, missing groups, sell-without-buy, duplicate rows, and closing an order whose lot was partially consumed. An active order whose lot was partially consumed by later activity is skipped with a warning, not overwritten.
- The original 431-order control continues to work for numeric ids up to 466 and has parser tests for the boundary, later exports, and non-numeric ids.
- The import is still owner-only, audited, and reversible through the normal rollback path while no later ledger activity exists. After later activity, a compensating reversal or the clean cutover is required.
