# ADR 0077 — Native AI search backtest with Decimal trade accounting

Status: accepted, 2026-11-22.

## Context

A 5,000-variant AI search evaluates ~4,000 variants after the signal screen, each with eight walk-forward folds. A CPU profile of 100 slow variants showed **85–90% of time inside Decimal.js** (`finalise` 18.1%, `Decimal` 14.8%, `parseDecimal` 13.3%, `mul` 9.4%, `plus` 7.1%, `minus` 5.7%, `pow` 4.1%). Indicators were ~3% and Zod ~0.3%. The 1,000-variant probe/backtest path could not scale to 10k–50k proposals, and a one-fold hard probe was rejected because it lost 18.3% of real OOS passers (47.8% inside `squeeze_breakout`).

The product requires speed **without losing candidates**: no threshold loosening, no silent sample-based rejection.

## Decision

Add a dedicated native-number search path for all 11 AI-eligible strategies:

- `ai-fast-strategies.ts` mirrors each strategy's entry, exit and state logic with native numbers and precomputed SMA / rolling high-low / Bollinger series.
- `ai-fast-backtest.ts` mirrors the backtest engine, but keeps **cash, position, amount, cost basis and fills in Decimal**. Native arithmetic is used only for indicators, decisions, equity and drawdown.
- Protective stop/take-profit prices use the same Decimal coefficient as the reference (`avgCost.mul(1 ± pct / 100)`), because a different Decimal approximation of the coefficient changes cash by a few ulps and can flip a full-cash buy.
- `ai-fast-compare.ts` flags a comparison as ambiguous when both operands are within `1e-11` relative. `ai-search.evaluate.ts` then re-runs **only that fold** on the Decimal engine; folds are independent, so the aggregate stays exact.
- `AI_SEARCH_FAST_ENGINE=0` forces the full Decimal path. The Decimal engine remains authoritative for bots, holdout and ambiguous folds.

## Measurements

- Raw native path, 88–132 variants across all 11 strategies: **25x** faster (467 → 19 ms/variant), exact aggregate equality.
- End-to-end `evaluateVariantFolds` including ambiguous-fold fallback, 300 screened variants: **7.8x** faster (572 → 73 ms/variant).
- Parity: 132/132 exact across all strategies; the 990-variant run is the regression gate (see the plan doc). Mismatches were found and fixed during development:
  - native full-cash buys were rejected by a floating-point ulp (fixed by Decimal cash/position);
  - `stopPrice`/`takeProfitPrice` used a different Decimal coefficient (fixed);
  - the crash-grid `mode` did not reset on a new high (fixed);
  - drawdown initialized the peak at the initial capital instead of the first equity point (fixed).
- Expected 5,000-variant search: ~15 minutes → ~2 minutes including the signal screen.

## Consequences

- Positive: no variants are dropped; every non-ambiguous decision matches the Decimal reference bit-for-bit in the parity sample.
- Positive: the search can evaluate 10k–50k proposals without a lossy probe or a hard budget sample.
- Positive: the holdout and final candidate metrics remain Decimal; the fast path is search-only.
- Negative: the fast path duplicates the strategy logic. Every strategy change must update both implementations and pass the parity test.
- Negative: ~10% of variants hit a boundary on at least one fold and pay a Decimal fold; this is the safety cost that keeps the candidate set exact.
- Rollback: `AI_SEARCH_FAST_ENGINE=0` or revert. No schema change or migration.
