# Adaptive multi-stage AI search plan

Status: planned. Supersedes the flat “5,000 random variants” search after Phase 8 hardening. The goal is to explore far more parameter space without paying the full 8-fold backtest cost for every candidate.

## Goal

Turn the current flat search:

```
5,000 random variants -> 8 folds each -> top-10 holdout
```

into a staged funnel:

```
1,000,000 proposals
  -> validity + dedupe + hard necessary conditions
  -> cheap signal/trade screen (1 fold)
  -> coarse 2-fold backtest
  -> full 8-fold search
  -> holdout top-10
  -> local refinement around the best neighborhoods
```

The first stages must be **recall-oriented**: they may reject only candidates that cannot possibly pass, or mark candidates as low priority while keeping a random control sample. They must never use the final holdout.

## 0. Plain-language model (owner analogy)

Think of a marriage search:

- **1 000 000 анкет** — parameter sets. Looking at every profile through a full 8-fold backtest is like living with every candidate for years.
- **Фото и анкета** — cheap screening: obvious incompatibilities, invalid parameters, no entry signals, lookback longer than the data, thresholds that cannot trigger.
- **«Не нравятся носы/полные»** — probabilistic preferences: volatility-adjusted stop/take, cost vs target, strategy-regime mismatch. These are priors, not proof; keep a small control group of filtered-out candidates to measure false negatives.
- **Первое свидание** — one or two OOS folds on survivors.
- **Совместная жизнь** — full 8-fold search.
- **Брак** — the untouched 30-day holdout; after this there is no more selection.

The point is not to reject 99% by a single trait. The point is to reject only what **cannot** work, rank the rest by cheap evidence, and keep a control sample so the filter does not throw away the one good candidate.

## 1. Fast screening: hard necessary conditions

These are safe rejections. If one fails, the candidate cannot become a recommendation.

1. **Parameter validity** — `parseParams` fails, `fastPeriod >= slowPeriod`, non-finite values, duplicate `(strategy, params)`.
2. **Lookback vs available data** — `slowPeriod`/`lookback`/`anchorLookback`/`exitPeriod` longer than the available warmup+OOS window.
3. **Signal-count lower bound** — count entry conditions on the OOS candles; if entry signals are fewer than the minimum trades required for the fold count, the variant cannot pass `MIN_TRADES`. This is the strongest cheap filter.
4. **Data quality** — no candles, stale series, missing/gap above policy, malformed prices; reject before any computation.
5. **Strategy feasibility** — e.g. grid step wider than the historical range so the first grid level can never trigger; breakout buffer above the historical range; entry drop above historical max drawdown; thresholds that cannot produce an entry in the window.

## 2. Fast screening: probabilistic markers

These are **ranking/pruning features**, not proof. Use them to order the funnel and drop only with a control sample.

- **Volatility-adjusted thresholds:** take-profit/stop-loss versus ATR and the historical 1–3 day range. A stop much smaller than noise gets stopped constantly; a take far above the observed range almost never triggers.
- **Signal density:** trades per 10-day OOS window vs the strategy’s expected frequency.
- **Strategy-regime mismatch:** mean-reversion/grid in a strong trend; breakout/momentum in a flat low-volatility range. Use only as a prior, not a hard reject.
- **Parameter extremes:** combinations far outside sensible priors (e.g. TP 100% + stop 50%, 20 grid adds with a 20% step).
- **Cost sensitivity:** expected move vs 25 bps fee + 10 bps slippage; if the average target is smaller than costs, the variant is unlikely to survive.
- **Surrogate score:** a lightweight model trained on prior full-search results (strategy, params, volatility, signal count, data quality) predicts `P(pass OOS)`. Keep a random 5–10% exploration slice; never use the surrogate as the only rejector.

## 3. Successive halving

A practical funnel for 1,000,000 proposals:

| Stage | What runs                                 |         Typical survivors | Cost                           |
| ----- | ----------------------------------------- | ------------------------: | ------------------------------ |
| 0     | Validation, priors, dedupe                |           300,000–500,000 | seconds                        |
| 1     | Signal-count screen on 1 fold             |             30,000–50,000 | minutes                        |
| 2     | Coarse backtest on 2 folds                |              5,000–10,000 | tens of minutes? benchmark     |
| 3     | Full 8 folds / 5 folds on reduced history |               2,000–5,000 | ~5–20 minutes with worker pool |
| 4     | Holdout top-10                            |                        10 | negligible                     |
| 5     | Local refinement around top neighborhoods | 5,000–20,000 new variants | 5–20 minutes                   |

Exact survivor counts must be measured, not assumed. The funnel must report stage counts, rejection reasons and recall against a control sample.

## 4. Local refinement

After the full search:

