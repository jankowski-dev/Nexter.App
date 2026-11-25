# Sandbox Visual Timeline, PDF Report and Legacy Cleanup — Implementation Plan

> **Status (2026-11-26):** Tasks 1–10 complete and deployed. PR #330 merged as `089f052`; deployment `b5a46242-0cdd-41de-9240-8deb7f5b0446`; migration `0055` applied (56 migrations); bundle `assets/index-C_LjVbrf.js`; `/health`/`/ready` 200. Pre-deploy encrypted backup dump SHA-256 `858c4d76…568a`, encrypted `ef9f288e…baad`; restore drill passed (82 tables, 194,651 rows). Five Stage 3 runs remain `running`; no `ai_*`/`bot_backtest_runs` tables were dropped.
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make historical replays self-explanatory with an interactive price/action chart and full decision log, move report detail into PDF/JSON, paginate long tables, use the `Избранное` watchlist as the sandbox token source, move strategies to Settings, and remove the obsolete AI-trading and bot-backtest modules.

**Architecture:** Add read-only replay chart/decision endpoints backed by the persisted gzip candle snapshot and report, a pdfmake replay report, an owner-facing favorites candidate endpoint plus server-side validation, and additive contracts. Legacy modules are deleted from code/UI/contracts while their DB tables remain inert. No change to sandbox trading rules, report hashes or Stage 3 runs.

**Tech Stack:** TypeScript/NestJS/Fastify/Drizzle/PostgreSQL/Zod, React 19/TanStack Query, pdfmake, Vitest/Playwright.

**Spec:** `docs/superpowers/specs/2026-11-25-sandbox-visual-cleanup-design.md`

## Global Constraints

- Paper-only: no real money, wallets, keys, signing, swaps or exchange execution.
- Do not stop, start, edit or re-run the five Stage 3 sandbox runs.
- Do not change sandbox decision/risk rules or existing report hashes.
- Money stays decimal strings / PostgreSQL `numeric`; no JS money arithmetic.
- Every mutation is audited; no DELETE grants; append-only rules remain.
- Removing AI-trading/backtest code must not remove DeepSeek/AI settings used by notes/audio.
- Do not drop `ai_*`, `bot_backtest_runs` or related columns in this batch.
- New production schema/data migrations require encrypted backup, restore check, ADR and rollback.
- UI copy is Russian; no secrets in code/logs/docs.

## Review Focus

- A replay chart must show only the evaluation window candles and never treat prefix candles as traded/reported. Test: `sandbox-replay-chart.service.spec.ts` window filter.
- A refused/expired intent must still appear as an action marker with its reason, and a one-token/empty chart must not invent points. Test: `sandbox-replay-chart.test.tsx` + service fixture.
- A missing contract or non-favorites token must be rejected server-side, not just hidden by the UI. Test: `sandbox-tokens.e2e.spec.ts` rejection + `sandbox-tokens.service.spec.ts`.
- The full decision log must be deterministic from the persisted snapshot and must not mutate the replay row/report. Test: `sandbox-replay-chart.service.spec.ts` re-run identity.
- The page must not display report hashes/snapshot ids/seed/notes; JSON/PDF must contain them. Test: `sandbox-replay-detail.test.tsx` absence + PDF/JSON response.
- Removing AI-trading/backtest must leave no imports, routes, nav entries, API client calls or CI references. Test: boundary grep/spec + typecheck/build.

---

### Task 1: Contracts, favorites data migration and ADRs

**Files:**

- Modify: `packages/contracts/src/sandbox.ts`
- Create: `packages/contracts/src/sandbox-visual.test.ts`
- Modify: `packages/db/drizzle/0055_*.sql` (custom data migration)
- Modify: `packages/db/drizzle/meta/_journal.json`
- Create: `packages/db/drizzle/meta/0055_snapshot.json` (copy of 0054 schema)
- Modify: `apps/api/src/modules/sandbox/sandbox.migration.spec.ts`
- Create: `docs/adr/0089-sandbox-favorites-token-source.md`
- Create: `docs/adr/0090-remove-ai-trading-and-backtest.md`

**Interfaces:**

