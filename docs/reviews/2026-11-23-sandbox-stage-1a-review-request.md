# Stage 1A review request — `@nexter/sandbox-core`

- Date: 2026-11-23 (final-review fixes applied)
- Branch: `feat/sandbox-stage-1a`
- Base commit: `6286406` (`628640692d157a1ef4af01fc7f8f5b1211bfd104`, `origin/main`)
- Code head at request: `59a255a`
- Final-review fix commit: `c78bd47` (code, tests, plan/spec status)
- This packet update is a docs-only commit on the same branch after `c78bd47`
- Package: `packages/sandbox-core`
- Reviewer: independent (agent and/or owner). The reviewer does not edit code.
- Plan: `docs/superpowers/plans/2026-11-23-sandbox-stage-1a.md`
- Spec: `docs/superpowers/specs/2026-11-23-sandbox-core-replay-design.md`

Stage 1A is **implemented**; the whole-branch review returned **With fixes** and
the blockers I1–I3 plus the golden determinism tests are addressed in `c78bd47`.
Stage 1A is **not** signed off until the scoped re-review closes. **Stage 1B
remains blocked.**

## 1. Scope

This review covers **Stage 1A only**: the deterministic replay core for the
sandbox package.

In scope:

- `SimulationClock` (monotonic simulated time);
- candle type, timeframe map, sorting/validation, JSONL candle loader, snapshot id;
- close-time market view (look-ahead guard);
- event type/schema, hash-chained in-memory event log, canonical JSONL event log;
- chronological replay runner;
- CLI replay driver and fixture-based smoke;
- tests for all of the above.

Final-review fixes included here:

- **I1** — locale-independent code-unit candle ordering, with a golden snapshot id;
- **I2** — `Object.hasOwn` timeframe lookup so inherited keys are rejected;
- **I3** — `readonly` candle fields, frozen sorted candles/array, and a
  `SNAPSHOT_MISMATCH` guard in `ReplayRunner`;
- golden determinism tests (SHA-256 vector, exact `configVersion`, committed
  fixture replay);
- plan/spec status and alternatives wording (R9) corrected.

Explicitly **out of scope** for Stage 1A (must not be present, is not reviewed here):

- UI, HTTP API, database, migrations, workers;
- live data feeds, real money, wallets, signing, execution;
- strategies, portfolio, ledger, risk engine, regime detection;
- old AI module and legacy/Notion code, or any import of it;
- Stage 1B (simulation engine) and Stage 1C.

The package is standalone: its only runtime dependency is `zod`.

## 2. Files changed (base `6286406` .. code head `59a255a`)

```
.gitignore
docs/reviews/2026-11-23-sandbox-stage-1a-review-request.md
docs/superpowers/plans/2026-11-23-sandbox-stage-1a.md
docs/superpowers/specs/2026-11-23-sandbox-core-replay-design.md
pnpm-lock.yaml
packages/sandbox-core/package.json
packages/sandbox-core/tsconfig.json
packages/sandbox-core/src/index.ts
packages/sandbox-core/src/types.ts
packages/sandbox-core/src/clock.ts
packages/sandbox-core/src/clock.test.ts
packages/sandbox-core/src/config.ts
packages/sandbox-core/src/config.test.ts
packages/sandbox-core/src/timeframes.ts
packages/sandbox-core/src/timeframes.test.ts
packages/sandbox-core/src/util/hash.ts
packages/sandbox-core/src/util/hash.test.ts
packages/sandbox-core/src/data/array-candle-source.ts
packages/sandbox-core/src/data/candles.ts
packages/sandbox-core/src/data/candles.test.ts
packages/sandbox-core/src/data/jsonl-candles.ts
packages/sandbox-core/src/data/jsonl-candles.test.ts
packages/sandbox-core/src/data/market-view.ts
packages/sandbox-core/src/data/market-view.test.ts
packages/sandbox-core/src/data/snapshot.ts
packages/sandbox-core/src/events/event-types.ts
packages/sandbox-core/src/events/event-schema.ts
packages/sandbox-core/src/events/event-log.ts
packages/sandbox-core/src/events/memory-event-log.ts
packages/sandbox-core/src/events/event-log.test.ts
packages/sandbox-core/src/events/jsonl-event-log.ts
packages/sandbox-core/src/events/jsonl-event-log.test.ts
packages/sandbox-core/src/runner/context.ts
packages/sandbox-core/src/runner/replay-runner.ts
packages/sandbox-core/src/runner/replay-runner.test.ts
packages/sandbox-core/src/cli/replay.ts
packages/sandbox-core/src/cli/main.ts
packages/sandbox-core/src/cli/replay.test.ts
packages/sandbox-core/src/fixtures/candles-1h.jsonl
```