- take top-N (e.g. 50–100) per strategy, not just top-10 overall;
- generate neighboring parameters around each winner (coordinate steps, ±1–3 grid steps, local random jitter);
- run the same screen/full pipeline on 5,000–20,000 refined variants;
- keep the holdout untouched by refinement selection; the final recommendation still uses one final holdout.

This is more valuable than simply increasing the random budget: it explores the promising regions instead of adding noise.

## 5. Required implementation pieces

1. **Precomputed fold features** — returns, ATR, rolling high/low, volatility, drawdown distribution, gap/synthetic flags, signal counters for parameter families.
2. **`screenVariant` pure module** — hard checks and probabilistic score with explicit reasons.
3. **Cheap signal evaluator** — counts entries without simulating cash/positions/fees. Reuse strategy `evaluate` where possible; otherwise per-strategy entry predicates.
4. **Staged orchestrator** — runs stages, persists per-stage counts/artifacts, supports cancellation and resume.
5. **Worker pool / durable job** — screening stages can be parallelized; full search remains a durable `ai_jobs` job.
6. **Artifact limits** — per-variant dumps only for survivors; aggregate counts for the million-scale stages.
7. **UI** — stage progress, survivor counts, rejection reasons, no misleading “0 recommendations” without funnel context.
8. **Calibration/guardrail** — keep a random control slice through all stages; report recall and false-negative rate; no holdout leakage.

## 6. Guardrails

- Never use the 30-day holdout for screening, ranking or local refinement.
- Hard rejects only for necessary conditions; soft markers only with a retained exploration slice.
- Report the full funnel: proposals → valid → signals → coarse → full → holdout.
- Cap artifacts; do not store 1M full metric rows in one JSONB payload.
- Multiple testing: final recommendations still require holdout; consider a second independent holdout or a correction before increasing the random budget.
- Do not lower `MIN_TRADES`, DD or holdout thresholds to “make” recommendations.

## 7. Acceptance criteria

- 1M proposals can be screened without full 8-fold backtests.
- The screening stage records hard/soft rejection counts and a control-sample recall estimate.
- Survivors are processed by the existing full evaluator; results are deterministic and match a non-screened run on the same survivors.
- Local refinement improves the best OOS/holdout metrics on a fixed fixture without changing thresholds.
- A production run reports stage timings and total wall time.

## 8. Relation to the current plan

This is **Phase 9** after the durable `ai_jobs` worker. It replaces the flat 5,000-only search but keeps the same recommendation/risk/holdout boundaries. The final engineering PDF must include the funnel and the hard-vs-soft marker distinction.

## Pilot 2026-11-22

A 5,000-variant pilot on the local 4-core AMD machine:

- hard parameter/data screen rejected **0/5,000** (the generator already produces valid, in-range variants);
- one-fold trade probe kept **1,578/5,000 (31.56%)** with at least one trade;
- one-fold evaluation took **191 s** for 5,000 variants on 4 workers.

Extrapolation: 50,000 one-fold probes ≈ 32 min locally; 1,000,000 ≈ 10+ hours. This confirms that the hard screen alone is not the 99% filter. The next implementation must be a **signal-only evaluator with precomputed indicators**, not a full `runBacktest` on one fold. The 31.56% survivor rate is a useful baseline for the signal screen's recall.

## Staged pilot 2026-11-22

10,000 proposals on the local 4-core machine, synthetic 180-day 1h fixture:

- hard parameter/data screen: **0 rejected** (generator already valid);
- one-fold trade probe: **2,954 survivors (29.54%)**;
- full 8-fold evaluation: 2,954; 2,833 passed the minimum trades;
- top-10 holdout on the synthetic fixture: **10 recommendations** (fixture result, not a production claim);
- time: one-fold **442 s**, full 8 folds **984 s**; generate+screen < 1 s.

The funnel cut full 8-fold evaluations by ~70%, but the one-fold probe still cost 7.4 min. A 50k/1M pilot needs the signal-only evaluator, not a one-fold full backtest. This is the baseline for Phase 9.

## Signal-screen pilot 2026-11-22

On 5,000 random variants over 180 days (8 folds), the signal-only screen took **2.9 s** and rejected **2,186 (43.7%)** with `too few entry signals`; 2,814 survived. It covers 7 strategies where counting buy signals is a safe upper bound. Grid/DCA/crash/failed breakout are position/state-dependent and deliberately skip this hard gate.

For comparison, the one-fold full backtest of the same 5,000 took 191 s. The signal screen is ~65× cheaper and already removes almost half the proposals before any P&L simulation.

## Staged funnel implementation 2026-11-22

The production search now exposes the funnel as stages:

```
screen -> probe (optional) -> budget -> full OOS -> control sample -> holdout
```

- Stage counts, rejections, durations and control passers are stored in the search artifact (`funnel`) and shown in the UI.
- `stats.total = stats.screenedOut + stats.probeOut + stats.budgetOut + stats.evaluated`.
- `AI_SEARCH_FULL_BUDGET` defaults to `8000`; above it the funnel takes a deterministic uniform sample (2% random exploration when the probe ranking is active).
- Control samples never become candidates; they only estimate missed passers and recall.
- The request limit is now 100,000 variants.

