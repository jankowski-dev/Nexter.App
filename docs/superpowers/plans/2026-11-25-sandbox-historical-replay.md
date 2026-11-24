# Sandbox Historical Replay UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an owner-only `Прогон` tab to `Песочница` that runs a deterministic, look-ahead-safe historical replay over `sandbox_candles`, persists the report and exact candle snapshot, and shows equity/trades/intents/counterfactuals with JSON/Markdown downloads.

**Architecture:** A new additive `sandbox_replays` table and migration `0053`; a 60-second advisory-locked replay worker that claims queued replays and runs the CPU-heavy Stage 1C engine in a Node worker thread; an owner-only API and a new `Прогон` web tab. The replay uses the existing `PaperRunner`/`ClockedMarketView` with an additive `evaluateFrom` so prefix candles are lookback only and the evaluation window starts at `from_time`. No live-run, Stage 1B/1C rule, old AI or real-money changes.

**Tech Stack:** NestJS/Fastify, Drizzle/Postgres, Node worker threads, Zod contracts, `@nexter/sandbox-core`, React 19 + TanStack Query/Router, existing UI components.

**Spec:** `docs/superpowers/specs/2026-11-25-sandbox-historical-replay-design.md`
**ADR:** `docs/adr/0085-sandbox-historical-replay.md`
**Base:** `3a6f94a` (Stage 2 merged/deployed; migration `0052` applied in production)

## Global Constraints

- Paper only: no real money, wallets, keys, signing, swaps, exchange orders or real-ledger writes.
- Owner-only; reuse auth/2FA/CSRF/feature flag `SANDBOX_ENABLED`; no public routes.
- No old AI/`ai-trading`/`trading-bots`/search imports or `market_candles`/`ai_*` reads; use `sandbox_candles` only.
- No DELETE grants; `sandbox_replays` is SELECT/INSERT/UPDATE with DELETE revoked; archive is soft.
- Money is decimal strings/Postgres `numeric`; no JS floats for money. TypeScript strict; no `any` in public/web API layers.
- Every mutation audits (`sandbox.replay_*`); no manual buy/add; no live-run mutation.
- Migration `0053` is additive; production apply requires an encrypted backup, restore check, SHA-256 and documented rollback, only after owner approval.
- The Stage 1B/1C goldens and the live runner behavior must remain unchanged.
- The replay runs off the API event loop (worker thread); the worker holds an advisory lock for the whole run.
- Full gate: `npx pnpm@10.20.0 test`, `typecheck`, `build`, `lint`, `format:check`; DB-gated suites run in CI.
- UI Russian/light; existing shared components; no manual buy/add; no Task 7-style placeholders.

## Review Focus

1. **Look-ahead:** a decision at bar `i` must not see candles after its close, even when prefix candles and future rows exist. Test with mutated future candles in core and API e2e.
2. **Evaluation window:** `evaluateFrom` must start equity/trades/report exactly at `from_time`, keep prefix candles for lookback, and never record warmup trades. Test boundary bars and a 30/90/180 comparison.
3. **Coverage window math:** gaps/prefix/partial acceptance must not let a replay run on a broken or empty window; `allowPartial` must record the actual shorter window. Test missing/gap/partial cases.
4. **Worker/restart/lock:** a queued replay must run once, survive a restart, not double-run under the advisory lock, and not requeue an active replay during a rolling deploy. Test claim, stale requeue after lock, and snapshot reuse.
5. **Snapshot/report truth:** the stored report must be re-derivable from the stored gzipped snapshot/config/seed with the same hash; future candle refreshes must not change it. Test round-trip and a mutated candle table.
6. **UI truth:** queued/running/failed/cancelled must not look completed; no manual buy/add; downloads match the stored report. Test status/empty/error states.

---

## Task 1: Core replay support (`evaluateFrom` + `runPaperFromCandles`)

**Files:**