- Produces:
  - `sandboxReplayChartTokenSchema`, `sandboxReplayChartActionSchema`, `sandboxReplayChartResponseSchema`.
  - `sandboxReplayDecisionSchema`, `sandboxReplayDecisionsQuerySchema`, `sandboxReplayDecisionsResponseSchema`.
  - `sandboxReplayReportIdentitySchema`; `sandboxReplayReportResponseSchema` gains `identity`.
  - `sandboxTokenCandidateSchema`, `sandboxTokenCandidatesResponseSchema`.
  - `sandboxReplayChartActionKindSchema = z.enum(['buy','sell','reject','expire','counterfactual'])`.
  - `sandboxReplayDecisionActionSchema = z.enum(['buy','sell','hold','block','noop'])`.

- [ ] **Step 1: Write the failing contracts test**

Add `packages/contracts/src/sandbox-visual.test.ts` with cases:

- chart token/candle/action parse;
- chart action kind rejects unknown;
- decision query defaults `{limit:100, offset:0}` and clamps 1–200;
- report identity requires all hashes and seed;
- token candidate requires `eligible`/`reason` and derives a key.

- [ ] **Step 2: Run it and confirm failure**

Run: `npx pnpm@10.20.0 --filter @nexter/contracts test`
Expected: FAIL on missing exports.

- [ ] **Step 3: Add the contracts**

Append the schemas/types to `packages/contracts/src/sandbox.ts` near the replay report section. `sandboxReplayReportResponseSchema` becomes:

```ts
export const sandboxReplayReportResponseSchema = z.object({
  executionMode: sandboxExecutionModeSchema,
  report: sandboxRunReportSchema,
  notes: z.array(z.string()),
  identity: sandboxReplayReportIdentitySchema,
});
```

The `identity` fields are `reportHash`, `eventHash`, `eventCount`, `dataSnapshotId`, `candleSnapshotHash`, `configVersion`, `settingsVersion`, `seed`.

- [ ] **Step 4: Add the favorites data migration**

Create a custom migration `0055_favorites_default_group.sql`:

```sql
UPDATE "watchlist_groups" g
SET "name" = 'Избранное', "updated_at" = now()
WHERE g."is_default" = true
  AND g."name" = 'Основная'
  AND NOT EXISTS (
    SELECT 1 FROM "watchlist_groups" x
    WHERE x."user_id" = g."user_id" AND x."name" = 'Избранное'
  );
```

Prefer `npx pnpm@10.20.0 db:generate --custom --name favorites_default_group`; if the installed drizzle-kit does not support `--custom`, create the SQL plus a `0055` journal entry manually and copy `0054_snapshot.json` to `0055_snapshot.json` because the schema is unchanged.

Update `sandbox.migration.spec.ts` to expect 56 journal entries and last tag `0055_favorites_default_group` (or the generated tag).

- [ ] **Step 5: Add the ADRs**

- ADR 0089: favorites as the sandbox token source, contract requirement, existing sandbox rows kept, default-group rename, consequences.
- ADR 0090: remove AI-trading/backtest code, keep robots/DeepSeek, keep tables dormant, why no destructive migration.

- [ ] **Step 6: Verify and commit**

Run: `npx pnpm@10.20.0 --filter @nexter/contracts test` → PASS.
Run: `npx pnpm@10.20.0 typecheck` → PASS.

```bash
git add packages/contracts/src packages/db/drizzle apps/api/src/modules/sandbox/sandbox.migration.spec.ts docs/adr
git commit -m "feat: add replay visual contracts and favorites migration"
```

---

### Task 2: Replay chart and decision timeline API

**Files:**

- Modify: `apps/api/src/modules/sandbox/sandbox-replay.repository.ts`
- Create: `apps/api/src/modules/sandbox/sandbox-replay-chart.service.ts`
- Modify: `apps/api/src/modules/sandbox/sandbox-replay-report.service.ts` (expose validated source)
- Modify: `apps/api/src/modules/sandbox/sandbox.module.ts`
- Modify: `apps/api/src/modules/sandbox/sandbox.controller.ts`
- Test: `apps/api/src/modules/sandbox/sandbox-replay-chart.service.spec.ts`
- Test: `apps/api/test/sandbox-replays.e2e.spec.ts`