The final-review fix commit `c78bd47` touches only:

```
docs/superpowers/plans/2026-11-23-sandbox-stage-1a.md
docs/superpowers/specs/2026-11-23-sandbox-core-replay-design.md
packages/sandbox-core/src/types.ts
packages/sandbox-core/src/timeframes.ts
packages/sandbox-core/src/timeframes.test.ts
packages/sandbox-core/src/data/candles.ts
packages/sandbox-core/src/data/candles.test.ts
packages/sandbox-core/src/data/market-view.test.ts
packages/sandbox-core/src/runner/replay-runner.ts
packages/sandbox-core/src/runner/replay-runner.test.ts
packages/sandbox-core/src/config.test.ts
packages/sandbox-core/src/util/hash.test.ts
packages/sandbox-core/src/cli/replay.test.ts
```

`.gitignore` only un-ignores `packages/sandbox-core/src/data/` (the repo-wide
`data/` rule would otherwise drop the source directory). No application file,
no `apps/*`, no database and no old AI/legacy file is touched.

Formatting-only changes in the docs commit: `prettier --write .` reflowed
`src/cli/main.ts`, `src/cli/replay.ts`, `src/cli/replay.test.ts` and the
plan/spec Markdown. The same repo-wide Prettier run also reformatted three
untracked, pre-existing parallel review documents that are **not part of this
work**: `docs/reviews/2026-11-23-ai-strategy-independent-review.md`,
`docs/reviews/2026-11-23-ai-strategy-independent-review-request.md` and
`docs/reviews/2026-11-23-ai-strategy-independent-review-report.md`. They remain
untracked; no behavioral or content change was made to them beyond reflow.

## 3. Commands and observed results

All commands run from the repo root with `npx pnpm@10.20.0` unless a `cd` is
shown explicitly.

### 3.1 Package tests

```bash
npx pnpm@10.20.0 --filter @nexter/sandbox-core test
```

Observed after the final-review fixes:

```
 Test Files  11 passed (11)
      Tests  58 passed (58)
   Duration  4.09s
```

### 3.2 Typecheck

```bash
npx pnpm@10.20.0 --filter @nexter/sandbox-core typecheck
```

Observed:

```
> @nexter/sandbox-core@0.1.0 typecheck .../packages/sandbox-core
> tsc -p tsconfig.json --noEmit
```

Exit code 0, no diagnostics.

### 3.3 Build

```bash
npx pnpm@10.20.0 --filter @nexter/sandbox-core build
```

Observed:

```
> @nexter/sandbox-core@0.1.0 build .../packages/sandbox-core
> tsc -p tsconfig.json
```

Exit code 0.

### 3.4 Lint

```bash
npx pnpm@10.20.0 lint
```

Observed:

```
> nexter@0.1.0 lint .../crypto-hub
> eslint .
```

Exit code 0, no output.

### 3.5 Format

```bash
npx pnpm@10.20.0 format:check
```

Observed:

```
Checking formatting...
All matched files use Prettier code style!
```

### 3.6 CLI smoke

`pnpm --filter ... replay --` runs the script in `packages/sandbox-core`, so the
relative paths below resolve from the package directory without a manual `cd`:

```bash
npx pnpm@10.20.0 --filter @nexter/sandbox-core replay -- \
  --file src/fixtures/candles-1h.jsonl --out sandbox-events-smoke.jsonl \
  --run-id stage1a-fix-smoke --seed 7
```

Observed summary:

```json
{
  "candles": 3,
  "firstTime": 1767225600000,
  "lastTime": 1767232800000,
  "gaps": 0,
  "eventCount": 8,
  "eventHash": "709553c73da17d7a10b4c314f10916a901f5e515d134eec3911d629b93feef2f",
  "outputPath": "sandbox-events-smoke.jsonl",
  "configVersion": "6082bbcf4407b31bb56c54ef65672dd1a87e624e8b58f90c8ac217dad8c50dcd",
  "dataSnapshotId": "4d62f7195b100cd88d33896545038526decac00c03208447a155d212996c1a99"
}
```

`eventHash` is 64 hex characters. The generated `sandbox-events-smoke.jsonl`
(8 lines) was deleted after capturing the evidence and is not committed. (The
leading `--` is forwarded as an ignored argument by the flag parser.)

Determinism check with a fixed run id (two sequential CLI runs, identical args):

```bash
npx pnpm@10.20.0 --filter @nexter/sandbox-core replay -- \
  --file src/fixtures/candles-1h.jsonl --out sandbox-events-r1.jsonl \
  --run-id stage1a-review --seed 7
npx pnpm@10.20.0 --filter @nexter/sandbox-core replay -- \
  --file src/fixtures/candles-1h.jsonl --out sandbox-events-r2.jsonl \
  --run-id stage1a-review --seed 7
```

Both printed:

```
"eventHash": "54a30610df628fba9ea250ceae603fcef5e5506be18202231870b1c5aade6ec9"
```

Both output files were deleted afterwards. The hash includes `runId`, so it is
only reproducible when `--run-id` is fixed; `recordedAt` and `timing` are
excluded (see checklist item 8).

Empty file rejection (zero-byte `packages/sandbox-core/empty-smoke.jsonl`):

```
No candles found
EXIT=1
```

No event log file is created.

## 4. Checklist

Each item is a claim to verify, not an assertion to trust.

1. **No imports from old AI/legacy/apps.** `grep` for `@nexter/`, `../../..`,
   `legacy` and `ai-trading` under `packages/sandbox-core/src` returns nothing.
   `package.json` depends only on `zod` (runtime) plus `tsx`, `typescript`,
   `vitest` (dev). Verify by inspection.
2. **Clock monotonic; backwards/NaN rejected.** `src/clock.ts`: `advanceTo`
   rejects `timestamp < current` with `ClockBackwardsError` and non-finite /
   non-integer start or target values with an error. Tests:
   `clock.test.ts` "rejects backwards time", "rejects non-finite or
   non-integer timestamps", "advances forward and accepts the same timestamp".
3. **Candles sorted/validated with environment-independent order; duplicates
   rejected.** `src/data/candles.ts` sorts by `(openTime, tokenId, timeframe)`
   using a UTF-16 code-unit comparator (`<`/`>`), never `localeCompare`, so
   equal-time candles order identically in every ICU locale. It validates
   token/timeframe/openTime, decimal OHLCV, OHLC consistency and rejects
   duplicate `tokenId|timeframe|openTime`. Timeframe membership uses
   `Object.hasOwn(TIMEFRAME_MS, ...)`, so `constructor`, `toString` and
   `__proto__` are rejected rather than resolving inherited values. Tests:
   `candles.test.ts` (sorting, duplicates, invalid OHLC, unknown timeframe,
   prototype keys, code-unit order + pinned snapshot id, frozen output) and
   `ArrayCandleSource` ordering.