- Modify: `packages/sandbox-core/src/paper/types.ts`
- Modify: `packages/sandbox-core/src/paper/paper-runner.ts`
- Create: `packages/sandbox-core/src/paper/run-paper.ts`
- Modify: `packages/sandbox-core/src/cli/paper.ts`
- Modify: `packages/sandbox-core/src/index.ts`
- Test: `packages/sandbox-core/src/paper/paper-runner.test.ts`, `packages/sandbox-core/src/paper/run-paper.test.ts`, existing `paper-runner.golden.test.ts` unchanged

**Interfaces:**

- `PaperRunInput` gains `readonly evaluateFrom?: Timestamp`.
- `PaperRunErrorCode` gains `'PAPER_EVALUATE_FROM_OUT_OF_RANGE'`.
- New:
  ```ts
  export interface RunPaperFromCandlesInput {
    runId: string;
    seed: number;
    configVersion: string;
    dataSnapshotId: string;
    tokenIds: readonly string[];
    candles: readonly Candle[];
    settings: SandboxDecisionSettings;
    paper: PaperRunSettings;
    initialCapitalUsd?: string;
    evaluateFrom?: Timestamp;
  }
  export interface RunPaperFromCandlesResult {
    report: RunReport;
    result: PaperRunResult;
  }
  export async function runPaperFromCandles(
    input: RunPaperFromCandlesInput,
  ): Promise<RunPaperFromCandlesResult>;
  ```
- The helper must contain the report/mark/counterfactual logic currently in `runPaperFromFiles` after file loading; the CLI calls the helper and only handles JSONL/files/artifacts.

- [ ] **Step 1: Add the failing core tests**

```ts
it('starts the evaluation at evaluateFrom and keeps prefix candles as lookback', async () => {
  const candles = makeCandles(closes(300), { start: T0 });
  const log = new MemoryEventLog();
  const result = await new PaperRunner(log).run({
    runId: 'evaluate-from',
    seed: 7,
    configVersion: 'v1',
    dataSnapshotId: 'snap',
    tokenIds: ['btc'],
    candles,
    settings: DEFAULT_SETTINGS,
    paper: DEFAULT_PAPER_SETTINGS,
    initialCapitalUsd: '1000.00',
    evaluateFrom: T0 + 100 * HOUR,
  });
  expect(result.equityCurve[0]?.clockTime).toBe(T0 + 101 * HOUR); // close of bar 100
  expect(result.equityCurve).toHaveLength(200);
  // Prefix candles are lookback only: no ledger entry may predate evaluateFrom.
  expect(result.ledger.entries.every((entry) => entry.clockTime >= T0 + 101 * HOUR)).toBe(true);
});

it('rejects an evaluateFrom with no bar at or after it', async () => {
  await expect(run({ evaluateFrom: T0 + 10_000 * HOUR })).rejects.toMatchObject({
    code: 'PAPER_EVALUATE_FROM_OUT_OF_RANGE',
  });
});

it('does not let future candles change the report at the evaluation boundary', async () => {
  const base = makeCandles(closes(240), { start: T0 });
  const changed = base.map((c) => (c.openTime > T0 + 200 * HOUR ? { ...c, close: '999' } : c));
  const a = await runPaperFromCandles({ ...input, candles: base, evaluateFrom: T0 + 200 * HOUR });
  const b = await runPaperFromCandles({
    ...input,
    candles: changed,
    evaluateFrom: T0 + 200 * HOUR,
  });
  expect(a.report.reportHash).toBe(b.report.reportHash);
  expect(a.report.trades).toEqual(b.report.trades);
  expect(a.report.equityCurve).toEqual(b.report.equityCurve);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx pnpm@10.20.0 --filter @nexter/sandbox-core test -- src/paper/paper-runner.test.ts src/paper/run-paper.test.ts`
Expected: FAIL for the missing `evaluateFrom`/helper.

- [ ] **Step 3: Implement `evaluateFrom` and the helper**

In `paper-runner.ts`: build `allBarCloses`; compute `startIndex` (`0` when undefined, else the first close `>= evaluateFrom`); throw `PaperRunError('PAPER_EVALUATE_FROM_OUT_OF_RANGE', ...)` when none; use `barCloses = allBarCloses.slice(startIndex)` for the loop/runStarted/period, while `candles`/`candleByOpen`/`ClockedMarketView` keep the full input. Preserve goldens when `evaluateFrom` is undefined.

