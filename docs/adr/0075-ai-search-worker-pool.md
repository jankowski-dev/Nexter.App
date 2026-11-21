# ADR 0075 — Worker-thread pool for AI mass search

Status: accepted, 2026-11-21.

## Context

A 5,000-variant search evaluates 8 walk-forward folds per variant, i.e. 40,000 fold-backtests. The implementation ran them sequentially in the Nest API process. Production timing was 17–40 minutes; Railway metrics showed ~1.1 vCPU peak against an 8 vCPU limit. Event-loop yielding kept the API responsive but did not use the available CPU.

## Decision

Evaluate variants in a bounded pool of Node `worker_threads`:

- `evaluateVariantFolds` is a pure module shared by the API and workers. It runs the same fold backtests and returns aggregate metrics.
- `AiSearchService` splits variants into balanced contiguous chunks, sends each chunk plus the shared folds to a worker, aggregates progress and results, and applies the existing filters, near-miss logic and top-10 holdout in the main thread.
- The pool size comes from `AI_SEARCH_WORKERS` (default 4, max 8, capped by `availableParallelism() - 1`). Production uses 6.
- Cancellation terminates every worker and marks the run `cancelled`. A worker error fails the search; it never hangs.
- Tests, development and a missing compiled worker fall back to the existing sequential path.

## Consequences

- Positive: wall time should scale with available cores; the API event loop stays free; progress and cancellation semantics are unchanged.
- Positive: no schema change; no new service; `AI_SEARCH_WORKERS=1` is an instant rollback to sequential.
- Negative: CPU usage during a search rises (expected and billed per vCPU-minute); workers add memory (~tens of MB each).
- Negative: local 4-core AMD A10 benchmark showed only 1.6x (47.8s → 29.3s for 100 variants) because its FP units are shared; production 8 vCPU should scale better.
- Search results must remain identical; the shared evaluator and existing tests enforce parity.
- A durable external worker remains a later option for multi-token/8×5,000 runs; this pool is scoped to one search run.

## Rollback

Set `AI_SEARCH_WORKERS=1` (no deploy) or redeploy the previous commit. No data migration.
