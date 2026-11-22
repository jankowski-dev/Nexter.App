# ADR 0082 — AI holdout settlement per cycle and active-block gate

Status: accepted, 2026-11-23.

## Context

The AI holdout ended on the last available candle and force-closed any open
position at that price. A strategy that was temporarily underwater at the
boundary was rejected even if the position would recover on the next candles.
The review of the three 200k runs also showed a false `3/3`:
`squeeze_breakout` returned `0.00 / 7.42 / 0.00` and still counted as three
non-negative blocks.

The owner approved a settlement window for every 10-day test cycle and a
stricter block activity rule before the adaptive strategy work.

## Decision

1. **Each 10-day test cycle gets its own 5-day settlement.**
   - Search history remains 180 days.
   - The split is `135 days search/OOS + 45 days holdout`.
   - The 45-day holdout is three sequential 15-day cycles: 10 days of entries
     and trading plus 5 days of settlement.
   - No new entries are allowed during settlement. Open positions may exit by
     their own stops, take-profits or trailing logic. The position is
     force-closed at the end of each settlement; the next cycle starts flat.
   - Strategy state persists across cycles, like a live bot.
   - Overall holdout return and drawdown are measured across all 45 days.
2. **Blocks are the three 15-day cycles.**
   - Block 1: days 1–15; block 2: days 16–30; block 3: days 31–45.
   - Each block contains its own 5-day settlement.
3. **Block activity is explicit.**
   - `holdoutBlocksPositive` counts blocks with return > 0.
   - `holdoutBlocksNonNegative` counts blocks with return >= 0 (display only).
   - `holdoutBlocksTraded` counts blocks with any open position (exposure),
     not just fills.
   - Recommendation requires: overall return > 0, drawdown <= 20%, at least 2
     positive blocks, at least 2 active blocks, and the last block >= 0.
4. **No threshold changes.** OOS min trades, positive folds, drawdown and worst
   fold stay as before. Holdout is not used to select or recommend a candidate; it only orders already-passed drafts by consistency.
5. **Old runs are immutable.** Existing artifacts keep their old block fields
   and recommendations; new runs use settlement.

## Why 5 days

Five days matches the 5–10 day trading cycle and is enough for a typical
stop/take/trailing exit to resolve. Ten days per cycle would make the holdout
60 days and cut the search period further; five is the first fair value.

## Consequences

- Positive: an open losing position gets a real chance to recover before the
  cycle is scored; the last block is no longer cut at an arbitrary boundary.
- Positive: flat blocks no longer count as successful; a strategy that trades
  only once cannot produce a `3/3` recommendation.
- Positive: a held position with no fills counts as active via exposure, so
  trend-following is not punished for holding.
- Negative: the search period drops from 145 to 135 days; a 180-day history has
  seven OOS folds instead of eight, and 140–146 day histories have three.
- Negative: the holdout is 45 days, so the per-candidate holdout backtest is
  longer; it is still cheap compared with the full search.
- Rollback: revert the PR; old runs stay readable. No migration.