In `run-paper.ts`: create `MemoryEventLog`, call `PaperRunner`, compute final marks from the latest closed candle per token at/after the last equity point, build the report with `buildReport`/`buildEquityCurve`/`computeMetrics`/counterfactuals exactly as the CLI does today, and return `{ report, result }`. Export from `packages/sandbox-core/src/index.ts`.

- [ ] **Step 4: Run tests and goldens**

Run:

```
npx pnpm@10.20.0 --filter @nexter/sandbox-core test -- src/paper/paper-runner.test.ts src/paper/run-paper.test.ts src/paper/paper-runner.golden.test.ts src/decision/decision-engine.golden.test.ts
```

Expected: PASS; golden hashes unchanged.

- [ ] **Step 5: Commit**

```bash
git add packages/sandbox-core
git commit -m "feat(sandbox): add evaluateFrom and reusable paper replay"
```

---

## Task 2: `sandbox_replays` schema, migration `0053` and grants

**Files:**

- Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/drizzle/0053_sandbox_replays.sql`
- Modify: `packages/db/drizzle/meta/_journal.json` + generated snapshot
- Modify: `packages/db/scripts/provision-app-role.mjs`
- Test: `apps/api/src/modules/sandbox/sandbox.migration.spec.ts`, `apps/api/test/sandbox-schema.e2e.spec.ts`

**Interfaces:**

- `sandboxReplays` Drizzle table with the columns in design §5, including `candleSnapshot` bytea and `candleSnapshotHash`; PK `id`, FK `user_id` to `users` with `onDelete: restrict`; indexes `(user_id, created_at)`, `(status, queued_at)`, `(user_id, archived_at)`.
- Status is text with allowed values `queued|running|completed|failed|cancelled`.
- Migration adds `GRANT SELECT, INSERT, UPDATE ON sandbox_replays TO nexter_app` and explicitly `REVOKE DELETE` (replays are mutable, so UPDATE stays granted); the provisioning script adds `sandbox_replays` to its delete-revoke and deleteCheck lists (and does not add it to the event UPDATE revoke).

- [ ] **Step 1: Write the failing migration/schema tests**

Add static assertions for the new table, columns `candle_snapshot`/`candle_snapshot_hash`, indexes, `SELECT/INSERT/UPDATE` and no `DELETE`; DB-gated `has_table_privilege` assertions. Add a migration count/journal assertion for `0053`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx pnpm@10.20.0 --filter @nexter/api test -- src/modules/sandbox/sandbox.migration.spec.ts`
Expected: FAIL for missing table.

- [ ] **Step 3: Implement the schema and migration**

Add the table following existing sandbox style; create the migration with `db:generate` (or append consistently if generation ordering requires), ensure the journal/snapshot chain is correct, update `provision-app-role.mjs` lists/checks. Keep the API role `nexter_app`; no DELETE.

- [ ] **Step 4: Verify**

Run:

```
npx pnpm@10.20.0 --filter @nexter/db build
npx pnpm@10.20.0 --filter @nexter/api test -- src/modules/sandbox/sandbox.migration.spec.ts
npx pnpm@10.20.0 --filter @nexter/api typecheck
```

Expected: PASS (DB-gated precision/grant assertions run in CI).

- [ ] **Step 5: Commit**

```bash
git add packages/db
git commit -m "feat(sandbox): add sandbox_replays schema and migration"
```

---

## Task 3: Contracts, window coverage, repository and replay service

**Files:**

- Modify: `packages/contracts/src/sandbox.ts`
- Create: `apps/api/src/modules/sandbox/sandbox-replay.repository.ts`
- Create: `apps/api/src/modules/sandbox/sandbox-replay.coverage.ts`
- Create: `apps/api/src/modules/sandbox/sandbox-replay.service.ts`
- Modify: `apps/api/src/modules/sandbox/sandbox.controller.ts`
- Modify: `apps/api/src/modules/sandbox/sandbox.module.ts`
- Test: `packages/contracts/src/sandbox.test.ts`, `apps/api/src/modules/sandbox/sandbox-replay.coverage.test.ts`, `apps/api/src/modules/sandbox/sandbox-replay.service.spec.ts`