**Interfaces:**

- `SandboxReplayRepository.findReplayChartSource(userId: string, id: string): Promise<{ replay: SandboxReplayReportRecord; candleSnapshot: Buffer | null } | null>`
- `SandboxReplayChartService.getChart(userId: string, id: string): Promise<SandboxReplayChartResponse>`
- `SandboxReplayChartService.getDecisions(userId: string, id: string, query: SandboxReplayDecisionsQuery): Promise<SandboxReplayDecisionsResponse>`
- Controller routes `GET /sandbox/replays/:id/chart` and `GET /sandbox/replays/:id/decisions`.

- [ ] **Step 1: Write the failing service tests**

Use an in-memory repository fixture with a report, a gzip snapshot built by `snapshotReplayCandles`, and candles before/inside the window. Assert:

- chart candles start at `fromTime` and exclude prefix/after-close candles;
- buy/sell/reject/expire actions map from `intentJournal` with reason codes;
- counterfactuals are included as `counterfactual`;
- a rejected intent with null price uses the last close at/before decision time;
- `getDecisions` re-runs from the snapshot, returns only events with `decision`, respects `tokenId` and limit/offset, and a second call returns the same items (cache).
- a missing/foreign replay returns not found.

- [ ] **Step 2: Run tests and confirm failure**

Run: `npx pnpm@10.20.0 --filter @nexter/api test -- sandbox-replay-chart`
Expected: FAIL because the service/repository methods do not exist.

- [ ] **Step 3: Add the repository source read**

Add a selection `chartSelection = { ...reportSelection, candleSnapshot: sandboxReplays.candleSnapshot }`, owner-scoped, and `findReplayChartSource`. It must not mutate or return DELETE.

- [ ] **Step 4: Implement `SandboxReplayChartService.getChart`**

Call the validated report source, require `candleSnapshot` and `candleSnapshotHash`, decode with `decodeReplaySnapshot`, filter candles to `openTime >= replay.fromTime.getTime() && openTime < replay.toTime.getTime()`, group by token key, and build actions:

- filled/partial intent → `buy`/`sell` at `fillTime ?? decisionTime`, price `priceUsd` or last close, amount `filledUsd`, reason code/text, intent id;
- rejected/expired intent → `reject`/`expire` at decision time with reason;
- trade lookup enriches exit/entry actions with `tradeId`/`pnlUsd`;
- counterfactual → `counterfactual` with its decision time and available price.
  Sort actions by time then id. Return `note` stating evaluation-window-only and simulated fills.

- [ ] **Step 5: Implement `getDecisions`**

Re-run `runPaperFromCandles` with the decoded snapshot, `replay.seed`, `report.configVersion`, `report.dataSnapshotId`, `replay.tokenKeys`, `toCoreDecisionSettings(replay.settings)`, `toCorePaperSettings(replay.paper)`, `replay.initialCapitalUsd` and `evaluateFrom = replay.fromTime.getTime()`. Map events with `decision` to `sandboxReplayDecisionSchema`, filter by token, sort, paginate, and cache by `${replay.id}:${report.reportHash}` with a small bounded map. Do not write to the DB.

- [ ] **Step 6: Add controller routes and module provider**

Both routes are owner-only, `SandboxEnabledGuard`, `Cache-Control: no-store`, UUID param; decisions uses `ZodValidationPipe(sandboxReplayDecisionsQuerySchema)`. Add e2e assertions for 401, chart candles/actions, decisions page/total, foreign replay 404.

- [ ] **Step 7: Verify and commit**

Run: `npx pnpm@10.20.0 --filter @nexter/api test -- sandbox-replay-chart sandbox-replays` → PASS (DB tests may be skipped locally; CI owns them).
Run: `npx pnpm@10.20.0 typecheck` → PASS.

```bash
git add apps/api/src/modules/sandbox apps/api/test/sandbox-replays.e2e.spec.ts
git commit -m "feat: add replay chart and decision timeline API"
```

---

### Task 3: Replay PDF report, identity and Markdown removal