4. **Market view at a candle's open time does not expose it; at its close time
   it does.** `src/data/market-view.ts` computes an upper bound with
   `candleCloseTime(candle) <= clock.now()`. Test: `market-view.test.ts` "exposes
   a candle only after its close, never at its open" — at `openTime` the view is
   empty; at `openTime + 1h` the candle is visible.
5. **The next candle is not exposed until its own close.** The first
   market-view test also drives the boundary: at `3_601_001` (the second candle
   is open but not closed) only the first candle is visible; the second appears
   only at `7_201_000`. The separate limit test only asserts the last-`limit`
   slice and `snapshotId()`; it does not re-check the future boundary.
6. **Handler look-ahead test passes; `data.tick` clockTime is the candle close
   time; snapshot identity is enforced.** `replay-runner.test.ts` "walks
   candles in order..." records `ctx.clock.now()` and `ctx.market.latest(...)`
   inside `onCandle`: `now` equals the current candle close and `latest` is that
   just-closed candle — the next candle is never visible. In
   `src/runner/replay-runner.ts` the runner calls `clock.advanceTo(closeTime)`
   before the handler and writes `clockTime: iso(closeTime)` for `data.tick` and
   `cycle.completed`. The handler context type exposes only `Pick<Clock, 'now'>`
   (`src/runner/context.ts`), so handlers cannot advance time. At the start of
   `run()` the runner compares `market.snapshotId()` with `dataSnapshotId`; a
   mismatch logs `run.failed` with `reasonCode: 'SNAPSHOT_MISMATCH'` and throws
   `SnapshotMismatchError` (test: "fails fast when the market snapshot does not
   match the data snapshot"). Candles returned by the market view are frozen
   (test: "returns frozen candles that cannot rewrite history"), so a handler
   cannot rewrite history.
7. **Event schema requires `reasonCode` for decision/rejection/failure events.**
   `src/events/event-schema.ts` `superRefine`: a present `decision`, an
   `eventType` matching `/^(signal|order|position|strategy|risk)\./`, or
   `run.failed` requires a non-empty `reasonCode`; an event that carries a
   `decision` object also requires at least one alternative. Decision-like
   notifications without a `decision` object require only a `reasonCode`.
   Tests: `event-log.test.ts` "requires a reasonCode...", "rejects a decision
   event without alternatives", and the two acceptance tests.
8. **Hash excludes wall-clock `recordedAt` and `timing`; same decision inputs =
   same hash.** `eventHash` in `src/events/memory-event-log.ts` destructures out
   `recordedAt` and `timing` and hashes the canonical `stableStringify` of the
   rest (`seq`, `prevHash`, all decision inputs). Tests: "is deterministic
   regardless of recordedAt" and "excludes timing from the hash" in
   `event-log.test.ts`; "changes the hash when inputs, seq or prevHash change"
   in `jsonl-event-log.test.ts`. `hash.test.ts` additionally pins the published
   SHA-256 vector for `"abc"`.
9. **JSONL canonical round-trip, existing-file rejection, serialized appends,
   close.** `src/events/jsonl-event-log.ts` rejects a non-empty existing file,
   serializes appends through a promise queue, writes the canonical
   `stableStringify` line before committing seq/hash to memory, and rejects
   appends after `close()`. Tests: "writes one JSON object per line and
   preserves the hash", "rejects opening a non-empty existing log", "serializes
   concurrent appends in order", "rejects appends after close", "persists a
   canonical line that hashes to the same value on replay", "preserves nested
   undefined as null and still round-trips".
10. **Replay runner: close-time advance, `data.tick`/`cycle.completed`
    clockTime, gaps, out-of-order, handler failure, empty source.**
    Unit tests cover each case; the runner advances to close before the handler,
    logs `data.gap` with expected/actual milliseconds, logs `data.out_of_order`
    when `closeTime < clock.now()` (then throws `DataSourceOrderError`), logs
    `run.failed` with `HANDLER_ERROR` and rethrows, and an empty source produces
    only `run.started` + `run.finished` with `candles: 0`. A snapshot mismatch
    produces a single `run.failed` with `SNAPSHOT_MISMATCH`.
11. **CLI: import-safe `replay.ts`, `main.ts` entrypoint, fixture smoke, empty
    file rejection.** `src/cli/replay.ts` has no module-level side effects and
    exports `runReplayFromFile`; `src/cli/main.ts` parses flags, prints the
    summary JSON and sets exit code 1 on error. The package script
    `replay` targets `src/cli/main.ts`. Smoke: `candles: 3`, `eventCount: 8`,
    64-character hash (section 3.6). Empty file: `No candles found`, exit 1, no
    log file. `replay.test.ts` also replays the committed
    `src/fixtures/candles-1h.jsonl` (not an inline copy) and pins the golden
    values below.
12. **Tests/typecheck/build/lint/format pass.** See section 3.
13. **No UI/live/real money/strategies/portfolio/execution in Stage 1A.** The
    package barrel `src/index.ts` re-exports `types`, `config`, `clock`,
    `util/hash`, `timeframes`, `data/candles`, `data/array-candle-source`,
    `data/jsonl-candles`, `data/snapshot`, `data/market-view`, `events/*` and
    `runner/*` — no strategy, portfolio, ledger, execution, network or wallet
    code exists. Money-like values are decimal strings; no floats are used for
    prices or capital.

## 5. Evidence

Test summary after `c78bd47`:

```
 Test Files  11 passed (11)
      Tests  58 passed (58)
```

Pinned golden values (asserted by automated tests):

| Check                                                                         | Value                                                              |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `sha256Hex('abc')`                                                            | `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad` |
| `configVersion(base)`                                                         | `10ac283f655240e0ef515d7ee3969a45f8b56920a65f418473b2afc1bad8a507` |
| equal-`openTime` snapshot (`Token-1`, `token-1`, `token-10`), code-unit order | `07dee3ba511e34eee60997e4e6dcf812f0be594ebf4efd33f07404a6bf68ccff` |
| fixture replay `runId: stage1a-golden`, `seed: 7` — `configVersion`           | `6082bbcf4407b31bb56c54ef65672dd1a87e624e8b58f90c8ac217dad8c50dcd` |
| same replay — `dataSnapshotId`                                                | `4d62f7195b100cd88d33896545038526decac00c03208447a155d212996c1a99` |
| same replay — `eventHash` (two runs identical)                                | `1e762672c2a3deb11e6395d3e10b4a91aa4f9e58b474d86e01cc5232109105c9` |

First event line (`stage1a-golden`, 8 lines total):

```json
{
  "alternatives": [],
  "clockTime": "2026-01-01T01:00:00.000Z",
  "configVersion": "6082bbcf4407b31bb56c54ef65672dd1a87e624e8b58f90c8ac217dad8c50dcd",
  "correlationId": null,
  "dataSnapshotId": "4d62f7195b100cd88d33896545038526decac00c03208447a155d212996c1a99",
  "decision": null,
  "eventType": "run.started",
  "hash": "6a5ad876c2d48639d99073c5f7b0567769767938164f9c552d5c96ac16647903",
  "inputs": { "seed": 7 },
  "module": "run",
  "prevHash": "0000000000000000000000000000000000000000000000000000000000000000",
  "reasonCode": null,
  "reasonText": null,
  "recordedAt": "2026-11-23T19:31:50.247Z",
  "regime": null,
  "riskChecks": [],
  "runId": "stage1a-golden",
  "seed": 7,
  "seq": 0,
  "severity": "info",
  "stateAfter": null,
  "stateBefore": null,
  "strategyId": null,
  "timing": null,
  "tokenId": null
}
```

Last event line:

```json
{
  "alternatives": [],
  "clockTime": "2026-01-01T03:00:00.000Z",
  "configVersion": "6082bbcf4407b31bb56c54ef65672dd1a87e624e8b58f90c8ac217dad8c50dcd",
  "correlationId": null,
  "dataSnapshotId": "4d62f7195b100cd88d33896545038526decac00c03208447a155d212996c1a99",
  "decision": null,
  "eventType": "run.finished",
  "hash": "1e762672c2a3deb11e6395d3e10b4a91aa4f9e58b474d86e01cc5232109105c9",
  "inputs": {
    "candles": 3,
    "firstTime": "2026-01-01T00:00:00.000Z",
    "gaps": 0,
    "lastTime": "2026-01-01T02:00:00.000Z"
  },
  "module": "run",
  "prevHash": "5a67a63ff1016ecc2e12854436a685009bd7951d466f98ab8e56dd969f38e005",
  "reasonCode": null,
  "reasonText": null,
  "recordedAt": "2026-11-23T19:31:50.266Z",
  "regime": null,
  "riskChecks": [],
  "runId": "stage1a-golden",
  "seed": 7,
  "seq": 7,
  "severity": "info",
  "stateAfter": null,
  "stateBefore": null,
  "strategyId": null,
  "timing": null,
  "tokenId": null
}
```

Event count: 8 lines. Final hash above (64 hex characters). Genesis `prevHash`
is 64 zeros. `recordedAt` differs between runs and is excluded from the hash.

## 6. Review outcome template

Reviewer fills in:

```
Reviewer:
Date:
Commit reviewed: 59a255a + c78bd47 (+ this packet update)
Verdict: approved | approved with findings | changes required

Critical findings (block Stage 1B):
- ...

Major findings (fix before Stage 1B):
- ...

Minor findings (may be deferred):
- ...

Spec coverage: pass | fail (notes)
Quality: pass | fail (notes)
```

Severity guide:

- **Critical** — violates a non-negotiable rule (secrets, real money,
  look-ahead that could distort results, non-determinism, data loss).
- **Major** — incorrect behavior in a stated Stage 1A contract, missing test
  for a stated invariant, or an unguarded failure mode.
- **Minor** — style, diagnostics, typing strictness, documentation.

## 7. Known deferred items (for reviewer awareness)

These were accepted by the final review as deferred to Stage 1B; none is known
to break a Stage 1A contract:

- `source.next()` and `candleCloseTime` failures inside the loop are classified
  as `HANDLER_ERROR`; a dedicated `DATA_SOURCE_ERROR` is future work.
- `data.out_of_order` does not include the extra `candleCloseTime`/`timeframe`
  payload.
- `runReplayFromFile` does not close the log when the runner throws (no
  durability impact for the smoke path).
- Decimal validation allows negative prices/volumes; non-negative market-data
  sanity checks are deferred.
- Mixed-timeframe sources are ordered by `(openTime, tokenId, timeframe)`; a
  mixed-timeframe stream can fail as `DATA_OUT_OF_ORDER`. Per-timeframe replay
  belongs to a later stage.
- CLI `--seed`/flag values are not validated before the schema; a non-numeric
  seed surfaces as a Zod error, and a flag value can be another flag.
- CLI default output path dirties the worktree; output hygiene is deferred.
- `stableStringify` renders functions/symbols as literal `undefined`; event
  payloads are expected to be JSON-safe (no non-JSON guard yet).
- `JsonlEventLog.open` checks emptiness non-atomically and assumes a single
  writer.
- Unknown top-level event keys are stripped by Zod (no `.strict()`).
- `events()` returns the internal array copy but not frozen objects, and
  normalized event fields remain optional in the type.
- `ReplaySummary.firstTime`/`lastTime` are candle open times.

## 8. Gate

**Stage 1B must not start until this review is signed off.**

- The reviewer does not edit code; findings are returned to the implementer.
- Critical and major findings must be fixed and the full gate
  (tests, typecheck, build, lint, format) re-run before Stage 1B begins.
- Minor findings may be deferred only if recorded in the review outcome.
- Stage 1A acceptance means this packet is signed off with no open
  critical/major findings.
