# Stage 1A review request — `@nexter/sandbox-core`

- Date: 2026-11-23
- Branch: `feat/sandbox-stage-1a`
- Base commit: `52cd455` (`52cd455ea7e46faad10fcadf9f76471915b67064`)
- Head at request: `a80e5bf`
- Package: `packages/sandbox-core`
- Reviewer: independent (agent and/or owner). The reviewer does not edit code.
- Plan: `docs/superpowers/plans/2026-11-23-sandbox-stage-1a.md`
- Spec: `docs/superpowers/specs/2026-11-23-sandbox-core-replay-design.md`

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

Explicitly **out of scope** for Stage 1A (must not be present, is not reviewed here):

- UI, HTTP API, database, migrations, workers;
- live data feeds, real money, wallets, signing, execution;
- strategies, portfolio, ledger, risk engine, regime detection;
- old AI module and legacy/Notion code, or any import of it;
- Stage 1B (simulation engine) and Stage 1C.

The package is standalone: its only runtime dependency is `zod`.

## 2. Files changed (base `52cd455` .. head `a80e5bf`)

```
.gitignore
docs/superpowers/plans/2026-11-23-sandbox-stage-1a.md
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

`.gitignore` only un-ignores `packages/sandbox-core/src/data/` (the repo-wide
`data/` rule would otherwise drop the source directory). No application file,
no `apps/*`, no database and no old AI/legacy file is touched.

Formatting-only changes in the docs commit: `prettier --write .` reflowed
`src/cli/main.ts`, `src/cli/replay.ts`, `src/cli/replay.test.ts` and the plan/spec
Markdown. No behavior change.

## 3. Commands and observed results

All commands run from the repo root with `npx pnpm@10.20.0`.

### 3.1 Package tests

```bash
npx pnpm@10.20.0 --filter @nexter/sandbox-core test
```

Observed (after formatting, final run):

```
 Test Files  11 passed (11)
      Tests  45 passed (45)
   Duration  3.93s
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

### 3.3 Lint

```bash
npx pnpm@10.20.0 lint
```

Observed:

```
> nexter@0.1.0 lint .../crypto-hub
> eslint .
```

Exit code 0, no output.

### 3.4 Format

```bash
npx pnpm@10.20.0 format:check
```

First run failed on 19 files (package CLI files, plan/spec, and scratch/
untracked Markdown). Per the task brief, `npx pnpm@10.20.0 format` was run, then
`format:check` again:

```
Checking formatting...
All matched files use Prettier code style!
```

### 3.5 CLI smoke

```bash
npx pnpm@10.20.0 --filter @nexter/sandbox-core replay -- \
  --file src/fixtures/candles-1h.jsonl --out sandbox-events.jsonl
```

Observed summary (the `--` separator is forwarded as an extra argument and
ignored by the parser):

```json
{
  "candles": 3,
  "firstTime": 1767225600000,
  "lastTime": 1767232800000,
  "gaps": 0,
  "eventCount": 8,
  "eventHash": "2d1af432892aef0b46a500612df173cb606c4d87c9076b71ed682db0a92f6719",
  "outputPath": "sandbox-events.jsonl",
  "configVersion": "6082bbcf4407b31bb56c54ef65672dd1a87e624e8b58f90c8ac217dad8c50dcd",
  "dataSnapshotId": "4d62f7195b100cd88d33896545038526decac00c03208447a155d212996c1a99"
}
```

`eventHash` is 64 hex characters. The generated `sandbox-events.jsonl` (8 lines)
was deleted after capturing the evidence and is not committed.

Determinism check with a fixed run id (two sequential CLI runs, identical args):

```bash
npx tsx src/cli/main.ts --file src/fixtures/candles-1h.jsonl \
  --out /tmp/s1.jsonl --run-id stage1a-review
npx tsx src/cli/main.ts --file src/fixtures/candles-1h.jsonl \
  --out /tmp/s2.jsonl --run-id stage1a-review
```

Both printed:

```
"eventHash": "54a30610df628fba9ea250ceae603fcef5e5506be18202231870b1c5aade6ec9"
```

The hash includes `runId`, so it is only reproducible when `--run-id` is fixed;
`recordedAt` and `timing` are excluded (see checklist 7).

Empty file rejection (zero-byte `candles.jsonl`):

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
3. **Candles sorted/validated; duplicates rejected.** `src/data/candles.ts`
   sorts by `(openTime, tokenId, timeframe)`, validates token/timeframe/openTime,
   decimal OHLCV, OHLC consistency and rejects duplicate
   `tokenId|timeframe|openTime`. Tests: `candles.test.ts` (sorts, duplicates,
   invalid OHLC, unknown timeframe) and `ArrayCandleSource` ordering.
4. **Market view at a candle's open time does not expose it; at its close time
   it does.** `src/data/market-view.ts` computes an upper bound with
   `candleCloseTime(candle) <= clock.now()`. Test: `market-view.test.ts` "exposes
   a candle only after its close, never at its open" — at `openTime` the view is
   empty; at `openTime + 1h` the candle is visible.
5. **The next candle is not exposed until its own close.** Same test: at
   `3_601_001` (the second candle is open but not closed) only the first candle
   is visible; the second appears only at `7_201_000`. The limit test also
   asserts no future candles.
6. **Handler look-ahead test passes; `data.tick` clockTime is the candle close
   time.** `replay-runner.test.ts` "walks candles in order..." records
   `ctx.clock.now()` and `ctx.market.latest(...)` inside `onCandle`: `now` equals
   the current candle close and `latest` is that just-closed candle — the next
   candle is never visible. In `src/runner/replay-runner.ts` the runner calls
   `clock.advanceTo(closeTime)` before the handler and writes
   `clockTime: iso(closeTime)` for `data.tick` and `cycle.completed`. The handler
   context type exposes only `Pick<Clock, 'now'>` (`src/runner/context.ts`), so
   handlers cannot advance time.
7. **Event schema requires `reasonCode` for decision/rejection/failure events.**
   `src/events/event-schema.ts` `superRefine`: a present `decision`, an
   `eventType` matching `/^(signal|order|position|strategy|risk)\./`, or
   `run.failed` requires a non-empty `reasonCode`; a present `decision` also
   requires at least one alternative. Tests: `event-log.test.ts` "requires a
   reasonCode...", "rejects a decision event without alternatives", and the two
   acceptance tests.
8. **Hash excludes wall-clock `recordedAt` and `timing`; same decision inputs =
   same hash.** `eventHash` in `src/events/memory-event-log.ts` destructures out
   `recordedAt` and `timing` and hashes the canonical `stableStringify` of the
   rest (`seq`, `prevHash`, all decision inputs). Tests: "is deterministic
   regardless of recordedAt", "excludes timing from the hash", "changes the hash
   when inputs, seq or prevHash change".
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
    clockTime, gaps, out-of-order, handler failure, empty source.** Unit tests
    cover each case; the runner advances to close before the handler, logs
    `data.gap` with expected/actual milliseconds, logs `data.out_of_order` when
    `closeTime < clock.now()` (then throws `DataSourceOrderError`), logs
    `run.failed` with `HANDLER_ERROR` and rethrows, and an empty source produces
    only `run.started` + `run.finished` with `candles: 0`.
11. **CLI: import-safe `replay.ts`, `main.ts` entrypoint, fixture smoke, empty
    file rejection.** `src/cli/replay.ts` has no module-level side effects and
    exports `runReplayFromFile`; `src/cli/main.ts` parses flags, prints the
    summary JSON and sets exit code 1 on error. The package script
    `replay` targets `src/cli/main.ts`. Smoke: `candles: 3`, `eventCount: 8`,
    64-character hash (section 3.5). Empty file: `No candles found`, exit 1, no
    log file.
12. **Tests/typecheck/lint/format pass.** See section 3.
13. **No UI/live/real money/strategies/portfolio/execution in Stage 1A.** The
    package exports only clock/hash/config/candles/snapshot/market view/events/
    runner (`src/index.ts`). No strategy, portfolio, ledger, execution, network
    or wallet code exists. Money-like values are decimal strings; no floats are
    used for prices or capital.

## 5. Evidence

Test summary:

```
 Test Files  11 passed (11)
      Tests  45 passed (45)
```

First event line (fixture smoke):

```json
{
  "alternatives": [],
  "clockTime": "2026-01-01T01:00:00.000Z",
  "configVersion": "6082bbcf4407b31bb56c54ef65672dd1a87e624e8b58f90c8ac217dad8c50dcd",
  "correlationId": null,
  "dataSnapshotId": "4d62f7195b100cd88d33896545038526decac00c03208447a155d212996c1a99",
  "decision": null,
  "eventType": "run.started",
  "hash": "2199fe9891a47ca8ec02b921421dcc836952a99ccbe3ad27a6c486e02af52002",
  "inputs": { "seed": 7 },
  "module": "run",
  "prevHash": "0000000000000000000000000000000000000000000000000000000000000000",
  "reasonCode": null,
  "reasonText": null,
  "recordedAt": "2026-11-23T19:01:40.700Z",
  "regime": null,
  "riskChecks": [],
  "runId": "sandbox-1795460500665",
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

Last event line (fixture smoke):

```json
{
  "alternatives": [],
  "clockTime": "2026-01-01T03:00:00.000Z",
  "configVersion": "6082bbcf4407b31bb56c54ef65672dd1a87e624e8b58f90c8ac217dad8c50dcd",
  "correlationId": null,
  "dataSnapshotId": "4d62f7195b100cd88d33896545038526decac00c03208447a155d212996c1a99",
  "decision": null,
  "eventType": "run.finished",
  "hash": "2d1af432892aef0b46a500612df173cb606c4d87c9076b71ed682db0a92f6719",
  "inputs": {
    "candles": 3,
    "firstTime": "2026-01-01T00:00:00.000Z",
    "gaps": 0,
    "lastTime": "2026-01-01T02:00:00.000Z"
  },
  "module": "run",
  "prevHash": "17db75e0752526b0db94587791b3eb75b98215bbd6a1863641fc6e3281e8f355",
  "reasonCode": null,
  "reasonText": null,
  "recordedAt": "2026-11-23T19:01:40.720Z",
  "regime": null,
  "riskChecks": [],
  "runId": "sandbox-1795460500665",
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

Event count: 8 lines in `sandbox-events.jsonl`. Final hash:
`2d1af432892aef0b46a500612df173cb606c4d87c9076b71ed682db0a92f6719`
(64 hex characters). Genesis `prevHash` is 64 zeros.

## 6. Review outcome template

Reviewer fills in:

```
Reviewer:
Date:
Commit reviewed: a80e5bf (+ docs commit)
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

These were raised during task-level reviews and intentionally deferred; none is
known to break a Stage 1A contract:

- Mixed-timeframe sources are ordered by `(openTime, tokenId, timeframe)`; a
  mixed-timeframe stream can fail as `DATA_OUT_OF_ORDER`. Per-timeframe replay
  belongs to a later stage.
- `source.next()` and `candleCloseTime` failures inside the loop are classified
  as `HANDLER_ERROR`; a dedicated `DATA_SOURCE_ERROR` is future work.
- `JsonlEventLog.open` checks emptiness non-atomically and assumes a single
  writer.
- `events()` returns the internal array copy but not frozen objects.
- `stableStringify` renders functions/symbols as literal `undefined`; event
  payloads are expected to be JSON-safe.
- CLI `--seed` is not validated before reaching the schema; a non-numeric seed
  surfaces as a Zod error.
- `runReplayFromFile` does not close the log when the runner throws (no
  durability impact for the smoke path).
- The committed fixture is exercised by the CLI smoke, not by an automated
  test.
- `ReplaySummary.firstTime`/`lastTime` are candle open times.

## 8. Gate

**Stage 1B must not start until this review is signed off.**

- The reviewer does not edit code; findings are returned to the implementer.
- Critical and major findings must be fixed and the full gate
  (tests, typecheck, lint, format) re-run before Stage 1B begins.
- Minor findings may be deferred only if recorded in the review outcome.
- Stage 1A acceptance means this packet is signed off with no open
  critical/major findings.
