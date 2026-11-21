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

| Stage | What runs | Typical survivors | Cost |
|---|---|---:|---|
| 0 | Validation, priors, dedupe | 300,000–500,000 | seconds |
| 1 | Signal-count screen on 1 fold | 30,000–50,000 | minutes |
| 2 | Coarse backtest on 2 folds | 5,000–10,000 | tens of minutes? benchmark |
| 3 | Full 8 folds / 5 folds on reduced history | 2,000–5,000 | ~5–20 minutes with worker pool |
| 4 | Holdout top-10 | 10 | negligible |
| 5 | Local refinement around top neighborhoods | 5,000–20,000 new variants | 5–20 minutes |

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
