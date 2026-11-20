# AI Workspace and One-Click Cycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the nine-tab AI page with one compact workspace and add a logged one-click research cycle that stops at draft bots; the owner starts bots manually.

**Architecture:** Frontend becomes a single page with drawers for Universe/Data/Settings. Backend adds `AiCycleService`, which runs data preflight, delegates to the existing async search, persists recommendations (already in `ai_candidates`), and creates draft bots through `TradingBotsService`. `ai_pipeline_runs` stores the cycle summary, `ai_jobs` stores one row per step, and audit writes step events.

**Tech Stack:** NestJS, Drizzle/Postgres, Zod, React/TanStack Query, Vitest, Playwright/e2e.

**Spec:** `docs/superpowers/specs/2026-11-21-ai-workspace-cycle-design.md`

## Global Constraints

- The cycle never starts, stops or reallocates a bot; only draft creation is automated.
- No new database table or migration in the first version; reuse `ai_pipeline_runs`, `ai_jobs`, `ai_artifacts`, `ai_candidates`.
- Stop the cycle at the first failed step and return the exact step/message.
- All money values remain decimal strings; no JS floats in API payloads.
- No keys, seed phrases, signing or real orders.
- Every cycle and step is audited.
- UI copy is Russian.
- Default cycle scope is one selected token/timeframe; no all-universe 8×5,000 run.
- Search remains the existing deterministic engine; DeepSeek is not in the critical search path.

## Review Focus

- A cycle must not block the API event loop while 5,000 × 8 backtests run; yield between variants.
- A second click while a cycle is running must not start a duplicate CPU-heavy run.
- A data source that cannot reach 180 days must fail at the data step with a clear reason, never create a bot.
- A token that is not an active default-group watchlist entry must fail the drafts step before creating a bot.
- Long notes/AI tasks must not exceed the existing AI timeout; the cycle does not depend on DeepSeek.

---

### Task 1: Cycle contracts and API client

**Files:**

- Modify: `packages/contracts/src/ai-trading.ts`
- Modify: `apps/web/src/lib/api.ts`
- Test: `apps/web/src/features/ai-trading/ai-cycle.test.ts` (new pure contract test)

**Interfaces:**

- Produces: `aiCycleRequestSchema`, `aiCycleStepSchema`, `aiCycleStatusSchema`, types `AiCycleRequest`, `AiCycleStep`, `AiCycleStatus`; `startAiCycle(body)`, `fetchAiCycle(id)`.

- [ ] **Step 1: Write the failing contract test**