**Interfaces:**

- Contracts:
  ```ts
  export const sandboxReplayStatusSchema = z.enum([
    'queued',
    'running',
    'completed',
    'failed',
    'cancelled',
  ]);
  export const sandboxReplayPeriodSchema = z.union([z.literal(30), z.literal(90), z.literal(180)]);
  export const sandboxReplayCreateRequestSchema = z
    .object({
      name: z.string().min(1).max(80),
      tokenKeys: z.array(sandboxTokenKeySchema).min(1).max(3),
      periodDays: sandboxReplayPeriodSchema,
      initialCapitalUsd: sandboxPositiveUsdSchema,
      seed: z.number().int().optional(),
      settings: sandboxDecisionSettingsSchema.optional(),
      paper: sandboxPaperSettingsSchema.optional(),
      allowPartial: z.boolean().optional().default(false),
    })
    .strict();
  export const sandboxReplayPreflightRequestSchema = z
    .object({
      tokenKeys: z.array(sandboxTokenKeySchema).min(1).max(3),
      periodDays: sandboxReplayPeriodSchema,
      allowPartial: z.boolean().optional().default(false),
    })
    .strict();
  export const sandboxReplayCoverageSchema = z.object({
    tokenKey: z.string().min(1),
    fromTime: z.iso.datetime(),
    toTime: z.iso.datetime(),
    available: z.number().int().nonnegative(),
    required: z.number().int().positive(),
    prefixBars: z.number().int().nonnegative(),
    gaps: z.number().int().nonnegative(),
    synthetic: z.boolean(),
    stale: z.boolean(),
    status: sandboxCoverageStatusSchema,
    warning: z.string().nullable(),
  });
  export const sandboxReplayPreflightResponseSchema = z.object({
    fromTime: z.iso.datetime(),
    toTime: z.iso.datetime(),
    status: sandboxCoverageStatusSchema,
    warnings: z.array(z.string()),
    coverage: z.array(sandboxReplayCoverageSchema),
  });
  export const sandboxReplayListQuerySchema = z.object({
    status: sandboxReplayStatusSchema.optional(),
    includeArchived: z
      .union([z.boolean(), z.enum(['true', 'false'])])
      .transform((value) => value === true || value === 'true')
      .default(false),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
  });
  export type SandboxReplayListQuery = z.infer<typeof sandboxReplayListQuerySchema>;
  export const sandboxReplaySummarySchema = z.object({
    id: z.uuid(),
    name: z.string(),
    status: sandboxReplayStatusSchema,
    tokenKeys: z.array(z.string()),
    periodDays: z.number().int(),
    fromTime: z.iso.datetime(),
    toTime: z.iso.datetime(),
    initialCapitalUsd: sandboxDecimalSchema,
    finalEquityUsd: sandboxDecimalSchema.nullable(),
    returnPct: sandboxDecimalSchema.nullable(),
    maxDrawdownPct: sandboxDecimalSchema.nullable(),
    reportHash: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .nullable(),
    error: z.string().nullable(),
    queuedAt: z.iso.datetime(),
    startedAt: z.iso.datetime().nullable(),
    finishedAt: z.iso.datetime().nullable(),
    archivedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  });
  export const sandboxReplayDetailSchema = sandboxReplaySummarySchema.extend({
    settings: sandboxDecisionSettingsSchema,
    paper: sandboxPaperSettingsSchema,
    seed: z.number().int(),
    eventCount: z.number().int().nullable(),
    eventHash: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .nullable(),
    dataSnapshotId: z.string().nullable(),
    candleSnapshotHash: z.string().nullable(),
  });
  export const sandboxReplayListResponseSchema = z.object({
    replays: z.array(sandboxReplaySummarySchema),
    total: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
  });
  export const SANDBOX_HISTORICAL_EXECUTION_MODE = 'historical-paper' as const;
  export const sandboxReplayReportResponseSchema = z.object({
    executionMode: z.literal(SANDBOX_HISTORICAL_EXECUTION_MODE),
    report: sandboxRunReportSchema,
    notes: z.array(z.string()),
  });
  ```
