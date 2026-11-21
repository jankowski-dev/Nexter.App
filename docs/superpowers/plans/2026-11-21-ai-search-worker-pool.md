# AI Search Worker Pool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the 5,000-variant search wall time by evaluating variants in a pool of Node worker threads while keeping the existing search API, progress and cancellation behavior.

**Architecture:** Extract the expensive per-variant fold evaluation into a pure module. The API process distributes variant slices to `worker_threads`; each worker runs the same pure evaluator. The main thread aggregates results, applies filters, runs the top-10 holdout and writes progress. Tests and environments without a compiled worker fall back to the existing sequential path.

**Tech Stack:** NestJS, Node `worker_threads`/`os`, TypeScript, Vitest.

**Spec:** `docs/plans/ai-trading-2026-11.md` §8 (5,000 variants, 8 folds) and §12 Phase 8 hardening; performance evidence from the 2026-11-21 LINK run (17–40 min, single-threaded).

## Global Constraints

- No change to search results: same variants, folds, filters, holdout and ordering semantics.
- No new database table or migration.
- The API must stay responsive and progress must keep updating during a run.
- Cancellation must stop all worker threads.
- Tests must not depend on worker compilation; production uses workers when the compiled worker file exists.
- Worker count is bounded (default 4, max 8) and can be overridden with `AI_SEARCH_WORKERS`.

## Review Focus

- Worker results must be identical to the sequential path, including unknown strategies and backtest failures.
- One worker crash must fail the search, not hang it.
- Cancellation must terminate all workers and mark the run cancelled, not succeeded.
- Progress must not regress or exceed total.
- The fallback path must keep tests and dev working when the worker JS is absent.

---

### Task 1: Pure variant evaluator and pool helpers

**Files:**

- Create: `apps/api/src/modules/ai-trading/ai-search.evaluate.ts`
- Modify: `apps/api/src/modules/ai-trading/ai-search.helpers.ts`
- Test: `apps/api/src/modules/ai-trading/ai-search.evaluate.spec.ts`

- [ ] **Step 1: Write failing tests**

Test `evaluateVariantFolds` for a valid momentum variant (returns aggregate with 8 folds), an unknown strategy (flag), a backtest failure (aggregate null), and `splitVariants([...], 3)` preserving every item exactly once with balanced chunks. Test `searchWorkerCount` clamps `AI_SEARCH_WORKERS` and CPU count.

- [ ] **Step 2: Run tests to verify failure**

Run: `npx pnpm@10.20.0 --filter @nexter/api exec vitest run src/modules/ai-trading/ai-search.evaluate.spec.ts`

- [ ] **Step 3: Implement the evaluator and helpers**

Move the per-variant fold loop from `AiSearchService.execute` into `evaluateVariantFolds(variant, folds, timeframe)`. It returns `{ unknownStrategy }`, `{ aggregate: null }` or `{ aggregate }`. Add `splitVariants` and `searchWorkerCount` to `ai-search.helpers.ts`.

- [ ] **Step 4: Run tests**

Expected: PASS.

- [ ] **Step 5: Commit**

### Task 2: Worker entry and pool runner

**Files:**

- Create: `apps/api/src/modules/ai-trading/ai-search.worker.ts`
- Create: `apps/api/src/modules/ai-trading/ai-search.pool.ts`
- Modify: `apps/api/src/modules/ai-trading/ai-search.service.ts`
- Test: `apps/api/src/modules/ai-trading/ai-search.pool.spec.ts`

- [ ] **Step 1: Write failing pool tests**

Test `runWorkerPool` with a fake worker factory: distributes slices, aggregates results, forwards progress, rejects on worker error and returns cancelled when the control flag flips. Test `shouldUseWorkers` returns false in test/env without a compiled worker and true otherwise.

- [ ] **Step 2: Implement worker entry**

`ai-search.worker.ts` listens for `{variants, folds, timeframe}`, calls `evaluateVariantFolds`, posts `{type:'progress', evaluated}` every 25 variants and `{type:'done', results}`. It handles no `parentPort` by exiting.

- [ ] **Step 3: Implement pool runner**

`ai-search.pool.ts` spawns `new Worker(path.join(__dirname, 'ai-search.worker.js'))`, sends slices, forwards progress, terminates on cancellation or error, and returns flattened results. `shouldUseWorkers` checks `NODE_ENV !== 'test'`, `AI_SEARCH_WORKERS > 1` and `existsSync(workerPath)`.

- [ ] **Step 4: Use the pool in `execute`**

Replace the sequential variant loop with `runWorkerPool` when enabled, then apply the existing filters/near-miss logic to each returned aggregate. Keep the sequential loop for fallback. Preserve progress writes every 50 evaluated and cancellation.

- [ ] **Step 5: Run unit tests/typecheck/lint**

- [ ] **Step 6: Commit**

### Task 3: Build, benchmark and release

- [ ] Run `pnpm build`; verify `apps/api/dist/modules/ai-trading/ai-search.worker.js` exists.
- [ ] Run a local worker benchmark on synthetic 4,320 hourly candles; compare sequential vs 4-worker wall time.
- [ ] Run full tests, typecheck, lint, build.
- [ ] Open a PR, wait for CI, merge, deploy; run a production cycle and compare wall time.
- [ ] Add ADR 0075 and update `AGENTS.md`/`docs/decisions.md`.

## Rollout

1. Pure evaluator + tests.
2. Worker pool with sequential fallback.
3. Build/benchmark/deploy; env `AI_SEARCH_WORKERS=4` initially, tune to 6 if CPU headroom is confirmed.