Test parses `{ assetId, timeframe: '1h', horizonDays: 5, variants: 5000, maxDrafts: 3 }` and rejects `variants: 6000`, `maxDrafts: 11`, invalid timeframe.
Test parses a status with steps `data/search/recommendations/drafts` and rejects an unknown step key.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx pnpm@10.20.0 --filter @nexter/web exec vitest run src/features/ai-trading/ai-cycle.test.ts`
Expected: FAIL because the schemas do not exist.

- [ ] **Step 3: Add the schemas and client**

```ts
export const aiCycleStepKeys = ['data', 'search', 'recommendations', 'drafts'] as const;
export const aiCycleStepStatuses = ['queued', 'running', 'succeeded', 'failed', 'skipped'] as const;
export const aiCycleRequestSchema = z.object({
  assetId: z.uuid(),
  timeframe: z.enum(['1h', '4h']).default('1h'),
  horizonDays: z.union([z.literal(1), z.literal(3), z.literal(5), z.literal(10)]).default(5),
  variants: z.number().int().min(100).max(5000).default(5000),
  maxDrafts: z.number().int().min(0).max(10).default(3),
});
export const aiCycleStepSchema = z.object({
  key: z.enum(aiCycleStepKeys),
  status: z.enum(aiCycleStepStatuses),
  message: z.string().nullable(),
  error: z.string().nullable(),
  startedAt: z.iso.datetime().nullable(),
  finishedAt: z.iso.datetime().nullable(),
});
export const aiCycleStatusSchema = z.object({
  cycleId: z.uuid(),
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']),
  steps: z.array(aiCycleStepSchema),
  searchRunId: z.uuid().nullable(),
  recommended: z.number().int(),
  draftsCreated: z.number().int(),
  error: z.string().nullable(),
  createdAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
});
```

Add `startAiCycle` (`POST /api/v1/ai-trading/cycle`, 202) and `fetchAiCycle` (`GET /api/v1/ai-trading/cycle/:id`) in `api.ts`.

- [ ] **Step 4: Run contract test and typecheck**

Run: `npx pnpm@10.20.0 --filter @nexter/web exec vitest run src/features/ai-trading/ai-cycle.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/ai-trading.ts apps/web/src/lib/api.ts apps/web/src/features/ai-trading/ai-cycle.test.ts
git commit -m "feat: add AI cycle contracts"
```

### Task 2: Cycle service with step logging

**Files:**

- Create: `apps/api/src/modules/ai-trading/ai-cycle.service.ts`
- Modify: `apps/api/src/modules/ai-trading/ai-trading.module.ts`
- Modify: `apps/api/src/modules/trading-bots/trading-bots.module.ts`
- Test: `apps/api/test/ai-cycle.e2e.spec.ts` (new)

**Interfaces:**

- Consumes: `AiDataService.coverage`, `AiDataService.refresh`, `AiSearchService.start`, `AiSearchService.status`, `AiSearchService.results`, `TradingBotsService.createBot`.
- Produces: `AiCycleService.start(userId, input, meta): Promise<{ cycleId }>`, `status(userId, cycleId): Promise<AiCycleStatus>`.

- [ ] **Step 1: Write the failing e2e**

Setup like `ai-trading.e2e.spec.ts`: owner, watchlist BASED, 4,320 1h candles, AI token with `['1h']`.
`POST /api/v1/ai-trading/cycle` with `{ assetId, timeframe: '1h', horizonDays: 5, variants: 100, maxDrafts: 1 }` → 202.
Poll `GET /cycle/:id` until terminal. Assert:

- steps keys are exactly `data/search/recommendations/drafts`;
- `searchRunId` is a UUID;
- `status` is `succeeded`;
- `draftsCreated` is ≤ 1;
- if a draft was created it has `status='draft'`, `origin='ai'`, `aiCandidateId` set, and no `startedAt`.

- [ ] **Step 2: Run it to verify it fails**

Run with disposable Postgres: `NEXTER_TEST_DB=1 DATABASE_URL=... npx pnpm@10.20.0 --filter @nexter/api exec vitest run test/ai-cycle.e2e.spec.ts`
Expected: 404/route not found.

- [ ] **Step 3: Implement the service**

- Create an `ai_pipeline_runs` row with `trigger='manual'`, `status='running'`, `summary={kind:'cycle', assetId, timeframe, steps, searchRunId:null, recommended:0, draftsCreated:0}`.
- Create four `ai_jobs` rows with `service='ai_cycle'`, `stage=<key>`, `idempotencyKey='<cycleId>:<key>'`, status `queued`.
- `data`: check coverage from DB; if `status='ok'` skip refresh; otherwise call `refresh({assetId,timeframes:[timeframe],days:180})`, re-check coverage; fail with `AI_DATA_INSUFFICIENT` and the actual/required candle counts if still short.
- `search`: call `aiSearch.start(userId,{assetId,timeframe,horizonDays,variants},meta)`, store `searchRunId` in summary, poll `aiSearch.status` every 1000ms until terminal or 5 minutes; fail on `failed`/`cancelled`/timeout.
- `recommendations`: call `aiSearch.results`; count `recommended` candidates.
- `drafts`: if `maxDrafts > 0`, take the first `maxDrafts` recommended candidates and call `createBot` with `aiCandidateId`, `budgetUsd` = `max(100, profile.budgetUsd × maxWorkerAllocationPct / 100)`, one token, 5 positions, 20% size, 25/10 bps, 10% daily loss, 15 min cooldown; never call `startBot`.
- On each step update its `ai_jobs` row (`running` → `succeeded/failed`, payload/message/error) and the cycle summary; audit `ai_trading.cycle_started`, `ai_trading.cycle_step_succeeded|failed`, `ai_trading.cycle_completed|failed`.
- On failure stop and set cycle `failed`.

- [ ] **Step 4: Guard duplicate cycles and daily cap**

In `start`, reject with `AI_CYCLE_BUSY` if a `running` cycle exists for the profile; reject with `AI_SEARCH_LIMIT` if 20 cycle rows were created in the last 24h. Use `ai_pipeline_runs` summary, no schema.

- [ ] **Step 5: Run e2e and unit checks**

Run: `npx pnpm@10.20.0 typecheck`, `npx pnpm@10.20.0 lint`, cycle e2e.
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/ai-trading/ai-cycle.service.ts apps/api/src/modules/ai-trading/ai-trading.module.ts apps/api/src/modules/trading-bots/trading-bots.module.ts apps/api/test/ai-cycle.e2e.spec.ts
git commit -m "feat: add one-click AI cycle service"
```

### Task 3: Cycle controller and authorization

**Files:**

- Modify: `apps/api/src/modules/ai-trading/ai-trading.controller.ts`
- Test: `apps/api/test/ai-cycle.e2e.spec.ts`

- [ ] **Step 1: Add failing auth assertions**

Unauthenticated `POST /cycle` and `GET /cycle/:id` → 401; another owner → 404.

- [ ] **Step 2: Implement routes**

`@Post('cycle')` with `@HttpCode(202)`, Zod body, `@CurrentAuth`, request meta → `aiCycle.start`.
`@Get('cycle/:cycleId')` with `ParseUUIDPipe` → `aiCycle.status`.

- [ ] **Step 3: Run e2e and typecheck**

Expected: PASS.

- [ ] **Step 4: Commit**

### Task 4: One-page workspace shell

**Files:**

