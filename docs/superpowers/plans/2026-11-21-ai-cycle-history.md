# AI Cycle History and Reporter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the owner a read-only history of AI research cycles so past failures and zero-recommendation runs can be inspected without reading the database.

**Architecture:** Reuse `ai_pipeline_runs` rows whose `summary.kind` is `cycle`. Add one owner-only `GET /ai-trading/cycles` endpoint that maps the last N rows (with asset symbols) to a compact contract, and one `История` drawer on the AI page that selects a row into the existing cycle card. No migration, no writes, no bot actions.

**Tech Stack:** NestJS, Drizzle/Postgres, Zod, React/TanStack Query, Vitest, supertest e2e.

**Spec:** `docs/plans/ai-trading-2026-11.md` (Phase 6 — invalidation monitor, reports, monitoring) and `docs/superpowers/specs/2026-11-21-ai-workspace-cycle-design.md` (open item: Reporter reports / cycle history).

## Global Constraints

- Read-only: the history endpoint must not update runs, jobs, candidates or bots.
- Owner-only: rows are filtered by the authenticated owner's `profileId`.
- No new database table or migration.
- UI copy is Russian; the history drawer must not block the page.
- Selecting a historical cycle only changes the viewed `cycleId`; it never starts or stops anything.
- Limit is clamped to 1–50 with a default of 20.

## Review Focus

- A cycle from another profile must never appear (filter by the owner's profile).
- Old rows with missing `steps`, `searchRunId`, `recommended` or `draftsCreated` must still render with safe defaults.
- `limit=0`, `limit=51` and a non-numeric limit must be rejected, not silently clamped.
- Selecting a history row must not start a cycle or mutate the run.
- The history query must load only when the drawer is open and must not block the main page.

---

### Task 1: History contracts and API client

**Files:**

- Modify: `packages/contracts/src/ai-trading.ts`
- Modify: `apps/web/src/lib/api.ts`
- Test: `apps/web/src/features/ai-trading/ai-cycle.test.ts`

**Interfaces:**

- Produces: `aiCycleSummarySchema`, `aiCyclesQuerySchema`, `aiCyclesResponseSchema`, types `AiCycleSummary`, `AiCyclesQuery`, `AiCyclesResponse`; `fetchAiCycles(): Promise<AiCyclesResponse>`.
- Consumes: `aiCycleStepSchema`, `aiCycleStatusSchema` from the existing contracts.

- [ ] **Step 1: Write the failing contract test**

Add a test that parses `{ data: [<one cycle summary>] }` with `cycleId`, `assetId`, `symbol`, `timeframe`, four steps, `searchRunId`, `recommended`, `draftsCreated`, `error`, `createdAt`, `finishedAt`. Add assertions that `aiCyclesQuerySchema.parse({}).limit === 20`, that `{ limit: '5' }` coerces to `5`, and that `{ limit: 0 }` and `{ limit: 51 }` throw.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx pnpm@10.20.0 --filter @nexter/web exec vitest run src/features/ai-trading/ai-cycle.test.ts`
Expected: FAIL because the schemas do not exist.

- [ ] **Step 3: Add the schemas and client**

Define `aiCycleSummarySchema` with `cycleId`, `status`, `assetId`, `symbol`, `timeframe`, `steps`, `searchRunId`, `recommended`, `draftsCreated`, `error`, `createdAt`, `finishedAt`; define `aiCyclesQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) })`; define `aiCyclesResponseSchema = z.object({ data: z.array(aiCycleSummarySchema) })`. Add `fetchAiCycles` with a 20s abort signal.

- [ ] **Step 4: Run the contract test and typecheck**

Run: `npx pnpm@10.20.0 --filter @nexter/web exec vitest run src/features/ai-trading/ai-cycle.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/ai-trading.ts apps/web/src/lib/api.ts apps/web/src/features/ai-trading/ai-cycle.test.ts
git commit -m "feat: add AI cycle history contracts"
```

### Task 2: Owner-scoped history endpoint

**Files:**

- Modify: `apps/api/src/modules/ai-trading/ai-cycle.service.ts`
- Modify: `apps/api/src/modules/ai-trading/ai-trading.controller.ts`
- Test: `apps/api/test/ai-trading.e2e.spec.ts`

**Interfaces:**

- Produces: `AiCycleService.list(userId: string, limit?: number): Promise<AiCyclesResponse>` and `GET /api/v1/ai-trading/cycles`.
- Consumes: `AiTradingService.getProfile`, `aiPipelineRuns`, `assets`.

- [ ] **Step 1: Write the failing e2e assertion**

After the cycle in `ai-trading.e2e.spec.ts` reaches `succeeded`, call `GET /api/v1/ai-trading/cycles` and assert the returned row with `cycleId` has `status='succeeded'`, `symbol='BASED'`, `recommended=0`, `draftsCreated=0`, and the four step keys in order.

- [ ] **Step 2: Run it to verify it fails**

Run the AI e2e with the disposable Postgres command used by CI.
Expected: 404 because the route does not exist.

- [ ] **Step 3: Implement `list`**

Resolve the profile, select the last `limit` rows where `profile_id = profile.id` and `summary->>'kind' = 'cycle'`, ordered by `created_at desc`. Resolve symbols for unique `summary.assetId` values from `assets`. Map each row with defaults (`steps: []`, `searchRunId: null`, `recommended: 0`, `draftsCreated: 0`, `error: null`) and skip rows without a usable `assetId`/`timeframe`.

- [ ] **Step 4: Add the controller route**

Add `@Get('cycles')` with `@Query(new ZodValidationPipe(aiCyclesQuerySchema)) query: AiCyclesQuery` and return `this.aiCycle.list(auth.user.id, query.limit)`.

- [ ] **Step 5: Run API tests and typecheck**

Run: `npx pnpm@10.20.0 --filter @nexter/api exec vitest run test/ai-trading.e2e.spec.ts`, `npx pnpm@10.20.0 typecheck`, `npx pnpm@10.20.0 lint`.
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/ai-trading/ai-cycle.service.ts apps/api/src/modules/ai-trading/ai-trading.controller.ts apps/api/test/ai-trading.e2e.spec.ts
git commit -m "feat: expose AI cycle history"
```

