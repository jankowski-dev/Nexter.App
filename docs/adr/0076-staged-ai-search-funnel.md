# ADR 0076 — Staged AI search funnel with control samples

Status: accepted, 2026-11-22.

## Context

The signal-only screen removes ~44% of proposals before any backtest (5,000-variant pilot: 2.9 s, 2,186 rejected). The remaining variants still run all eight walk-forward folds. At 10k–50k proposals the full evaluation dominates wall time, and the API/cycle limits make a flat search impractical.

A naive one-fold probe was measured against the full eight-fold ground truth on 3,000 variants:

- the signal screen had **0 false negatives** among 82 OOS passers;
- a one-fold probe with at least one trade lost **15 of 82 OOS passers (18.3%)**, all `squeeze_breakout`, because that strategy can trade only in later folds;
- the combined funnel evaluated 1,016 of 3,000 variants (66% saving) at 81.7% estimated recall.

The probe is therefore not safe as a default hard gate. The product explicitly forbids manufacturing recommendations by loosening thresholds, and the independent audit asked for false-negative control rather than silent pruning.

## Decision

Run the search as a staged funnel and report every stage:

1. **Screen** — the existing safe checks plus the signal-count upper bound. Invalid parameters and too few entry signals cannot become recommendations.
2. **Probe** — optional one-fold (or N-fold) trade probe, controlled by `AI_SEARCH_PROBE_FOLDS`. It is **disabled by default** because the measured recall was 81.7%; it remains available for experiments and future fold-selection work.
3. **Budget** — when survivors exceed `AI_SEARCH_FULL_BUDGET` (default 0, disabled after the native engine; historically 8,000), take a deterministic uniform sample. If the probe is enabled, rank by probe score and keep a 2% random exploration slice instead. This bounds full evaluation time without using the holdout.
4. **Full** — the existing eight-fold OOS evaluation and filters.
5. **Control** — a deterministic sample of each rejected stage (signal screen, probe, budget) is fully evaluated. Control passers are counted and shown but are never promoted to candidates or recommendations. The report estimates missed passers and recall.
6. **Holdout** — unchanged top-10 untouched 30-day holdout.

No threshold, fold count, holdout policy or policy score changes. Screening never reads the holdout. Stage counts, durations, rejection reasons and control results are stored in the search artifact and returned by the API; status exposes the active stage and its percent.

Variants are generated grouped by strategy, so they are deterministically shuffled before worker chunks are formed. A 5,000-variant composition model showed one contiguous chunk carrying the slow `bollinger_reversion`/`squeeze_breakout` strategies and costing ~485 s while the average chunk cost was ~231 s; unscreened, the slowest chunk was ~876 s. The shuffle balances fast and slow strategies across workers without changing the evaluated set.

The request limit rises from 5,000 to 100,000 proposals, matching the generator cap. The UI offers 10k/20k/50k.

## Consequences

- Positive: 10k–50k searches become bounded by `AI_SEARCH_FULL_BUDGET` instead of the flat variant count; 5k searches keep their previous result set with the signal screen saving.
- Positive: the funnel is auditable: stage input/output, rejection counts, durations and control recall are visible in the API, JSON export and UI.
- Positive: control variants never influence recommendations; thresholds are untouched.
- Negative: the budget sample is a recall trade-off. With 28k survivors and an 8k budget the expected OOS recall is ~29%; the report states this instead of hiding it.
- Negative: probe control is only meaningful when the probe is enabled; the default report records zero probe rejects.
- Neutral: no schema change. `ai_jobs`, artifacts and summaries already store JSON payloads.
- Rollback: set `AI_SEARCH_PROBE_FOLDS=0`, `AI_SEARCH_FULL_BUDGET=0` and/or `AI_SEARCH_CONTROL_SAMPLE=0`, or set the variant count back to 5,000. No migration.

## Env

| Variable                   | Default | Meaning                                           |
| -------------------------- | ------- | ------------------------------------------------- |
| `AI_SEARCH_PROBE_FOLDS`    | `0`     | Probe folds; `0` disables the probe stage         |
| `AI_SEARCH_FULL_BUDGET`    | `8000`  | Max full evaluations; `0` disables the budget cap |
| `AI_SEARCH_CONTROL_SAMPLE` | `50`    | Control variants per rejected stage; `0` disables |
| `AI_SEARCH_WORKERS`        | `4`     | Worker-thread pool size (production `6`)          |

## Addendum 2026-11-22 — native engine

With the native search backtest (ADR 0077), full evaluation is ~7.8x faster end-to-end. The budget cap is therefore **disabled by default** (`AI_SEARCH_FULL_BUDGET=0`), so 10k–100k searches evaluate every signal-screen survivor and lose no candidates. The budget remains available as an explicit opt-in for the slower Decimal path (`AI_SEARCH_FAST_ENGINE=0`).
