# ADR 0081 — AI holdout: diversified top-50 and 10-day block consistency

Status: accepted, 2026-11-22.

## Context

The 200k IRYS search ran on 2026-11-22. It generated 200,000 variants, evaluated
127,885 full eight-fold candidates, and 1,342 passed every OOS filter. Only the
top 10 by policy score were tested on the untouched 30-day holdout; all 10
failed. The near-miss rows showed positive OOS but a negative holdout after the
23 October pump-and-crash: Bollinger +6.25% OOS / −10.22% holdout,
trend_pullback +1.24% / −31.86%, and +0.75% / −45.97%.

The owner questioned why 200k variants produced no recommendation and why only
ten candidates reached the final gate. The top-10 rule was a multiple-testing
guard: testing all 1,342 and picking the best holdout result would fit the
holdout, not prove an edge. But the top 10 were also correlated: mostly
trend-following variants that died in the same regime.

## Decision

1. **Test 50 diversified candidates on the holdout.** OOS passers are grouped by
   strategy and selected round-robin: the best of each strategy first, then the
   second, and so on until 50 slots are filled. Remaining slots are filled by
   global policy score. Selection is deterministic and does not use the
   holdout.
2. **Split the 30-day holdout into three 10-day blocks.** Block returns come
   from the holdout equity curve. A candidate is recommended only when the
   overall holdout return is positive, the full-holdout drawdown is at most 20%,
   at least two of three blocks are non-negative, and the last 10-day block is
   non-negative.
3. **Keep the OOS thresholds unchanged.** Minimum trades remain 8 across all
   eight OOS folds (~80 days), minimum positive folds remain 5/8, max drawdown
   20%, worst fold −15%, holdout return > 0.
4. **Do not use the holdout for ranking.** The holdout remains a final rejection
   gate. Recommendations are ordered for drafts by block consistency first, then
   OOS policy score.
5. **Expose the batch in the artifact and UI.** Near-miss/candidate metrics gain
   `holdoutBlockReturnsPct`, `holdoutBlocksNonNegative`, `holdoutBlocksTotal`.
   Cycle status gains `oosPassed` and `holdoutTested` so the UI can show
   `прошли OOS · допущено к holdout · не тестировались`. Existing rows without
   the fields default to `[]`/`0`/`0`.

## Alternatives considered

- **Keep top 10.** Too narrow: ten correlated trend variants can all fail one
  pump-and-crash window even when mean-reversion variants would survive.
- **Test all 1,342.** The best holdout result would be selected after seeing the
  holdout, which is holdout fitting. The false-discovery rate would be
  unmanageable without a formal correction and a pre-registered selection rule.
- **Shorten the holdout to 5 days.** Rejected. Five days is 120 hourly candles;
  after a 15-day warmup only five days remain, often 0–2 trades. The result is
  noise, and it would make a lucky pass more likely. The 10-day block is the
  smallest useful consistency unit; the 30-day window still covers a different
  regime.
- **Use holdout return to rank the 50.** Rejected for the same reason: the
  holdout cannot be both the selection set and the final check.

## Consequences

- Positive: each strategy with an OOS passer gets at least one holdout test;
  the batch is no longer dominated by one family.
- Positive: the 3×10-day rule rejects a candidate that made all its money early
  and is losing in the most recent block, which matches the 5–10 day trading
  cycle.
- Positive: the funnel now shows how many OOS passers were not tested, removing
  the impression that all 200k were rejected.
- Negative: 50 tests increase the chance of a lucky pass compared with 10. The
  block consistency and last-block rules are stricter, but they are not a formal
  false-discovery correction. The UI labels `3/3` and `2/3` so the owner can
  weigh consistency.
- Negative: up to 50 recommendations can be stored per run; the cycle still
  creates only the profile's `maxDrafts` (default 3), so draft creation remains
  bounded.
- Rollback: revert the PR; selection returns to top 10. No migration and no data
  rewrite; legacy artifacts remain readable.
