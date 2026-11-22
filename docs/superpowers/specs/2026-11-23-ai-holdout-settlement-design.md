# AI holdout settlement and active blocks

Date: 2026-11-23
Status: approved

## Intent

The current holdout ends on the last available candle and force-closes any open
position at that price. A strategy that is temporarily underwater at the
boundary is rejected even if the position would recover on the next candles.
The 3-token JSON review also showed a false `3/3`: `squeeze_breakout` returned
`0.00 / 7.42 / 0.00` and still counted as three non-negative blocks.

The owner approved a settlement window and a stricter block rule before the
adaptive strategy work.

## Decision

1. **Each 10-day test cycle gets its own 5-day settlement.**
   - The search history remains 180 days.
   - The split is `135 days search/OOS + 45 days holdout`.
   - The 45-day holdout is three sequential 15-day cycles: each cycle is
     10 days of entries/trading plus 5 days of settlement.
   - No new entries are allowed during a settlement; open positions may exit by
     their own stops, take-profits or trailing logic. The position is force-closed
     at the end of each settlement; the next cycle starts flat.
   - Strategy state (HWM, cooldown, etc.) persists across cycles, like a live bot.
   - Overall holdout return and drawdown are measured across all 45 days.
2. **Blocks are the three 15-day cycles.**
   - Block 1: cycle 1, days 1–15 (10 test + 5 settlement).
   - Block 2: cycle 2, days 16–30 (10 test + 5 settlement).
   - Block 3: cycle 3, days 31–45 (10 test + 5 settlement).
3. **Block activity is explicit.**
   - `holdoutBlocksPositive` counts blocks with return > 0.
   - `holdoutBlocksNonNegative` counts blocks with return >= 0 (kept for
     display).
   - `holdoutBlocksTraded` counts blocks with any open position (exposure), not
     just fills; a held trend position counts as active.
   - Recommendation requires: overall return > 0, drawdown <= 20%, at least 2
     positive blocks, at least 2 active blocks, and the last block >= 0.
4. **No threshold changes.** OOS min trades, positive folds, drawdown and worst
   fold stay as before. Holdout is still not used for ranking.
5. **Old runs are immutable.** Existing artifacts keep their old block fields
   and recommendations; new runs use settlement.

## Why 5 days

Five days matches the 5–10 day trading cycle and is enough for a typical
stop/take/trailing exit to resolve. Each cycle is 15 days, the holdout is 45
days, and the search period is 135 days (seven folds for a 180-day history).
Ten days of settlement per cycle would make the holdout 60 days and cut the
search period further; five is the first fair value.

## Data and API

- `buildSearchFolds` returns a 45-day holdout and `settlementRanges` relative
  to the holdout (`[10d,15d)`, `[25d,30d)`, `[40d,45d)`), plus `settlementDays=5`
  and `holdoutCycles=3`.
- `runBacktest` gains `settlementRanges` and returns an `exposure` array
  (`{ date, inPosition }`) used to count active blocks. It force-closes at each
  settlement end.
- `holdoutBlockStats` splits the 45-day equity curve into three equal 15-day
  blocks and counts positive/non-negative/traded blocks from exposure.
- Search results/artifact gain `settlementDays` and `holdoutCycles`.
- Near-miss/candidate metrics gain `holdoutBlocksPositive` and
  `holdoutBlocksTraded`.
- Cycle status/summary gain `settlementDays` for the UI.
- UI labels show `10 / 10 / 10+5` and `positive/total`, `active/total`.

## Non-goals

- No migration.
- No change to the adaptive strategy in this phase.
- No lower thresholds or extra holdout candidates.
- No change to the existing 12 strategy rules.

## Risks

- Settlement can still end with an open loser if the strategy's exit logic is
  bad; that is a real failure, not a boundary artifact.
- The holdout moves 5 days back from the latest candle. The regime verdict can
  still use the latest data, but the evaluated holdout is 5 days older.
- The search period drops from 145 to 135 days; a 180-day history has seven
  folds instead of eight, and 140–146 day histories have three folds.
- The holdout is the most recent 45 days, so the evaluated regime is current;
  the trade-off is less OOS history.

## Rollback

Revert the PR. No data migration; old runs remain readable. The search returns
to a 30-day holdout without settlement and the previous block rule.