**Files:**

- Create: `apps/api/src/modules/sandbox/sandbox-replay-pdf.service.ts`
- Modify: `apps/api/src/modules/sandbox/sandbox-replay-report.service.ts`
- Modify: `apps/api/src/modules/sandbox/sandbox.controller.ts`
- Modify: `apps/api/src/modules/sandbox/sandbox.module.ts`
- Test: `apps/api/src/modules/sandbox/sandbox-replay-pdf.service.spec.ts`
- Test: `apps/api/test/sandbox-replays.e2e.spec.ts`
- Delete/update Markdown-specific tests.

**Interfaces:**

- `SandboxReplayReportService.getReport` returns `identity`.
- `SandboxReplayPdfService.build(userId, id): Promise<{ buffer: Buffer; filename: string }>`
- `GET /sandbox/replays/:id/report.pdf` returns `application/pdf`.
- `GET /sandbox/replays/:id/report.md` removed.

- [ ] **Step 1: Write failing PDF tests**

`build` on a small fixture returns a Buffer starting with `%PDF`, non-empty, and includes the replay id in the filename. The report response has `identity` with all hashes. Add e2e: PDF 200/content-type/attachment, JSON has identity, Markdown route 404.

- [ ] **Step 2: Run and confirm failure**

Run: `npx pnpm@10.20.0 --filter @nexter/api test -- sandbox-replay-pdf sandbox-replays`
Expected: FAIL.

- [ ] **Step 3: Add identity to report response**

In `SandboxReplayReportService.getReport`, build `identity` from the row/report. Keep `notes` but the web page will stop rendering them.

- [ ] **Step 4: Implement the PDF service**

Use pdfmake/Roboto from the existing backtest report. Include dark header, identity (hashes/counts/seed/config/settings), summary metric cards, equity SVG, per-strategy/per-token tables, all trades, all intents, all counterfactuals, notes and page numbers. Use only report/identity data; no re-run.

- [ ] **Step 5: Add the controller route and remove Markdown**

Use `@Res()` and send the buffer with `content-type`, `content-disposition`, `cache-control: no-store`. Remove `getReportMarkdown`, the Markdown route, and the replay Markdown renderer/imports. Update replay e2e and web helper tests that still reference `report.md`.

- [ ] **Step 6: Verify and commit**

Run: `npx pnpm@10.20.0 --filter @nexter/api test -- sandbox-replay-pdf sandbox-replays` → PASS.
Run: `npx pnpm@10.20.0 typecheck` → PASS.

```bash
git add apps/api/src/modules/sandbox apps/api/test/sandbox-replays.e2e.spec.ts
git commit -m "feat: add replay pdf report and identity"
```

---

### Task 4: Replay UI timeline, report layout and creation drawer

**Files:**

- Create: `apps/web/src/features/sandbox/sandbox-replay-chart.tsx`
- Create: `apps/web/src/features/sandbox/sandbox-replay-chart.test.tsx`
- Create: `apps/web/src/features/sandbox/sandbox-replay-decisions.tsx`
- Modify: `apps/web/src/features/sandbox/sandbox-api.ts`
- Modify: `apps/web/src/features/sandbox/sandbox-hooks.ts`
- Modify: `apps/web/src/features/sandbox/sandbox-replay-detail.tsx`
- Modify: `apps/web/src/features/sandbox/sandbox-replay-detail.test.tsx`
- Modify: `apps/web/src/features/sandbox/sandbox-replay-list.tsx`
- Modify: `apps/web/src/features/sandbox/sandbox-replay-list.test.tsx`
- Modify: `apps/web/src/features/sandbox/sandbox-replay-tab.tsx`
- Modify: `apps/web/src/features/sandbox/sandbox-replay-tab.test.tsx`
- Modify: `apps/web/src/features/sandbox/sandbox-replay-helpers.ts` and tests.

**Interfaces:**