- `SandboxReplayCoverage`/preflight statuses reuse `ok|partial|missing`.
- `SandboxReplayService` methods:
  ```ts
  preflight(userId: string, input: SandboxReplayPreflightRequest, now?: Date): Promise<SandboxReplayPreflightResponse>
  create(userId: string, input: SandboxReplayCreateRequest, meta: SandboxAuditMeta): Promise<SandboxReplayDetail>
  list(userId: string, query: SandboxReplayListQuery): Promise<SandboxReplayListResponse>
  detail(userId: string, id: string): Promise<SandboxReplayDetail>
  cancel(userId: string, id: string, meta): Promise<SandboxReplayDetail>
  archive(userId: string, id: string, meta): Promise<SandboxReplayDetail>
  ```
- `sandbox-replay.coverage.ts` pure helpers:
  - `replayWindow(statsByToken, periodDays, allowPartial)` returns `{fromTime,toTime,coverage,status,warnings}`; `toTime` = earliest latest close across tokens; `fromTime` = `to - periodDays*24h`; `allowPartial` moves `fromTime` to the earliest available candle and requires `>= 240` evaluation bars.
  - `buildReplayCoverage(tokenKey, stats, from, to, prefixStats, now)`.
- Controller routes:

  ```
  POST /api/v1/sandbox/replays/preflight
  POST /api/v1/sandbox/replays            (202)
  GET  /api/v1/sandbox/replays
  GET  /api/v1/sandbox/replays/:id
  POST /api/v1/sandbox/replays/:id/cancel
  POST /api/v1/sandbox/replays/:id/archive
  ```

  Owner-only, `SandboxEnabledGuard`, no-store, Zod body/query pipes.

- [ ] **Step 1: Write failing contract/coverage/service tests**

Cover: period/token/capital validation; preflight `to` = earliest latest close; eval window bars/gaps/prefix; `allowPartial` moves `from` and records actual; missing blocks; create owner token validation; audit action; foreign id 404; cancel queued → cancelled; cancel running 409; archive only terminal; list filter/pagination.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx pnpm@10.20.0 --filter @nexter/api test -- src/modules/sandbox/sandbox-replay.coverage.test.ts src/modules/sandbox/sandbox-replay.service.spec.ts` and contracts sandbox test.

- [ ] **Step 3: Implement contracts/repository/service/controller**

Add windowed candle stats to the repository (`candleStatsBetween`, `latestClosedOpenTimes`); keep all queries owner-scoped through the token universe. Create `queued` rows only after coverage passes; freeze settings/paper/seed/window; audit `sandbox.replay_created`, `sandbox.replay_cancelled`, `sandbox.replay_archived`; sanitize errors.

- [ ] **Step 4: Run tests and typecheck**

Run the focused tests and `npx pnpm@10.20.0 --filter @nexter/api typecheck`.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts apps/api/src/modules/sandbox
git commit -m "feat(sandbox): add historical replay contracts and service"
```

---

## Task 4: Replay worker and worker-thread executor

**Files:**

- Create: `apps/api/src/modules/sandbox/sandbox-replay.executor.ts`
- Create: `apps/api/src/modules/sandbox/sandbox-replay.worker.ts`
- Create: `apps/api/src/modules/sandbox/sandbox-replay-worker.service.ts`
- Modify: `apps/api/src/modules/sandbox/sandbox-replay.repository.ts`
- Modify: `apps/api/src/modules/sandbox/sandbox.module.ts`
- Test: `apps/api/src/modules/sandbox/sandbox-replay-worker.service.spec.ts`, `apps/api/src/modules/sandbox/sandbox-replay.executor.spec.ts`, DB-gated worker e2e in Task 6

**Interfaces:**

- `ReplayExecutor`:
  ```ts
  export interface ReplayExecutionInput {
    runId: string; seed: number; configVersion: string; dataSnapshotId: string;
    tokenIds: readonly string[]; candles: readonly Candle[];
    settings: SandboxDecisionSettings; paper: SandboxPaperSettings;
    initialCapitalUsd: string; evaluateFrom: number;
  }
  export interface ReplayExecutor { run(input: ReplayExecutionInput): Promise<RunReport>; }
  export class InlineReplayExecutor implements ReplayExecutor { ... }
  export class WorkerThreadReplayExecutor implements ReplayExecutor { ... }
  ```
  The worker thread entrypoint posts `{ report }` and closes; the main thread rejects on `error`/`exit` non-zero and terminates the worker.
