# AI Search / Recommendation Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the autonomous pipeline with an asynchronous mass-search engine that produces transparent short-swing recommendations; the owner creates and starts paper bots manually.

**Architecture:** Data Service supplies 1h/4h/1d candles. `AiSearchService` generates up to 5,000 validated parameter variants, runs purged walk-forward on 150 days (60 train / 2 purge / 10 OOS, 9 folds) plus a 30-day holdout, aggregates statistics, and stores a search artifact plus top candidates. A recommendation is a candidate with TTL/invalidation metadata. The owner accepts it into a prefilled draft bot; nothing auto-starts.

**Tech Stack:** NestJS, Drizzle/Postgres, Zod, Vitest, React/TanStack Query.

**Spec:** `docs/adr/0072-recommendation-only-short-swing.md`, `docs/plans/ai-trading-2026-11.md` v0.2.

## Global Constraints

- Up to 5,000 variants per search; up to 20 searches/day.
- Purged walk-forward: 60 train / 2 purge / 10 OOS, 9 folds on 150 days; final 30-day holdout untouched.
- Short swing 1–10 days; 1h primary, 4h confirmation, 1d regime, 15m optional; no 5m MVP.
- Recommendation-only; no automatic bot create/start/stop.
- All money values decimal strings / Postgres numeric.
- No schema migration for the first search version; reuse `ai_pipeline_runs`, `ai_artifacts`, `ai_candidates`.
- No keys, seed phrases or real orders.

## Review Focus

- Search never uses the final holdout for parameter selection.
- A variant that wins in-sample but fails OOS/holdout is not recommended.
- A 5,000-variant search is asynchronous, cancellable and does not block the API.
- Progress/stats survive a page refresh.
- Data coverage below 180 days is reported, not silently padded.
- Recommendation acceptance creates a draft, never a running bot.

---

### Task 1: 1h/4h data coverage

**Files:** `apps/api/src/modules/market-data/*`, `apps/api/src/modules/ai-trading/ai-data.service.ts`, tests.

- [ ] Add GeckoTerminal OHLCV pagination (`before_timestamp`) for 1h up to 180 days; keep 1000-candle page cap and rate limit.
- [ ] Extend AI data refresh coverage limits for 1h to 180 days (4h to 180, 1d to 365), preserving source/quality.
- [ ] Report insufficient coverage per token/timeframe; do not fabricate candles.
- [ ] Tests: pagination parse, dedupe, coverage status.

### Task 2: Search core

**Files:** `apps/api/src/modules/ai-trading/ai-search.service.ts` (new), `ai-search.types.ts`, tests.

- [ ] Generate validated parameter grids from `strategyDefinitions` excluding `aiEligible:false`; deterministic seed; cap 5,000; skip invalid combinations.
- [ ] Build folds: 150 search days, 60 train / 2 purge / 10 OOS, step 10; final 30-day holdout.
- [ ] Run each variant on every OOS slice; aggregate mean/median/worst OOS, drawdown, trades, fold stability, holdout.
- [ ] Filter: minimum trades, positive median OOS, worst fold threshold, max DD, positive holdout.
- [ ] Produce stats: counts, best/avg/median/worst, histograms, top-N, rejection reasons.
- [ ] Tests: fold boundaries, holdout isolation, deterministic grid, filtering, aggregate stats.

### Task 3: Persistence, jobs and API

**Files:** `ai-search.controller.ts`, `ai-trading.controller.ts`, contracts, `apps/api/test/ai-search.e2e.spec.ts`.

- [ ] `POST /api/v1/ai-trading/search` creates `ai_pipeline_runs` + `ai_jobs` and starts a background runner; return `202 { runId }`.
- [ ] Progress updates every N variants; statuses `queued/running/succeeded/failed/cancelled`.
- [ ] `GET /search/:runId` returns progress/ETA/summary.
- [ ] `GET /search/:runId/results` returns statistics, top-N and rejection summary.
- [ ] `POST /search/:runId/cancel` cancels cooperatively.
- [ ] Store search payload in `ai_artifacts` (`type='search'`), top candidates in `ai_candidates`.
- [ ] E2E: small 10-variant search, status/results shape, cancellation, auth.

### Task 4: Search UI

**Files:** `apps/web/src/features/ai-trading/*`, API client/contracts.

- [ ] `ИИ-торговля → Поиск`: token/timeframe/horizon/variants form.
- [ ] Running state: progress bar, evaluated/total, ETA, cancel.
- [ ] Results: funnel, best/avg/median/worst, histograms, top-N table, rejection reasons, export JSON.
- [ ] Empty/error/insufficient-data states; link to `Данные`.
- [ ] Tests: formatting/status mapping; web build.

### Task 5: Recommendation → draft bot

**Files:** recommendations API/UI, `trading_bots.service.ts`, contracts.

- [ ] List recommendation cards with TTL, OOS, stability, holdout, suggested allocation.
- [ ] Accept opens a prefilled draft bot; no auto-start; persist candidate/bot link.
- [ ] Reject/expire statuses.
- [ ] Bot card shows linked recommendation and expected horizon.
- [ ] E2E: accept creates `draft` bot with `ai_candidate_id`; start remains manual.

### Task 6: Invalidation monitor (follow-up)

- [ ] Monitor linked AI bots against stop/take, DD, daily loss, stale data, TTL, regime.
- [ ] Emit review/stop recommendations + notifications + audit; never auto-stop.
- [ ] UI health block and reasons.

## Verification

- `pnpm format`, `pnpm typecheck`, `pnpm lint`.
- API unit/e2e, web tests, build.
- Migration none for Task 1–4; Task 5 may need additive link fields only.
- Before production search release: encrypted backup, restore check, `/health`/`/ready`, search smoke on a small variant budget.