### Task 3: History drawer and cycle selection

**Files:**

- Modify: `apps/web/src/features/ai-trading/ai-trading-page.tsx`

- [ ] **Step 1: Add the drawer state and button**

Extend the `drawer` union with `'history'`. Add an `История` ghost button to the page header.

- [ ] **Step 2: Add `AiCycleHistory`**

Add a component that calls `fetchAiCycles` only when the drawer is open (`enabled`), uses `retry: 1`, renders `LoadingRows`, an inline `ErrorState` with `Повторить`, an empty state, and rows with status badge, symbol/timeframe, date, recommendations/drafts, step count and a sanitized error. Clicking a row calls `onSelect(cycleId)`.

- [ ] **Step 3: Wire selection and reset**

Persist the selected `cycleId` in sessionStorage, close the drawer, and let `AiCycleCard` clear a terminal cycle (`Сбросить`) by removing the stored id. Add a `cycleStatusTone` helper used by both the card and history rows.

- [ ] **Step 4: Run web checks**

Run: `npx pnpm@10.20.0 --filter @nexter/web test`, `npx pnpm@10.20.0 typecheck`, `npx pnpm@10.20.0 lint`, `npx pnpm@10.20.0 build`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/ai-trading/ai-trading-page.tsx
git commit -m "feat: add AI cycle history drawer"
```

### Task 4: Verification and release

- [ ] Run the full suite: `npx pnpm@10.20.0 test`, `typecheck`, `lint`, `build`.
- [ ] Manually verify the history drawer opens, lists the previous failed cycles, selects one, and shows the sanitized steps.
- [ ] Update `AGENTS.md`, `docs/decisions.md` and `docs/project/api.md`.
- [ ] Open a PR, wait for CI, merge, deploy, verify `/health`, `/ready` and the bundle.

## Rollout

1. Contracts + client.
2. Backend endpoint.
3. Drawer.
4. Deploy with `/health`/`/ready` checks; no migration.