### One-fold probe recall experiment

3,000 variants, 180 days, 8 folds, full eight-fold ground truth:

| Stage                     | Result                                                   |
| ------------------------- | -------------------------------------------------------- |
| Signal screen             | 1,265 rejected (42.17%), **0 false negatives**           |
| One-fold probe (≥1 trade) | 1,969 rejected overall, **15 false negatives**           |
| Full OOS passers          | 82                                                       |
| Combined funnel           | 1,016 full evaluations (66.13% saved), **81.71% recall** |

All 15 probe false negatives were `squeeze_breakout`: the strategy can have no trade in fold 0 and still pass in later folds. Therefore the probe is **disabled by default** (`AI_SEARCH_PROBE_FOLDS=0`) until fold selection is improved. The signal screen is safe and stays on. The budget sample is unbiased and controlled, so it does not need the probe.

Timings on the local 4-core machine: signal screen 2.4 s, one-fold probe 221 s, full eight folds 1,120 s. The probe is cheap per variant but its recall cost is currently too high; the signal screen plus an 8k budget is the safe default for 10k–50k searches.

## Native fast backtest 2026-11-22

CPU profile of 100 slow variants: **85–90% Decimal.js**, indicators ~3%, Zod ~0.3%. A native-number search path for all 11 strategies now runs indicators and decisions in native numbers, while cash/position/fills stay in Decimal. Boundary comparisons are flagged at `1e-11` relative and only that fold is re-run on the Decimal engine.

- Parity across all 11 strategies: **132/132** focused and **990/990** extended, exact.
- Production path (fast plus ambiguous-fold fallback): **300/300** screened variants matched Decimal exactly.
- Raw native path: **25x** faster (467 → 19 ms/variant).
- End-to-end with ambiguous-fold fallback (300 screened variants): **7.8x** faster (572 → 73 ms/variant).
- Expected 5,000-variant AKEDO search: ~15 minutes → ~2 minutes.
- The funnel budget is disabled by default (`AI_SEARCH_FULL_BUDGET=0`); with the native path, 10k–100k searches evaluate every signal-screen survivor and lose no candidates.
- `AI_SEARCH_FAST_ENGINE=0` is the rollback; set `AI_SEARCH_FULL_BUDGET=8000` when running the slower Decimal path.

No threshold, holdout or candidate-set changes. Bots and holdout remain on the Decimal engine.

## 20k fast-engine pilot 2026-11-22

The native search engine (ADR 0077) was run on 20,000 proposals over the synthetic 180-day 1h fixture with 4 workers:

| Stage            | Result                                             |
| ---------------- | -------------------------------------------------- |
| Generated        | 20,000                                             |
| Signal screen    | 11,078 survivors; 8,922 rejected (44.6%) in 13.4 s |
| Full eight folds | 11,078 evaluated in 503 s                          |
| OOS passers      | 687                                                |
| Holdout tested   | 10                                                 |
| Recommendations  | 10 (synthetic fixture; not a production claim)     |
| Total            | 517 s; 45 ms/variant wall                          |

## 50k fast-engine pilot 2026-11-22

The same fixture and native engine with the production-style survivor shuffle before worker chunking, 4 workers:

| Stage            | Result                                              |
| ---------------- | --------------------------------------------------- |
| Generated        | 50,000                                              |
| Signal screen    | 27,716 survivors; 22,284 rejected (44.6%) in 32.0 s |
| Full eight folds | 27,716 evaluated in 641 s                           |
| OOS passers      | 1,597                                               |
| Holdout tested   | 10                                                  |
| Recommendations  | 10 (synthetic fixture; not a production claim)      |
| Total            | 674 s; 23 ms/variant wall                           |

The earlier 20k run without the shuffle was 45 ms/variant; shuffling survivors before chunking nearly halved the wall time, confirming the worker-balance fix. Production 6 workers ≈ 7.5 min for 50k; 100k ≈ 15 min, well inside the 90-minute cycle. Every signal-screen survivor is evaluated (budget disabled).

## H5 next-open execution 2026-11-22

The AI search and final holdout now fill at the next candle open instead of the signal candle close, removing the same-close look-ahead confirmed by audit H5. Protective stops/take-profits remain intrabar; pending orders fill at the next open before the candle's protective checks; the last-candle decision is ignored and the end-of-period force-close stays. Bot backtests keep the legacy same-close default until a separate rebase.

- Focused engine tests cover a gapped next-open fill and a last-candle signal that must be ignored.
- Extended parity: **330/330** variants exact between the native and Decimal engines in next-open mode.
- `AI_SEARCH_EXECUTION=same-close` / request `execution: "same-close"` is the rollback.
