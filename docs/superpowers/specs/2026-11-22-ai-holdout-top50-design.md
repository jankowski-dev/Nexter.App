# AI holdout: top-50 and 10-day consistency

Date: 2026-11-22
Status: approved

## Intent

A 200k search on IRYS produced 1,342 OOS passers but tested only the top 10 on
the untouched 30-day holdout; all 10 failed after the 23 October pump-and-crash.
The owner wants a wider final gate: 50 candidates instead of 10, diversified
across strategies, with a consistency check aligned to the 5–10 day trading
cycle.

The holdout remains a rejection gate, not a selection set. We do not lower the
OOS thresholds and we do not choose the final recommendation by holdout rank.

## Goals

- Test up to 50 diversified OOS survivors on the untouched 30-day holdout.
- Give every strategy a fair chance: round-robin selection by strategy.
- Split the 30-day holdout into three 10-day blocks and require consistency.
- Make the funnel transparent: OOS passers, holdout-tested, not tested.
- Show block returns and a simple confidence label on near-misses and
  recommendations.

## Non-goals

- No change to min trades (8 total across 8 OOS folds), min positive folds
  (5/8), max drawdown (20%), worst fold (-15%), or holdout return > 0.
- No holdout-based ranking or cherry-picking.
- No 5-day holdout. Five days is too short for warmup and trade count; the
  10-day block is the smallest useful consistency unit.
- No schema migration. Additive JSON/contract fields only.

## Selection

1. Take the `metrics` array that already passed all OOS filters.
2. Group by `strategyKey`; sort each group by `policyScore` descending, then
   OOS median descending, then a stable key.
3. Round-robin by strategy rank: one candidate per strategy per round until
   50 slots are filled. With 12 strategies this gives four full rounds (48)
   plus two fillers from the strongest fifth ranks.
4. If a strategy has fewer candidates, skip it and continue with the others.
5. If slots remain after all groups are exhausted, fill by global
   `policyScore` descending. No duplicates.

This is deterministic and gives each strategy at least one holdout test when it
has an OOS passer. It replaces the current `metrics.slice(0, 10)`.

## Holdout gate

The holdout run stays one continuous 30-day backtest with the existing warmup,
fees, slippage and `next-open` execution. From `result.equityCurve`:

- split the post-warmup curve into three equal index blocks (~10 days each);
- block return = block end equity / previous block end equity − 1; for the
  first block use the first equity point as the start;
- overall return and full-holdout max drawdown are the existing stats.

A candidate is recommended only when:

- overall holdout return > 0 (existing);
- full-holdout max drawdown ≤ 20% (existing);
- at least two of three blocks are non-negative;
- the last 10-day block is non-negative (recommended, because the trading
  cycle is 5–10 days and the most recent regime matters).

Rejection reasons:

- `negative holdout` (existing);
- `holdout drawdown too high` (existing);
- `holdout blocks unstable` (new: fewer than 2/3 non-negative);
- `holdout recent block negative` (new: last block < 0);
- `non-positive policy score` (existing).

The last-block rule is the one open design choice. It is stricter than 2/3
alone and partially offsets the extra multiple testing from 50 candidates.

## Multiple testing

Fifty holdout tests increase the chance of a lucky pass compared with ten. The
block consistency and recent-block rules are stricter than the current single
return check, but they are not a formal false-discovery correction. The UI will
therefore show:

- `holdout 3/3` (high consistency) or `holdout 2/3` (medium);
- the full three block returns;
- how many OOS passers were tested vs not tested.

No candidate is ranked or selected by holdout return. Drafts are ordered by
block consistency first, then OOS policy score.

## Transparency

- Stats already expose `oosPassed` and `holdoutTested`; the UI will show
  `oosPassed − holdoutTested` as “прошли OOS, но не допущены к holdout”.
- The funnel card will show the effective min-trades threshold: 8 trades across
  8 OOS folds (~80 days).
- Near-miss cap rises from 10 to 50 so the results page can show the whole
  batch. The compact cycle card still shows the first three.
- Add a note that “мало сделок” variants are diagnostics, not recommendations.

## Contracts and storage

Additive optional fields on `aiSearchNearMissSchema` and
`aiSearchCandidateSchema`:

- `holdoutBlockReturnsPct: string[]` (three values);
- `holdoutBlocksNonNegative: number`;
- `holdoutBlocksTotal: number`.

Candidates already store metrics JSON; near-misses live in the run summary
JSON. No migration. Existing rows without the fields render as “—”.

## UI

- Cycle funnel: “прошли OOS: N · допущено к holdout: 50 · не тестировались:
  N−50”.
- Near-miss row: three block returns and `2/3` or `3/3`.
- Candidate card: a small badge with block consistency.
- New rejection labels in Russian.
- Min-trades hint: “8 сделок за 8 фолдов (≈80 дней)”.

## Tests

- Unit: round-robin selection with 12 strategies and 50 slots; deterministic,
  no duplicates, fills remainder.
- Unit: block returns and gate: 3/3, 2/3, 1/3, negative last block.
- Unit: existing holdout return/DD rejections unchanged.
- E2E: a fixture with more than 10 OOS passers yields `holdoutTested` = 50 and
  block fields on candidates/near-misses.
- Web: labels/badges and the untested count.

## ADR

Add `docs/adr/0082-ai-holdout-top50-and-blocks.md` (next free number) explaining
the trade-off, the 10-day block rationale, and why 5 days is not used.

## Rollback

Revert the PR. No data migration; existing recommendations and artifacts stay
readable. The holdout selection returns to top-10.

## Decision

The last 10-day block must be non-negative. Approved by the owner on
2026-11-22. This matches the 5–10 day trading cycle and prevents a strategy
from passing only because it made all its money early in the holdout.