- `SandboxReplayWorkerService`:
  - ctor `(pool, enabled, repository, audit, executor = new WorkerThreadReplayExecutor())`.
  - `onApplicationBootstrap` starts a 60s interval + 15s initial when enabled and `NODE_ENV !== 'test'`.
  - `runOnce(now: Date = new Date(), executor: ReplayExecutor = this.executor): Promise<void>` test seam; takes `pg_try_advisory_lock(hashtext('nexter:sandbox-replay-worker'))`; after lock, `requeueRunningReplays()`; claim the oldest queued (`FOR UPDATE SKIP LOCKED`), mark running/started, audit `sandbox.replay_started`; load/reuse the stored snapshot (gzip/hash/dataSnapshotId) **before** running; call executor; store report/hashes/status `completed` in one transaction; audit `sandbox.replay_completed`; failure marks `failed` with a sanitized message and audits `sandbox.replay_failed`; release lock.
  - Uses `sandbox_candles` only; no provider calls.
- Repository methods: `claimQueuedReplay`, `markReplayRunning`, `storeReplayReport`, `markReplayFailed`, `requeueRunningReplays`, `cancelQueuedReplay`, `archiveReplay`, `loadReplay`.
- Snapshot: `zlib.gzipSync(Buffer.from(stableStringify(candles)))`; hash SHA-256 of the uncompressed string; store bytea; reuse if present (so a restart uses the same input).
- Stale recovery only after the advisory lock; no timer-based requeue.
- No old AI imports; worker thread path uses `__dirname`/compiled `.js`.

- [ ] **Step 1: Write failing worker tests**

Cover: lock not acquired → no claim; queued → running → completed; executor throws → failed/error/audit; transient DB errors don't crash the loop; stale running requeued only when lock acquired; snapshot reuse; worker executor receives `evaluateFrom` and returns report; worker thread smoke with a tiny 1-token snapshot.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx pnpm@10.20.0 --filter @nexter/api test -- src/modules/sandbox/sandbox-replay-worker.service.spec.ts src/modules/sandbox/sandbox-replay.executor.spec.ts`.

- [ ] **Step 3: Implement the executor, worker thread and service**

Use `worker_threads`; ensure `Worker` errors/exit codes reject; terminate after completion. Build the replay config from the frozen row (`paperConfigVersion`, `snapshotCandles`/`dataSnapshotId`). Keep the API event loop free.

- [ ] **Step 4: Run tests/typecheck/build**

Run focused tests, `npx pnpm@10.20.0 --filter @nexter/api typecheck`, `npx pnpm@10.20.0 --filter @nexter/api build`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/sandbox
git commit -m "feat(sandbox): run historical replays in a worker thread"
```

---

## Task 5: Replay report and read/download endpoints

**Files:**

- Create: `apps/api/src/modules/sandbox/sandbox-replay-report.service.ts`
- Modify: `apps/api/src/modules/sandbox/sandbox.controller.ts`
- Modify: `apps/api/src/modules/sandbox/sandbox.module.ts`
- Test: `apps/api/src/modules/sandbox/sandbox-replay-report.service.spec.ts`, DB-gated read e2e in Task 6

**Interfaces:**

- `getReport(userId, id): Promise<SandboxReplayReportResponse>` with `executionMode: 'historical-paper'`, stored `report`, notes (1h closed candles, next-open fills, not a live fill, snapshot/report hashes, no event rows).
- `getReportMarkdown(userId, id): Promise<string>` renders `renderMarkdown(report)` plus a notes preamble; no wall clock.
- 409 `SANDBOX_REPLAY_NOT_COMPLETED` for queued/running/failed/cancelled; 404 owner/unknown; no-store.
- Routes:

  ```
  GET /api/v1/sandbox/replays/:id/report.json
  GET /api/v1/sandbox/replays/:id/report.md
  ```

- [ ] **Step 1: Write failing report service tests**

Cover: completed report wrapper/executionMode/notes; MD headers/hash; 409 for non-completed; owner 404; no mutation.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx pnpm@10.20.0 --filter @nexter/api test -- src/modules/sandbox/sandbox-replay-report.service.spec.ts`.