- `fetchSandboxReplayChart(id)`, `fetchSandboxReplayDecisions(id, query)`.
- `SandboxReplayChart` component props `{ replay, symbolByKey }`; marker selection state; `SandboxReplayDecisions` drawer with paged rows.
- `sandboxReplayReportFileName` supports `json` and `pdf`; remove `md`.
- `SandboxReplayRow` card is clickable and keyboard accessible; no `Открыть`.
- `SandboxReplayTab` has `createOpen` state and a `Drawer` form; page header has `Новый прогон`.

- [ ] **Step 1: Write failing web tests**

- chart static render with one action: marker label, reason text on selection, no invented point for empty series;
- chart token selector;
- detail page renders chart before metric cards and does NOT contain `reportHash`, `eventHash`, `dataSnapshotId`, `candleSnapshotHash`, `configVersion`, `settingsVersion`, `seed`, or the notes text;
- trades/intents/counterfactuals show 20 rows and `Ещё` expands;
- `По стратегиям`/`По токенам` are stacked full-width (no `xl:grid-cols-2` in the report markup);
- replay row has no `Открыть` button and is clickable;
- `Новый прогон` is inside a drawer, not a full-page card.

- [ ] **Step 2: Run tests and confirm failure**

Run: `npx pnpm@10.20.0 --filter @nexter/web test -- sandbox-replay`
Expected: FAIL.

- [ ] **Step 3: Add API client/hooks and chart component**

Implement SVG price line + markers (buy/sell/reject/expire/counterfactual), token selector, selected marker detail panel with time/price/reason/P&L, legend and API note. Use 20-row decision pages in `SandboxReplayDecisions`.

- [ ] **Step 4: Restructure replay detail**

Order: header/subtitle → chart → report summary/downloads (PDF/JSON) → metrics → strategies/tokens (full-width stacked, horizontal scroll) → trades/intents/counterfactuals with 20-row pagination. Remove the technical metadata/notes block from the page. Add PDF download; remove Markdown.

- [ ] **Step 5: Make the replay card clickable and move creation to a drawer**

Card `onClick`/keyboard opens the detail; action buttons stop propagation. Move the new-run form JSX into a `Drawer` opened from a `Новый прогон` button; the page shows only header + notice + history. On create, close the drawer and open the created replay.

- [ ] **Step 6: Verify and commit**

Run: `npx pnpm@10.20.0 --filter @nexter/web test` → PASS.
Run: `npx pnpm@10.20.0 --filter @nexter/web typecheck` → PASS.

```bash
git add apps/web/src/features/sandbox
git commit -m "feat: add replay timeline and compact report UX"
```

---

### Task 5: Favorites token source for sandbox

**Files:**

- Modify: `apps/api/src/modules/watchlist/watchlist.service.ts` (default group name)
- Modify: `apps/api/src/modules/sandbox/sandbox.repository.ts`
- Modify: `apps/api/src/modules/sandbox/sandbox-tokens.service.ts`
- Modify: `apps/api/src/modules/sandbox/sandbox.controller.ts`
- Modify: `apps/api/src/modules/sandbox/sandbox.module.ts` (if needed)
- Create: `apps/api/src/modules/sandbox/sandbox-token-candidates.spec.ts`
- Modify: `apps/api/test/sandbox-tokens.e2e.spec.ts`
- Modify: `apps/web/src/features/sandbox/sandbox-token-form.ts` / tests
- Modify: `apps/web/src/features/sandbox/sandbox-tokens-drawer.tsx`
- Modify: `apps/web/src/features/sandbox/sandbox-api.ts` / hooks
- Modify: `apps/web/src/features/portfolio/token-buy-list.tsx`, `apps/web/src/features/testing/testing-page.tsx`, `apps/web/src/features/trade/token-trade-drawer.tsx`, `apps/web/src/features/watchlist/token-drawer.tsx`, `apps/web/src/features/watchlist/watchlist-page.tsx`, `apps/web/src/lib/error-messages.ts`
- Modify: `apps/api/src/modules/ai-trading/ai-cycle.service.ts` only if the module still exists at this point (it is removed in Task 7; if removal is earlier, omit).

**Interfaces:**