- Modify: `apps/web/src/features/ai-trading/ai-trading-page.tsx`
- Create: `apps/web/src/features/ai-trading/ai-workspace.tsx` (new layout)
- Create: `apps/web/src/features/ai-trading/ai-cycle-card.tsx` (new)
- Test: `apps/web/src/features/ai-trading/ai-workspace.test.ts` (pure helpers)

- [ ] **Step 1: Remove legacy page chrome**

Delete the four `StatCard`s and the `TabGroup`. Replace the page shell with:

- header: profile badge, model, last cycle, `Настройки`, `Вселенная`, `Данные`, `Ручной поиск` buttons;
- toolbar: token, timeframe, horizon, variants, maxDrafts, `Запустить цикл`;
- cycle card;
- two-column grid: recommendations + bot health.

- [ ] **Step 2: Move sections into drawers**

`UniverseSection`, `DataSection`, `SettingsSection` render inside `Drawer`; `SearchSection` renders inside a `Ручной поиск` drawer. Remove `Panel`, `LabSection`, `ServicesSection` renders and component definitions.

- [ ] **Step 3: Make queries independent**

Remove the global `if (dashboard.isPending || tokens.isPending || services.isPending) return <LoadingRows/>` block. Remove `fetchAiServices` from the page. Each block renders its own `LoadingRows`/`ErrorState`/retry. Coverage query enabled only when the data drawer is open or a cycle is active. Bot health/recommendations load on the page.

- [ ] **Step 4: Add pure tests**

Test the helper that maps a cycle status to the Russian step label/status tone and the helper that decides whether the start button is disabled (`running`, no token, missing data). No DOM required.

- [ ] **Step 5: Run web tests/build**

Run: `npx pnpm@10.20.0 --filter @nexter/web test`, `typecheck`, `lint`, `build`.
Expected: PASS.

- [ ] **Step 6: Commit**

### Task 5: Cycle card and toolbar wiring

**Files:**

- Modify: `apps/web/src/features/ai-trading/ai-trading-page.tsx`
- Modify: `apps/web/src/features/ai-trading/ai-cycle-card.tsx`

- [ ] **Step 1: Write the failing cycle-card test**

Pure `stepTone(step)` returns `success` for succeeded, `danger` for failed, `info` for running, `neutral` for queued. `nextStepLabel(steps)` returns the first non-succeeded step.

- [ ] **Step 2: Implement start mutation**

`startAiCycle({assetId,timeframe,horizonDays,variants,maxDrafts})`; on success set `cycleId`. Disable the button while a cycle is running or coverage is not `ok`.

- [ ] **Step 3: Implement polling and rendering**

`useQuery(['ai-cycle', cycleId], fetchAiCycle, { refetchInterval: status running/queued ? 1000 : false })`. Render four steps with status badges, messages, timestamps and overall error. On terminal success/failure invalidate `ai-recommendations`, `ai-bot-health`, `ai-coverage`, `ai-search-runs`, `ai-tokens`. Show `draftsCreated` and link to `Роботы`.

- [ ] **Step 4: Run web tests/build and commit**

### Task 6: Event-loop yielding and stale-run recovery

**Files:**

- Modify: `apps/api/src/modules/ai-trading/ai-search.service.ts`
- Modify: `apps/api/src/modules/ai-trading/ai-cycle.service.ts`
- Test: `apps/api/test/ai-cycle.e2e.spec.ts`

- [ ] **Step 1: Add a failing test/assertion**

Use a 100-variant cycle and assert the API can answer `GET /health` while the cycle is running (or a short timing assertion); assert a cancelled search does not finish as `succeeded`.

- [ ] **Step 2: Yield between variants**

In the variant loop, every 25 variants `await new Promise((resolve) => setImmediate(resolve))`. Before the final transaction, re-check `control.cancelled`; do not overwrite a cancelled run with `succeeded`.

- [ ] **Step 3: Recover stale runs at startup**

Add `AiCycleService.onApplicationBootstrap`/`OnModuleInit`: mark `running` cycles older than 10 minutes as `failed` with `AI_CYCLE_STALE`, and update their `ai_jobs` rows. Do not touch fresh cycles.

- [ ] **Step 4: Run tests and commit**

### Task 7: Final verification and docs

- [ ] Run `pnpm format`, `typecheck`, `lint`, API tests, web tests, build.
- [ ] Manually verify: one page opens without top cards/tabs; `Запустить цикл` runs data/search/recommendations/drafts; a second click is rejected; a missing-data token fails at the data step with a readable message; drafts are not running; `/health` and `/ready` stay 200.
- [ ] Update `AGENTS.md`, `docs/decisions.md`, and `docs/project/api.md` with the cycle endpoints, UI removal, and the draft-not-start boundary.
- [ ] Commit and open PR.

## Rollout

1. UI shell + legacy removal behind the existing page (no API change).
2. Cycle service/API + card.
3. Event-loop/stale recovery.
4. Production deploy with `/health`/`/ready` checks; no migration.