- [ ] **Step 3: Implement the report service/endpoints**

Read only the stored report; do not re-run the engine on GET; sanitize errors.

- [ ] **Step 4: Run tests and typecheck**

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/sandbox
git commit -m "feat(sandbox): expose historical replay reports"
```

---

## Task 6: API/e2e and worker restart/look-ahead coverage

**Files:**

- Create: `apps/api/test/sandbox-replays.e2e.spec.ts`
- Modify: `apps/api/test/helpers/sandbox-fixtures.ts` if needed
- Test: DB-gated CI

**Interfaces:**

- Boot real `AppModule`; owner setup; create sandbox token(s); seed `sandbox_candles` for a 180-day data window and a 30-day evaluation window.
- Use the worker `runOnce(now, new InlineReplayExecutor())` or the real worker thread for one small case; assert persisted state/report.
- Cover:
  - preflight `ok`; create queued; list/detail queued; worker completes; detail/report; metrics/equity/trades/intents/counterfactuals.
  - snapshot decrypt/re-hash and `runPaperFromCandles` reproduces the report hash.
  - insert extra candles after `to_time` and assert the stored report unchanged; a future-mutated candle run (core test) proves no look-ahead.
  - cancel queued -> `cancelled`; cancel running 409; archive completed; list includeArchived.
  - owner isolation (second owner 404); audit rows exact; flag off `/replays` 404; no manual buy/add route.
  - worker restart: mark running, re-run worker under lock; requeues and completes once.
- DB-gated; CI is the first execution; state that explicitly.

- [ ] **Step 1: Write the failing e2e**
- [ ] **Step 2: Run locally (skipped without Postgres) and in CI; fix failures**
- [ ] **Step 3: Commit**

```bash
git add apps/api/test
git commit -m "test(sandbox): cover historical replay e2e and look-ahead"
```

---

## Task 7: `Прогон` UI tab, form, history and detail

**Files:**

- Modify: `apps/web/src/features/sandbox/sandbox-tabs.ts`, `sandbox-page.tsx`
- Modify: `apps/web/src/features/sandbox/sandbox-api.ts`, `sandbox-hooks.ts`
- Create: `apps/web/src/features/sandbox/sandbox-replay-tab.tsx`
- Create: `apps/web/src/features/sandbox/sandbox-replay-form.ts`
- Create: `apps/web/src/features/sandbox/sandbox-replay-list.tsx`
- Create: `apps/web/src/features/sandbox/sandbox-replay-detail.tsx`
- Create: `apps/web/src/features/sandbox/sandbox-replay-helpers.ts`
- Test: helpers/SSR/API tests under `apps/web/src/features/sandbox`

**Interfaces:**

- `SandboxTab` gains `'replay'`; tabs add `{ value: 'replay', label: 'Прогон', icon: 'statistics' }`; `sandboxTabFromHash` handles `#replay`; default `Обзор` unchanged.
- API client:
  ```ts
  preflightSandboxReplay(body): Promise<SandboxReplayPreflightResponse>
  createSandboxReplay(body): Promise<SandboxReplayDetail>
  fetchSandboxReplays(query?): Promise<SandboxReplayListResponse>
  fetchSandboxReplay(id): Promise<SandboxReplayDetail>
  cancelSandboxReplay(id): Promise<SandboxReplayDetail>
  archiveSandboxReplay(id): Promise<SandboxReplayDetail>
  fetchSandboxReplayReport(id): Promise<SandboxReplayReportResponse>
  downloadSandboxReplayReport(id, format): Promise<void>
  ```