- `GET /sandbox/tokens/candidates` returns `SandboxTokenCandidatesResponse`.
- `SandboxTokenCandidate` fields: `assetId`, `tokenKey`, `symbol`, `name`, `chain`, `contractAddress`, `eligible`, `reason`.
- `SandboxTokensService.candidates(userId)` and server-side `assertFavoritesCandidate(userId, tokenKey)`.
- Errors `SANDBOX_TOKEN_NOT_IN_FAVORITES` and `SANDBOX_TOKEN_NOT_ELIGIBLE`.

- [ ] **Step 1: Write failing tests**

- Candidate derivation: default group only, BSC/ETH contract → eligible key; missing contract → eligible false with reason; non-default group excluded.
- Create rejects an arbitrary key and an ineligible candidate; create ignores client-supplied symbol/name and uses the candidate metadata.
- Web form validation/build uses only candidate values; no free-form key/chain mode.
- Default group rename display in token list/error copy.

- [ ] **Step 2: Run and confirm failure**

Run: `npx pnpm@10.20.0 --filter @nexter/api test -- sandbox-token-candidates sandbox-tokens` and web tests.
Expected: FAIL.

- [ ] **Step 3: Implement candidate repository/service/route**

Join `watchlist` → `watchlistGroups` (`isDefault`), `assets`/`chains`; exclude archived entries; derive `chain:contract`; mark unsupported chain, missing contract, or cash equivalent with `eligible=false` and a Russian reason. Add owner route before `tokens/:id` routes.

- [ ] **Step 4: Enforce candidates in create and rename the default group**

Change `ensureDefaultGroup` to `Избранное`. In `create`, resolve the candidate, reject missing/ineligible, and use candidate symbol/name/chain/contract. Keep `update`/`refresh` working for existing rows. Update all UI `Основная`/`Основной список` strings to `Избранное`.

- [ ] **Step 5: Replace the token form UI**

Remove `mode`/`tokenKey`/`chain`/`identifier` inputs. Show a `Select` of candidates (label symbol + chain + name; disabled with reason when ineligible), an add button, and the existing universe list. Keep refresh/enable toggles. If no candidates, show “В Избранном нет токенов с контрактом”.

- [ ] **Step 6: Verify and commit**

Run: API tests, web tests, typecheck.
Commit: `feat: source sandbox tokens from favorites`.

---

### Task 6: Strategies in Settings

**Files:**

- Create: `apps/web/src/features/settings/strategies-settings-page.tsx`
- Create: `apps/web/src/features/settings/strategies-settings-page.test.tsx`
- Modify: `apps/web/src/app/router.tsx`
- Modify: `apps/web/src/features/settings/settings-page.tsx`
- Modify: `apps/web/src/features/portfolio/portfolio-tabs.ts` and tests
- Modify: `apps/web/src/features/portfolio/portfolio-page.tsx`
- Modify: `apps/web/src/features/testing/testing-page.tsx` (remove strategies mode)

**Interfaces:**

- Route `/settings/strategies`, nav card “Стратегии”, read-only cards/detail using `fetchBotStrategies`.
- `CryptoTab` no longer includes `'strategies'`; hash/tab mapping updates.

- [ ] **Step 1: Write failing tests**

`CryptoTab`/`tabFromLocation` reject `#strategies`; settings strategy page renders names/guide/risks and has no edit/test buttons.

- [ ] **Step 2: Implement and verify**

Move the strategy list/detail UI from `TestingPage` into the settings page, remove `mode="strategies"` and `TestingMode`, and remove the crypto tab. Run web tests/typecheck. Commit `feat: move strategy guide to settings`.

---

### Task 7: Remove AI-trading module

**Files:**

- Delete: `apps/api/src/modules/ai-trading/**`
- Modify: `apps/api/src/app.module.ts`
- Delete: `packages/contracts/src/ai-trading.ts` and its export
- Delete: `apps/web/src/features/ai-trading/**`
- Modify: `apps/web/src/features/portfolio/portfolio-tabs.ts`, `portfolio-page.tsx`
- Modify: `apps/web/src/lib/api.ts` (remove AI-trading imports/functions/types)
- Modify: `apps/web/src/lib/error-messages.ts` (AI draft message)
- Modify: tests that import AI trading; keep `apps/api/src/modules/ai` and `ai_settings`.

