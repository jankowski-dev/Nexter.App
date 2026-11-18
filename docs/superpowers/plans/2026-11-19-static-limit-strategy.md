# Static Limit Strategy Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a manual absolute-price limit/stop/take paper-bot strategy with single-token validation and A2 auto re-arm.

**Architecture:** New `static_limit` strategy in the existing registry, a `aiEligible` marker, bot-service validation, UI icon/error mapping, and tests.

**Tech Stack:** TypeScript, Zod, decimal.js, Vitest, NestJS e2e.

**Spec:** `docs/superpowers/specs/2026-11-19-static-limit-strategy-design.md`

## Global Constraints

- Paper only; no real orders, wallets or keys.
- One token per static-limit bot.
- Absolute USD prices; validation stop < buy < take.
- No schema migration.
- AI lab excludes the strategy.

## Review Focus

- A stop-out below buy must not immediately re-buy; require recovery above buy first.
- Unconfigured zeros must hold and be rejected on bot save.
- Updating a static bot to two tokens must fail.
- Registry/AI prompt must not offer this strategy to the Analyst.

---

### Task 1: Strategy and tests

**Files:** `strategies/index.ts`, `strategies.spec.ts`, `types.ts`, `packages/contracts/src/trading-bots.ts`

- [ ] Add failing tests for entry, stop/take, waiting recovery, re-arm and unconfigured params.
- [ ] Add `static_limit` to `botStrategyKeys`; add `aiEligible?: boolean` to `StrategyDefinition`.
- [ ] Implement the strategy and registry entry; update the 12-template registry test.
- [ ] Run the strategy spec.

### Task 2: AI exclusion and bot validation

**Files:** `ai-lab.service.ts`, `trading-bots.service.ts`, web `error-messages.ts`

- [ ] Filter `aiEligible === false` from the AI catalog and candidate validation.
- [ ] Reject create/update when the effective strategy is `static_limit` and token count is not 1, or prices are not a valid positive triple.
- [ ] Add error codes/messages.
- [ ] Add an e2e test for 2-token rejection, 1-token success and update rejection.

### Task 3: UI and verification

**Files:** `strategy-icon.tsx`, docs

- [ ] Add the `limit` icon visual.
- [ ] Update the strategy table.
- [ ] Run format, typecheck, lint, API/web tests, build.