- Hooks: query keys `replays`, `replay(id)`, `replayPreflight(tokenKeys, periodDays, allowPartial)`; detail polls 5 s while queued/running; mutations invalidate the replay prefix.
- Form: name, token multi-select 1–3, period 30/90/180, capital (default 1000), advanced settings (reuse `sandbox-run-form` builders or the live defaults), preflight coverage cards with available/required/gaps/prefix/stale/synthetic, `Обновить данные` link to tokens drawer, disable create on missing/blocked; partial confirm with actual window.
- History: status cards/table (name/status/period/tokens/final equity/return/DD/created), filter by status, archive/cancel actions with ConfirmDialog; empty/loading/error.
- Detail: queued/running progress, completed metrics/equity chart/trades/intent journal/counterfactuals/report identity/downloads, failed error, cancelled state; no manual buy/add.
- No live-run mutation; only replay endpoints.
- Tests: form validation/preflight blocking/partial; helper status tones/labels; list/detail SSR empty/loaded/failed; API URLs/parsing/download filename; polling conditional; tabs/hash; no manual-buy strings.

- [ ] **Step 1: Write failing helpers/API/SSR tests**
- [ ] **Step 2: Run tests to verify they fail**
- [ ] **Step 3: Implement tabs/API/hooks/form/list/detail**
- [ ] **Step 4: Run focused web tests, typecheck, build, lint/format**
- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/sandbox
git commit -m "feat(sandbox): add исторический прогон UI"
```

---

## Task 8: Security/ops, full gate, docs and Stage 2.1 review packet

**Files:**

- Create: `docs/reviews/2026-11-25-sandbox-historical-replay-review-request.md`
- Modify: `docs/runbooks/sandbox.md`, `docs/superpowers/specs/2026-11-25-sandbox-historical-replay-design.md`, `docs/superpowers/plans/2026-11-25-sandbox-historical-replay.md`, `docs/adr/0085-sandbox-historical-replay.md`
- Modify: `AGENTS.md`, `docs/decisions.md` (Stage 2.1 status; Stage 2 acceptance/deployment facts)
- Test/CI evidence.

**Interfaces/evidence:**

- Full gate:
  ```
  npx pnpm@10.20.0 test
  npx pnpm@10.20.0 typecheck
  npx pnpm@10.20.0 build
  npx pnpm@10.20.0 lint
  npx pnpm@10.20.0 format:check
  ```
- DB-gated replay suites (CI).
- Security: owner-only 401/404, flag off, no DELETE, no old-AI/`market_candles`/`ai_*`, no manual buy, audit exact rows, worker lock, snapshot no-store.
- Runbook: replay tab, worker, coverage/refresh, migration `0053` apply order, backup/restore/rollback, staging/prod verification.
- Review packet: scope/base/head/commits/files, commands/outputs, schema/grants, migration backup/rollback, replay semantics/no-look-ahead, coverage/warmup, worker thread/lock/restart, API/UI, audit/security, tests/evidence, deferred items, explicit gate: **production migration/deploy only after owner approval; Stage 3 remains blocked until Stage 2 is accepted and this Stage 2.1 is accepted.**
- Set design/plan status `implemented; independent review gate`; stop for whole-branch review. Do not apply migration `0053` or deploy.

- [ ] **Step 1: Run the full gate and record outputs**
- [ ] **Step 2: Run targeted security/isolation/audit checks**
- [ ] **Step 3: Write the review packet/runbook/docs**
- [ ] **Step 4: Commit**
- [ ] **Step 5: Stop for independent whole-branch review**

---

## Self-review notes

- Spec coverage: engine (`evaluateFrom`, helper), schema/snapshot, coverage/window, worker thread/lock, API/report, UI/history, tests/security/rollout are all mapped.
- Type consistency: `SandboxReplayStatus`, `SandboxReplayCoverage`, `ReplayExecutionInput`/`ReplayExecutor`, `SandboxReplay*` contracts are used consistently.
- Money/precision: report/contracts use decimal strings; DB `numeric`; snapshot bytea/hash.
- Scope guard: paper-only, no live-run changes, no old AI, no real money, no manual buy.
- Migration safety: additive `0053`, no DELETE, backup/restore/rollback; no production apply in this plan.
- Test focus: look-ahead, evaluation boundary, coverage/partial, worker restart/lock, snapshot re-derivation, UI truth.