**Interfaces:** no AI trading routes, tab, contracts, API client or UI imports remain.

- [ ] **Step 1: Write the boundary test**

Add a source-scan test (or extend `sandbox-boundary.test.ts`) asserting no file under `apps/web/src/features/portfolio` imports `ai-trading` and no `app.module` import of `AiTradingModule`; add an API boundary test that the AI trading module directory is absent. The test fails while the code exists.

- [ ] **Step 2: Remove code and verify**

Delete the module/feature/contracts, remove imports/registrations/tab/API functions/error strings. Keep `ai.ts`, `ai-settings-page`, notes/audio AI. Run typecheck/tests/build. Commit `refactor: remove ai trading module`.

---

### Task 8: Remove bot backtest module

**Files:**

- Delete: `apps/api/src/modules/trading-bots/backtest/**`, `apps/api/src/modules/trading-bots/backtest.controller.ts`
- Modify: `apps/api/src/modules/trading-bots/trading-bots.module.ts`
- Delete web: `apps/web/src/features/testing/backtest-panel.tsx`, `backtest-chart.tsx`, `backtest-utils.test.ts`
- Modify: `apps/web/src/features/testing/testing-page.tsx`, `bot-detail-drawer.tsx`, tests
- Modify: `packages/contracts/src/trading-bots.ts` and exports
- Modify: `apps/web/src/lib/api.ts` (remove backtest functions/types)
- Modify: `packages/contracts/src/settings.ts`, `apps/api/src/modules/settings/settings.service.ts`, `apps/web/src/features/settings/bots-settings-page.tsx` (remove backtest defaults from contract/UI; keep DB columns)
- Modify: error message map/tests

**Interfaces:** no `BacktestPanel`, `Тестировать`, `trading-bots/backtests` routes, `BotBacktest*` contracts or settings backtest fields remain.

- [ ] **Step 1: Write failing boundary tests**

Assert no imports of `BacktestPanel`/`backtest` from testing pages, no `backtest.controller` route registration, and no `backtestDefault*` in the settings contract. Watch them fail.

- [ ] **Step 2: Remove code and verify**

Remove buttons/drawers/module/contracts/API/settings fields. Keep `trading-bots` runner and `bot_backtest_runs` table dormant. Run checks. Commit `refactor: remove legacy bot backtest module`.

---

### Task 9: Docs cleanup, full verification and PR

**Files:**

- Modify: `AGENTS.md`, `docs/decisions.md`, `docs/project/*`, `docs/runbooks/*`
- Delete: obsolete AI-trading plans/guides/reviews that describe removed modules (keep ADRs as historical, mark superseded if referenced).
- Modify: `docs/superpowers/plans/2026-11-25-sandbox-visual-cleanup.md` status.

- [ ] **Step 1: Clean docs**

Remove/archive the old AI-trading/backtest design/plan/review/guide files; update the architecture/API/operations pages to the sandbox-first model; document the new replay endpoints, PDF/JSON artifacts, `Избранное` source, `/settings/strategies`, and the dormant legacy tables. Fix broken links.

- [ ] **Step 2: Run the full checks**

```bash
npx pnpm@10.20.0 format:check
npx pnpm@10.20.0 lint
npx pnpm@10.20.0 typecheck
npx pnpm@10.20.0 test
npx pnpm@10.20.0 build
```

Expected: all PASS; DB e2e runs in CI.

- [ ] **Step 3: Commit and open PR**

Push branch, open PR with the migration/rollback notes, external bot not affected, test evidence and the legacy-removal scope. Wait for CI; fix failures.

---

### Task 10: Production rollout (only after explicit owner approval)

- [ ] **Step 1:** encrypted backup + restore check; record hashes.
- [ ] **Step 2:** apply migration `0055`, verify the default group name (and no conflict), new routes, Stage 3 runs `running`.
- [ ] **Step 3:** merge/deploy API/web; verify `/health`/`/ready`, replay chart/PDF/JSON, settings strategies, no AI tab, no backtest buttons.
- [ ] **Step 4:** do not drop legacy tables; record rollback (previous image; additive migration leaves data intact).
