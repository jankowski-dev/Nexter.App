# AI Holdout Settlement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each 10-day AI holdout cycle its own 5-day settlement (3×15 = 45 days), require 2 positive + 2 active cycle blocks, and keep the last cycle non-negative.

**Architecture:** `buildSearchFolds` returns a 45-day holdout made of three 15-day cycles (10 test + 5 settlement). `runBacktest` receives settlement ranges, suppresses new entries in each settlement, force-closes at each cycle end, and returns exposure points. `holdoutBlockStats` splits the 45-day equity curve into three equal 15-day blocks and counts positive/non-negative/active blocks. The search service stores the new fields and gates recommendations; contracts/UI expose them.

**Tech Stack:** TypeScript, NestJS, Drizzle (no migration), Zod contracts, React/Vite, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-23-ai-holdout-settlement-design.md`

## Global Constraints

- Settlement is exactly 5 days per cycle.
- Holdout is 45 days = 3 cycles × (10 test + 5 settlement); search history remains 180 days.
- No new entries during settlement; exits/stops/takes/trailing remain active.
- Recommendation gate: overall holdout > 0, DD <= 20%, positive blocks >= 2, active blocks >= 2, last block >= 0.
- OOS thresholds unchanged: 8 trades across folds (scaled), 5/8 positive folds, 20% max DD, -15% worst fold.
- No holdout-based ranking; no migration; Russian UI; Decimal money.

## Review Focus

- A buy signal after the holdout end must not open a position in settlement; a sell/stop must still work.
- A position held through a block with no fills must count as active via exposure, not via trade count.
- Uneven block sizes (10/10/10+5) must align with the equity curve and exposure arrays.
- Old runs without settlement/positive/active fields must parse and render.
- A 140–146 day history must still produce a valid fold set and settlement.

---

### Task 1: Settlement cycles in folds and backtest engine

**Files:**

- Modify: `apps/api/src/modules/ai-trading/ai-search.helpers.ts`
- Modify: `apps/api/src/modules/trading-bots/backtest/backtest.engine.ts`
- Test: `apps/api/src/modules/ai-trading/ai-search.helpers.spec.ts`
- Test: `apps/api/src/modules/trading-bots/backtest/backtest.engine.spec.ts`

**Interfaces:**

- Produces: `HOLD_OUT_DAYS = 45`, `HOLD_OUT_CYCLES = 3`, `SETTLEMENT_DAYS = 5`; `SearchFoldSet.holdout` (45 days), `settlementRanges` (relative), `settlementDays`, `holdoutCycles`; `BacktestOptions.settlementRanges`; `BacktestResult.exposure`.

- [ ] Write failing fold tests: 180 days -> holdout 1080 (45 days), settlement ranges [10d,15d)/[25d,30d)/[40d,45d), 7 folds; 146 days -> 3 folds.
- [ ] Run helper tests, watch fail.
- [ ] Implement `HOLD_OUT_DAYS = 45`, `HOLD_OUT_CYCLES = 3`, `SETTLEMENT_DAYS = 5`, `searchEnd = (totalDays - HOLD_OUT_DAYS) * perDay`, `holdout = use.slice(searchEnd, total)`, `settlementRanges` relative to holdout; keep `holdoutWarmup` before holdout.
- [ ] Run helper tests, watch pass.
- [ ] Write failing engine tests: exposure length matches equity curve; a buy decision inside a settlement range is ignored while a sell/stop still executes; force-close happens at each settlement end; a held position has `inPosition=true` in its block.
- [ ] Run engine tests, watch fail.
- [ ] Implement `settlementRanges` (same-close: suppress buys when index is inside a range; next-open: suppress when index+1 is inside), force-close at each range end, and `exposure` push in `pushEquity`.
- [ ] Run engine tests and full helper suite, watch pass.
- [ ] Commit.

### Task 2: Block metrics and gate

**Files:**

- Modify: `apps/api/src/modules/ai-trading/ai-search.helpers.ts`
- Test: `apps/api/src/modules/ai-trading/ai-search.helpers.spec.ts`

**Interfaces:**

- Produces: `HoldoutBlockStats { returnsPct, positive, nonNegative, traded, total, lastNegative }`; `holdoutBlockStats(equityCurve, blocks?, options?: { blockSizes?: number[]; exposure?: boolean[] })`; `holdoutRejection(..., blocks)` with `holdout blocks unstable`, `holdout too few active blocks`, `holdout recent block negative`.

- [ ] Write failing tests: 45-point curve split into 3×15 days; exposure marks traded blocks; positive count; 1 positive block -> unstable; 1 active block -> too few active; last negative -> recent negative.
- [ ] Run tests, watch fail.
- [ ] Implement equal 3-block split (remainder to last block), exposure count, positive/nonNegative/traded, gate order.
- [ ] Run tests, watch pass.
- [ ] Commit.

### Task 3: Search service, contracts, UI

**Files:**

- Modify: `apps/api/src/modules/ai-trading/ai-search.service.ts`
- Modify: `apps/api/src/modules/ai-trading/ai-cycle.service.ts`
- Modify: `apps/api/src/modules/ai-trading/ai-cycle.helpers.ts`
- Modify: `packages/contracts/src/ai-trading.ts`
- Modify: `apps/web/src/features/ai-trading/ai-trading-page.tsx`
- Modify: `apps/web/src/features/ai-trading/ai-holdout-format.ts`
- Test: `apps/web/src/features/ai-trading/ai-cycle.test.ts`
- Test: `apps/web/src/features/ai-trading/ai-holdout-format.test.ts`
- Test: `apps/api/test/ai-trading.e2e.spec.ts`

**Interfaces:**

- Consumes: settlement folds, exposure, block stats from Tasks 1–2.
- Produces: `settlementDays` and `holdoutCycles` on search results/cycle; `holdoutBlocksPositive`, `holdoutBlocksTraded` on near-miss/candidate; UI labels `3×15 (10+5)`, `positive/total`, `active/total`.

- [ ] Write failing contract tests for new fields and legacy defaults.
- [ ] Run web contract tests, watch fail.
- [ ] Add contracts: `settlementDays`, `holdoutBlocksPositive`, `holdoutBlocksTraded` with defaults.
- [ ] Run contract tests, watch pass.
- [ ] Integrate service: holdout candles 45 days, absolute settlement ranges, exposure, gate, fields, payload/results, cycle counts.
- [ ] Add e2e invariant: `holdoutTested = min(50, oosPassed)`, `settlementDays = 5`, `holdoutCycles = 3`, candidates/near-misses have block fields when present.
- [ ] Update UI formatter/tests: `holdoutConsistencyLabel(positive,total)`; add `holdoutActiveLabel`; show `3×15 (10+5)` and settlement/blocks.
- [ ] Update `ai-trading-page.tsx`: search stats/line, cycle line, near-miss/candidate badges, rejection labels (`holdout too few active blocks`), settlement hint.
- [ ] Run web typecheck/tests/build and API ai-trading tests.
- [ ] Commit.

### Task 4: ADR, decisions, guide, PDF

**Files:**

- Create: `docs/adr/0082-ai-holdout-settlement.md`
- Modify: `docs/decisions.md`
- Modify: `AGENTS.md` (post-deploy release note can follow)
- Modify: `docs/guides/ai-system-engineering-guide.md`
- Regenerate: `docs/guides/nexter-ai-system-engineering.pdf`
- Copy: `apps/web/public/docs/nexter-ai-system-engineering.pdf`
- Modify: `apps/web/src/features/settings/settings-page.tsx` (`?v=4`)

- [ ] Write ADR 0082: context, 3×15 cycles (10 test + 5 settlement), positive/active gate, why not 10 days, old runs immutable, rollback.
- [ ] Add decisions bullet.
- [ ] Update guide version 1.3, section 9/12/13/21 (45-day holdout, 3×15 cycles); rebuild PDF; bump settings link to `?v=4`.
- [ ] Commit.

### Task 5: Verification and retest

- [ ] Run full `npx pnpm@10.20.0 test`, typecheck, lint, build.
- [ ] Push PR; wait for CI; merge/deploy; verify `/health`, `/ready`, bundle, PDF.
- [ ] Ask the owner to re-run the 3 × 200k searches on QUICK, AI, BASED with the unchanged 12 strategies.
- [ ] Analyze the new JSONs: 45-day holdout effect, positive/active cycle blocks, recommendations; no adaptive strategy yet.
- [ ] Add `AGENTS.md` release note with deployment ID/bundle in a docs-only PR.

## Rollback

Revert the PR; no migration. Old runs keep old fields. Search returns to 30-day holdout without settlement.
