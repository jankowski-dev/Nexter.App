# Sandbox Stage 1A — Clock, Data, Look-Ahead and Logging Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the headless foundation of the `Песочница` core: a monotonic simulation clock, a chronological candle source, a look-ahead-safe market view, a deterministic hash-chained event log, and a replay runner that walks historical candles in order.

**Architecture:** New independent package `@nexter/sandbox-core`. The same core will later run on live data; Stage 1A only implements the clock/data/log/runner skeleton. No old AI/legacy code is imported. No UI, live data, real money, strategies, portfolio or execution yet.

**Tech Stack:** TypeScript strict, Node.js, Zod 4, Vitest, tsx.

**Spec:** `docs/superpowers/specs/2026-11-23-sandbox-core-replay-design.md`

**Status:** ready for owner review; do not start execution until approved.

## Global Constraints

- New package only: `packages/sandbox-core`. Do not modify `apps/api` or old AI/legacy modules.
- No imports from `apps/*`, `@nexter/ai-trading`, `trading-bots`, or old search code.
- TypeScript strict; no `any` in public APIs.
- Prices and volumes are decimal strings; never JS floats for money.
- `recordedAt` is wall-clock metadata and must not affect the event hash.
- Every decision/rejection event must carry a stable `reasonCode`; every decision logs alternatives.
- Replay must be deterministic: same data + same config + same seed = same event hash.
- Look-ahead is forbidden: a candle is visible only when `candleCloseTime(candle) <= clock.now()`; the handler must never see a candle before its close, and the next candle is not visible until its own close.
- Handlers receive only a read-only clock view (`Pick<Clock, 'now'>`); only the replay engine may call `advanceTo`.
- Stage 1A has no UI, no live data, no real money, no strategies, no portfolio, no execution.
- Independent review gate after Stage 1A; do not start Stage 1B until it is signed off.
- Run `npx pnpm@10.20.0` commands from the repo root.

## Review Focus

These are the failure modes most likely to make the replay untrustworthy. Each has a test in the owning task.

1. **Future data visible to the handler** — a handler at 10:00 must not see the 11:00 candle. Tested in Task 4.
2. **Clock/order violations** — backwards clock, duplicate candle, out-of-order source, empty source. Tested in Tasks 1, 2, 4.
3. **Gaps and timestamps** — a missing hour must produce `data.gap`; no synthetic fill; epoch-ms/UTC handling. Tested in Task 4.
4. **Incomplete or non-deterministic logs** — decision events without `reasonCode`, wall-clock `recordedAt` changing the hash, JSONL round-trip mismatch. Tested in Task 3.
5. **Failure and partial logs** — handler/source error emits `run.failed`; CLI rejects an empty file. Tested in Tasks 4, 5.

---

## File Structure

```
packages/sandbox-core/
  package.json
  tsconfig.json
  src/
    index.ts
    types.ts
    timeframes.ts
    config.ts
    clock.ts
    util/hash.ts
    data/candles.ts
    data/array-candle-source.ts
    data/jsonl-candles.ts
    data/snapshot.ts
    data/market-view.ts
    events/event-types.ts
    events/event-schema.ts
    events/event-log.ts
    events/memory-event-log.ts
    events/jsonl-event-log.ts
    runner/context.ts
    runner/replay-runner.ts
    cli/replay.ts
    cli/main.ts
    fixtures/candles-1h.jsonl
```

Tests are co-located as `*.test.ts` next to the code.

---

### Task 1: Package scaffold, types, clock, hash

**Files:**
- Create: `packages/sandbox-core/package.json`
- Create: `packages/sandbox-core/tsconfig.json`
- Create: `packages/sandbox-core/src/index.ts`
- Create: `packages/sandbox-core/src/types.ts`
- Create: `packages/sandbox-core/src/config.ts`
- Create: `packages/sandbox-core/src/clock.ts`
- Create: `packages/sandbox-core/src/util/hash.ts`
- Test: `packages/sandbox-core/src/clock.test.ts`
- Test: `packages/sandbox-core/src/util/hash.test.ts`
- Test: `packages/sandbox-core/src/config.test.ts`

**Interfaces:**
- Produces: `Timestamp`, `Candle`, `RunConfig`, `Clock`, `SimulationClock`, `ClockBackwardsError`, `stableStringify`, `sha256Hex`, `configVersion`.

- [ ] **Step 1: Create the package scaffold**

`packages/sandbox-core/package.json`:

```json
{
  "name": "@nexter/sandbox-core",
  "version": "0.1.0",
  "private": true,
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "replay": "tsx src/cli/main.ts"
  },
  "dependencies": {
    "zod": "^4.6.7"
  },
  "devDependencies": {
    "tsx": "^4.23.15",
    "typescript": "5.9.3",
    "vitest": "^5.1.0"
  }
}
```

`packages/sandbox-core/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts", "dist", "node_modules"]
}
```

`packages/sandbox-core/src/index.ts`:

```ts
export * from './types';
export * from './config';
export * from './clock';
export * from './util/hash';
```

After creating the files, run `npx pnpm@10.20.0 install` to link the new workspace package and update the lockfile.

- [ ] **Step 2: Add types**

`packages/sandbox-core/src/types.ts`:

```ts
export type Timestamp = number;

export interface Candle {
  tokenId: string;
  timeframe: string;
  openTime: Timestamp;
  open: string;
  high: string;
  low: string;
  close: string;
  volumeUsd: string;
}

export interface RunConfig {
  runId: string;
  seed: number;
  timeframe: string;
  tokenIds: string[];
  initialCapitalUsd: string;
  feeBps: number;
  slippageBps: number;
}

export interface Clock {
  now(): Timestamp;
  advanceTo(timestamp: Timestamp): void;
}
```

`packages/sandbox-core/src/config.ts`:

```ts
import { sha256Hex, stableStringify } from './util/hash';
import type { RunConfig } from './types';

export function configVersion(config: RunConfig): string {
  const { runId: _runId, ...settings } = config;
  return sha256Hex(stableStringify(settings));
}
```

- [ ] **Step 3: Write the failing clock test**

`packages/sandbox-core/src/clock.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ClockBackwardsError, SimulationClock } from './clock';

describe('SimulationClock', () => {
  it('starts at the initial timestamp', () => {
    expect(new SimulationClock(1_000).now()).toBe(1_000);
  });

  it('advances forward and accepts the same timestamp', () => {
    const clock = new SimulationClock(1_000);
    clock.advanceTo(2_000);
    expect(clock.now()).toBe(2_000);
    clock.advanceTo(2_000);
    expect(clock.now()).toBe(2_000);
  });

  it('rejects backwards time', () => {
    const clock = new SimulationClock(1_000);
    clock.advanceTo(2_000);
    expect(() => clock.advanceTo(1_999)).toThrow(ClockBackwardsError);
  });

  it('rejects non-finite or non-integer timestamps', () => {
    expect(() => new SimulationClock(Number.NaN)).toThrow();
    expect(() => new SimulationClock(1.5)).toThrow();
    const clock = new SimulationClock(1_000);
    expect(() => clock.advanceTo(Number.POSITIVE_INFINITY)).toThrow();
    expect(() => clock.advanceTo(1_000.5)).toThrow();
  });
});
```

- [ ] **Step 4: Run the clock test and verify it fails**

Run: `npx pnpm@10.20.0 --filter @nexter/sandbox-core test -- src/clock.test.ts`
Expected: FAIL because `./clock` does not exist.

- [ ] **Step 5: Implement the clock**

`packages/sandbox-core/src/clock.ts`:

```ts
import type { Clock, Timestamp } from './types';

export class ClockBackwardsError extends Error {
  constructor(current: Timestamp, next: Timestamp) {
    super(`Clock cannot move backwards: current=${current}, next=${next}`);
    this.name = 'ClockBackwardsError';
  }
}

function assertTimestamp(value: Timestamp, label: string): void {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`${label} must be a finite integer timestamp`);
  }
}

export class SimulationClock implements Clock {
  private current: Timestamp;

  constructor(start: Timestamp) {
    assertTimestamp(start, 'start');
    this.current = start;
  }

  now(): Timestamp {
    return this.current;
  }

  advanceTo(timestamp: Timestamp): void {
    assertTimestamp(timestamp, 'timestamp');
    if (timestamp < this.current) {
      throw new ClockBackwardsError(this.current, timestamp);
    }
    this.current = timestamp;
  }
}
```

- [ ] **Step 6: Write the failing hash and config tests**

`packages/sandbox-core/src/util/hash.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { sha256Hex, stableStringify } from './hash';

describe('stableStringify', () => {
  it('sorts object keys deterministically', () => {
    expect(stableStringify({ b: 2, a: 1 })).toBe(stableStringify({ a: 1, b: 2 }));
  });

  it('preserves array order', () => {
    expect(stableStringify([2, 1])).not.toBe(stableStringify([1, 2]));
  });

  it('normalizes undefined to null', () => {
    expect(stableStringify({ a: undefined })).toBe('{"a":null}');
  });

  it('produces a 64-character sha256 hex hash', () => {
    expect(sha256Hex('abc')).toMatch(/^[a-f0-9]{64}$/);
  });
});
```

`packages/sandbox-core/src/config.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { configVersion } from './config';
import type { RunConfig } from './types';

const base: RunConfig = {
  runId: 'run-1',
  seed: 7,
  timeframe: '1h',
  tokenIds: ['btc', 'eth'],
  initialCapitalUsd: '1000',
  feeBps: 25,
  slippageBps: 10,
};

describe('configVersion', () => {
  it('is stable for the same settings', () => {
    expect(configVersion(base)).toBe(configVersion({ ...base }));
  });

  it('ignores runId but changes with settings', () => {
    expect(configVersion({ ...base, runId: 'run-2' })).toBe(configVersion(base));
    expect(configVersion({ ...base, initialCapitalUsd: '2000' })).not.toBe(configVersion(base));
    expect(configVersion({ ...base, tokenIds: ['btc'] })).not.toBe(configVersion(base));
  });
});
```

- [ ] **Step 7: Run the new tests and verify they fail**

Run: `npx pnpm@10.20.0 --filter @nexter/sandbox-core test -- src/util/hash.test.ts src/config.test.ts`
Expected: FAIL because `./hash` and `./config` are not implemented.

- [ ] **Step 8: Implement stableStringify and sha256Hex**

`packages/sandbox-core/src/util/hash.ts`:

```ts
import { createHash } from 'node:crypto';

export function stableStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
```

- [ ] **Step 9: Run the package tests and typecheck**

Run:

```bash
npx pnpm@10.20.0 --filter @nexter/sandbox-core test
npx pnpm@10.20.0 --filter @nexter/sandbox-core typecheck
```

Expected: all tests pass; typecheck exits 0.

- [ ] **Step 10: Commit**

```bash
git add packages/sandbox-core pnpm-lock.yaml
git commit -m "feat(sandbox): add core package, clock and hash"
```

---

### Task 2: Candle validation, JSONL source, snapshot and market view

**Files:**
- Create: `packages/sandbox-core/src/timeframes.ts`
- Create: `packages/sandbox-core/src/data/candles.ts`
- Create: `packages/sandbox-core/src/data/array-candle-source.ts`
- Create: `packages/sandbox-core/src/data/jsonl-candles.ts`
- Create: `packages/sandbox-core/src/data/snapshot.ts`
- Create: `packages/sandbox-core/src/data/market-view.ts`
- Test: `packages/sandbox-core/src/timeframes.test.ts`
- Test: `packages/sandbox-core/src/data/candles.test.ts` (also covers `ArrayCandleSource`)
- Test: `packages/sandbox-core/src/data/jsonl-candles.test.ts`
- Test: `packages/sandbox-core/src/data/market-view.test.ts`

**Interfaces:**
- Consumes: `Candle`, `Timestamp`, `Clock`, `sha256Hex`, `stableStringify`.
- Produces: `TIMEFRAME_MS`, `candleCloseTime`, `CandleValidationError`, `sortAndValidateCandles`, `CandleSource`, `ArrayCandleSource`, `loadJsonlCandles`, `snapshotCandles`, `MarketView`, `ClockedMarketView`.

- [ ] **Step 1: Write the failing timeframe and candle validation tests**

`packages/sandbox-core/src/timeframes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { TIMEFRAME_MS, candleCloseTime } from './timeframes';

describe('timeframes', () => {
  it('maps supported timeframes to milliseconds', () => {
    expect(TIMEFRAME_MS['1h']).toBe(3_600_000);
    expect(TIMEFRAME_MS['1d']).toBe(86_400_000);
  });

  it('computes the close time from the open time', () => {
    expect(candleCloseTime({ openTime: 1_000, timeframe: '1h' })).toBe(3_601_000);
  });

  it('rejects an unknown timeframe instead of silently guessing', () => {
    expect(() => candleCloseTime({ openTime: 1_000, timeframe: '2h' })).toThrow(/Unknown timeframe/);
  });
});
```

`packages/sandbox-core/src/data/candles.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Candle } from '../types';
import { ArrayCandleSource } from './array-candle-source';
import { CandleValidationError, sortAndValidateCandles } from './candles';

function candle(openTime: number, close = '100'): Candle {
  return {
    tokenId: 'btc',
    timeframe: '1h',
    openTime,
    open: close,
    high: close,
    low: close,
    close,
    volumeUsd: '1000',
  };
}

describe('sortAndValidateCandles', () => {
  it('sorts by time and validates OHLC', () => {
    const sorted = sortAndValidateCandles([candle(2_000), candle(1_000)]);
    expect(sorted.map((item) => item.openTime)).toEqual([1_000, 2_000]);
  });

  it('rejects duplicate token/timeframe/openTime', () => {
    expect(() => sortAndValidateCandles([candle(1_000), candle(1_000)])).toThrow(
      CandleValidationError,
    );
  });

  it('rejects invalid OHLC and non-decimal prices', () => {
    expect(() =>
      sortAndValidateCandles([{ ...candle(1_000), high: '99', close: '100' }]),
    ).toThrow(CandleValidationError);
    expect(() => sortAndValidateCandles([{ ...candle(1_000), close: 'abc' }])).toThrow(
      CandleValidationError,
    );
  });

  it('rejects an unknown timeframe', () => {
    expect(() => sortAndValidateCandles([{ ...candle(1_000), timeframe: '2h' }])).toThrow(
      CandleValidationError,
    );
  });
});

describe('ArrayCandleSource', () => {
  it('returns candles in sorted order and then null', () => {
    const source = new ArrayCandleSource([candle(2_000), candle(1_000)]);
    expect(source.next()?.openTime).toBe(1_000);
    expect(source.next()?.openTime).toBe(2_000);
    expect(source.next()).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx pnpm@10.20.0 --filter @nexter/sandbox-core test -- src/timeframes.test.ts src/data/candles.test.ts`
Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement timeframes and candle validation**

`packages/sandbox-core/src/timeframes.ts`:

```ts
import type { Candle, Timestamp } from './types';

export const TIMEFRAME_MS: Record<string, number> = {
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '1d': 24 * 60 * 60_000,
};

export function candleCloseTime(candle: Pick<Candle, 'openTime' | 'timeframe'>): Timestamp {
  const step = TIMEFRAME_MS[candle.timeframe];
  if (step === undefined) throw new Error(`Unknown timeframe: ${candle.timeframe}`);
  return candle.openTime + step;
}
```

`packages/sandbox-core/src/data/candles.ts`:

```ts
import { TIMEFRAME_MS } from '../timeframes';
import type { Candle } from '../types';

export class CandleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CandleValidationError';
  }
}

const DECIMAL = /^-?\d+(\.\d+)?$/;

function assertDecimal(value: string, field: string): void {
  if (!DECIMAL.test(value)) throw new CandleValidationError(`${field} is not a decimal string`);
}

export function sortAndValidateCandles(candles: readonly Candle[]): Candle[] {
  const sorted = [...candles].sort(
    (left, right) =>
      left.openTime - right.openTime ||
      left.tokenId.localeCompare(right.tokenId) ||
      left.timeframe.localeCompare(right.timeframe),
  );
  const seen = new Set<string>();
  for (const candle of sorted) {
    if (!candle.tokenId) throw new CandleValidationError('tokenId is required');
    if (!candle.timeframe) throw new CandleValidationError('timeframe is required');
    if (TIMEFRAME_MS[candle.timeframe] === undefined) {
      throw new CandleValidationError(`unknown timeframe: ${candle.timeframe}`);
    }
    if (!Number.isSafeInteger(candle.openTime)) {
      throw new CandleValidationError('openTime must be a safe integer timestamp');
    }
    for (const field of ['open', 'high', 'low', 'close', 'volumeUsd'] as const) {
      assertDecimal(candle[field], field);
    }
    const open = Number(candle.open);
    const high = Number(candle.high);
    const low = Number(candle.low);
    const close = Number(candle.close);
    if (![open, high, low, close].every(Number.isFinite)) {
      throw new CandleValidationError('OHLC values must be finite');
    }
    if (high < Math.max(open, close) || low > Math.min(open, close) || high < low) {
      throw new CandleValidationError('OHLC values are inconsistent');
    }
    const key = `${candle.tokenId}|${candle.timeframe}|${candle.openTime}`;
    if (seen.has(key)) throw new CandleValidationError(`duplicate candle: ${key}`);
    seen.add(key);
  }
  return sorted;
}
```

`packages/sandbox-core/src/data/array-candle-source.ts`:

```ts
import type { Candle } from '../types';
import { sortAndValidateCandles } from './candles';

export interface CandleSource {
  next(): Candle | null;
}

export class ArrayCandleSource implements CandleSource {
  readonly candles: readonly Candle[];
  private index = 0;

  constructor(candles: readonly Candle[]) {
    this.candles = sortAndValidateCandles(candles);
  }

  next(): Candle | null {
    const candle = this.candles[this.index];
    this.index += candle ? 1 : 0;
    return candle ?? null;
  }
}
```

Update `packages/sandbox-core/src/index.ts` to export `./timeframes` and `./data/array-candle-source`, `./data/candles`, `./data/jsonl-candles`, `./data/snapshot`, `./data/market-view`.

- [ ] **Step 4: Write the failing JSONL/snapshot tests**

`packages/sandbox-core/src/data/jsonl-candles.test.ts`:

```ts
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadJsonlCandles } from './jsonl-candles';
import { snapshotCandles } from './snapshot';

describe('loadJsonlCandles', () => {
  it('parses ISO and numeric openTime and normalizes to epoch ms', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sandbox-'));
    const file = join(dir, 'candles.jsonl');
    await writeFile(
      file,
      [
        '{"tokenId":"btc","timeframe":"1h","openTime":"2026-01-01T00:00:00.000Z","open":"100","high":"101","low":"99","close":"100","volumeUsd":"10"}',
        '{"tokenId":"btc","timeframe":"1h","openTime":1767229200000,"open":"100","high":"101","low":"99","close":"100","volumeUsd":"10"}',
      ].join('\n'),
    );
    const candles = await loadJsonlCandles(file);
    expect(candles).toHaveLength(2);
    expect(candles[0]?.openTime).toBe(Date.parse('2026-01-01T00:00:00.000Z'));
  });

  it('reports the line number on invalid JSON', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sandbox-'));
    const file = join(dir, 'bad.jsonl');
    await writeFile(
      file,
      '{"tokenId":"btc","timeframe":"1h","openTime":"2026-01-01T00:00:00.000Z","open":"100","high":"101","low":"99","close":"100","volumeUsd":"10"}\nnot-json\n',
    );
    await expect(loadJsonlCandles(file)).rejects.toThrow(/line 2/);
  });
});

describe('snapshotCandles', () => {
  it('is order-independent and changes with data', () => {
    const a = {
      tokenId: 'btc',
      timeframe: '1h',
      openTime: 1_000,
      open: '100',
      high: '101',
      low: '99',
      close: '100',
      volumeUsd: '10',
    };
    const b = { ...a, openTime: 2_000 };
    const one = snapshotCandles([a, b]);
    const two = snapshotCandles([b, a]);
    expect(one.id).toBe(two.id);
    expect(snapshotCandles([{ ...a, close: '101' }, b]).id).not.toBe(one.id);
  });
});
```

- [ ] **Step 5: Implement JSONL loader and snapshot**

`packages/sandbox-core/src/data/jsonl-candles.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { Candle } from '../types';
import { sortAndValidateCandles } from './candles';

const candleInputSchema = z.object({
  tokenId: z.string().min(1),
  timeframe: z.string().min(1),
  openTime: z.union([z.number().int(), z.iso.datetime()]).transform((value) =>
    typeof value === 'number' ? value : Date.parse(value),
  ),
  open: z.string().min(1),
  high: z.string().min(1),
  low: z.string().min(1),
  close: z.string().min(1),
  volumeUsd: z.string().min(1),
});

export async function loadJsonlCandles(filePath: string): Promise<Candle[]> {
  const raw = await readFile(filePath, 'utf8');
  const candles: Candle[] = [];
  const lines = raw.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim();
    if (!line) continue;
    try {
      candles.push(candleInputSchema.parse(JSON.parse(line)));
    } catch (error) {
      throw new Error(`Invalid candle JSON at line ${index + 1}: ${String(error)}`);
    }
  }
  return sortAndValidateCandles(candles);
}
```

`packages/sandbox-core/src/data/snapshot.ts`:

```ts
import { sha256Hex, stableStringify } from '../util/hash';
import type { Candle } from '../types';
import { sortAndValidateCandles } from './candles';

export interface CandleSnapshot {
  id: string;
  candles: Candle[];
}

export function snapshotCandles(candles: readonly Candle[]): CandleSnapshot {
  const sorted = sortAndValidateCandles(candles);
  return { id: sha256Hex(stableStringify(sorted)), candles: sorted };
}
```

- [ ] **Step 6: Write the failing market view test**

`packages/sandbox-core/src/data/market-view.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Candle } from '../types';
import { SimulationClock } from '../clock';
import { ClockedMarketView } from './market-view';
import { sortAndValidateCandles } from './candles';

function candle(openTime: number, close: string): Candle {
  return {
    tokenId: 'btc',
    timeframe: '1h',
    openTime,
    open: close,
    high: close,
    low: close,
    close,
    volumeUsd: '10',
  };
}

describe('ClockedMarketView', () => {
  it('exposes a candle only after its close, never at its open', () => {
    const candles = sortAndValidateCandles([
      candle(1_000, '100'),
      candle(3_601_000, '101'),
      candle(7_201_000, '102'),
    ]);
    const clock = new SimulationClock(1_000);
    const view = new ClockedMarketView(candles, clock, 'snapshot-1');
    expect(view.latest('btc', '1h')).toBeNull();
    expect(view.candles('btc', '1h')).toHaveLength(0);

    clock.advanceTo(3_601_000);
    expect(view.latest('btc', '1h')?.openTime).toBe(1_000);
    expect(view.candles('btc', '1h')).toHaveLength(1);

    clock.advanceTo(3_601_001);
    expect(view.latest('btc', '1h')?.openTime).toBe(1_000);
    expect(view.candles('btc', '1h')).toHaveLength(1);

    clock.advanceTo(7_201_000);
    expect(view.latest('btc', '1h')?.openTime).toBe(3_601_000);
    expect(view.candles('btc', '1h')).toHaveLength(2);
  });

  it('respects the limit and never returns future candles', () => {
    const candles = sortAndValidateCandles([
      candle(1_000, '100'),
      candle(3_601_000, '101'),
      candle(7_201_000, '102'),
    ]);
    const clock = new SimulationClock(10_801_000);
    const view = new ClockedMarketView(candles, clock, 'snapshot-1');
    const visible = view.candles('btc', '1h', 2);
    expect(visible.map((item) => item.openTime)).toEqual([3_601_000, 7_201_000]);
    expect(view.snapshotId()).toBe('snapshot-1');
  });
});
```

- [ ] **Step 7: Implement the market view**

`packages/sandbox-core/src/data/market-view.ts`:

```ts
import { candleCloseTime } from '../timeframes';
import type { Candle, Clock, Timestamp } from '../types';
import { sortAndValidateCandles } from './candles';

export interface MarketView {
  now(): Timestamp;
  candles(tokenId: string, timeframe: string, limit?: number): Candle[];
  latest(tokenId: string, timeframe: string): Candle | null;
  snapshotId(): string;
}

function keyOf(tokenId: string, timeframe: string): string {
  return `${tokenId}|${timeframe}`;
}

function upperBound(candles: readonly Candle[], now: Timestamp): number {
  let low = 0;
  let high = candles.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (candleCloseTime(candles[middle] as Candle) <= now) low = middle + 1;
    else high = middle;
  }
  return low;
}

export class ClockedMarketView implements MarketView {
  private readonly byKey = new Map<string, Candle[]>();

  constructor(
    candles: readonly Candle[],
    private readonly clock: Clock,
    private readonly snapshotIdValue: string,
  ) {
    for (const candle of sortAndValidateCandles(candles)) {
      const key = keyOf(candle.tokenId, candle.timeframe);
      const list = this.byKey.get(key);
      if (list) list.push(candle);
      else this.byKey.set(key, [candle]);
    }
  }

  now(): Timestamp {
    return this.clock.now();
  }

  candles(tokenId: string, timeframe: string, limit?: number): Candle[] {
    const list = this.byKey.get(keyOf(tokenId, timeframe));
    if (!list) return [];
    const end = upperBound(list, this.clock.now());
    if (limit === undefined) return list.slice(0, end);
    if (limit <= 0) return [];
    return list.slice(Math.max(0, end - limit), end);
  }

  latest(tokenId: string, timeframe: string): Candle | null {
    const list = this.byKey.get(keyOf(tokenId, timeframe));
    if (!list) return null;
    const end = upperBound(list, this.clock.now());
    return end === 0 ? null : (list[end - 1] as Candle);
  }

  snapshotId(): string {
    return this.snapshotIdValue;
  }
}
```

- [ ] **Step 8: Run Task 2 tests and typecheck**

Run:

```bash
npx pnpm@10.20.0 --filter @nexter/sandbox-core test -- src/timeframes.test.ts src/data
npx pnpm@10.20.0 --filter @nexter/sandbox-core typecheck
```

Expected: all tests pass; typecheck exits 0.

- [ ] **Step 9: Commit**

```bash
git add packages/sandbox-core/src/data
git commit -m "feat(sandbox): add candle validation, snapshot and clocked market view"
```

---

### Task 3: Event schema, hash-chained log and JSONL log

**Files:**
- Create: `packages/sandbox-core/src/events/event-types.ts`
- Create: `packages/sandbox-core/src/events/event-schema.ts`
- Create: `packages/sandbox-core/src/events/event-log.ts`
- Create: `packages/sandbox-core/src/events/memory-event-log.ts`
- Create: `packages/sandbox-core/src/events/jsonl-event-log.ts`
- Test: `packages/sandbox-core/src/events/event-log.test.ts`
- Test: `packages/sandbox-core/src/events/jsonl-event-log.test.ts`

**Interfaces:**
- Consumes: `stableStringify`, `sha256Hex`, `Timestamp`.
- Produces: `SandboxEventInput`, `SandboxEvent`, `SandboxDecision`, `SandboxAlternative`, `SandboxRiskCheck`, `EventLog`, `MemoryEventLog`, `JsonlEventLog`, `GENESIS_HASH`.

- [ ] **Step 1: Add event types**

`packages/sandbox-core/src/events/event-types.ts`:

```ts
export type SandboxModule =
  | 'run'
  | 'data'
  | 'clock'
  | 'regime'
  | 'strategy'
  | 'portfolio'
  | 'risk'
  | 'execution'
  | 'ledger'
  | 'manual';

export type SandboxSeverity = 'debug' | 'info' | 'warn' | 'error' | 'decision';

export interface SandboxDecision {
  action: 'buy' | 'sell' | 'hold' | 'block' | 'noop';
  sizeUsd: string | null;
  reasonCode: string;
  reasonText: string;
}

export interface SandboxAlternative {
  action: 'buy' | 'sell' | 'hold' | 'block' | 'noop';
  reasonCode: string;
  whyNot: string;
}

export interface SandboxRiskCheck {
  name: string;
  value: string;
  limit: string;
  passed: boolean;
}

export interface SandboxEventInput {
  runId: string;
  clockTime: string;
  module: SandboxModule;
  eventType: string;
  severity: SandboxSeverity;
  tokenId?: string | null;
  strategyId?: string | null;
  regime?: string | null;
  stateBefore?: Record<string, unknown> | null;
  stateAfter?: Record<string, unknown> | null;
  inputs?: Record<string, unknown>;
  timing?: Record<string, unknown> | null;
  decision?: SandboxDecision | null;
  alternatives?: SandboxAlternative[];
  riskChecks?: SandboxRiskCheck[];
  dataSnapshotId: string;
  configVersion: string;
  seed: number;
  correlationId?: string | null;
  reasonCode?: string | null;
  reasonText?: string | null;
}

export interface SandboxEvent extends SandboxEventInput {
  seq: number;
  recordedAt: string;
  prevHash: string;
  hash: string;
}

export const GENESIS_HASH = '0'.repeat(64);
```

- [ ] **Step 2: Write the failing schema/log tests**

`packages/sandbox-core/src/events/event-log.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { MemoryEventLog } from './memory-event-log';
import type { SandboxEventInput } from './event-types';

const base: SandboxEventInput = {
  runId: 'run-1',
  clockTime: '2026-01-01T00:00:00.000Z',
  module: 'data',
  eventType: 'data.tick',
  severity: 'info',
  dataSnapshotId: 'snapshot-1',
  configVersion: 'config-1',
  seed: 7,
};

describe('MemoryEventLog', () => {
  it('assigns seq, prevHash and a 64-char hash', async () => {
    const log = new MemoryEventLog();
    const first = await log.append(base);
    const second = await log.append({ ...base, eventType: 'cycle.completed' });
    expect(first.seq).toBe(0);
    expect(first.prevHash).toBe('0'.repeat(64));
    expect(first.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(second.seq).toBe(1);
    expect(second.prevHash).toBe(first.hash);
  });

  it('is deterministic regardless of recordedAt', async () => {
    const one = new MemoryEventLog();
    const two = new MemoryEventLog();
    await one.append(base);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await two.append(base);
    expect(one.hash()).toBe(two.hash());
  });

  it('excludes timing from the hash', async () => {
    const one = new MemoryEventLog();
    const two = new MemoryEventLog();
    await one.append({ ...base, timing: { durationMs: 1 } });
    await two.append({ ...base, timing: { durationMs: 999 } });
    expect(one.hash()).toBe(two.hash());
  });

  it('rejects missing required fields', async () => {
    const log = new MemoryEventLog();
    await expect(log.append({ ...base, dataSnapshotId: '' })).rejects.toThrow();
  });

  it('requires a reasonCode for decision-like events', async () => {
    const log = new MemoryEventLog();
    await expect(
      log.append({ ...base, module: 'strategy', eventType: 'signal.rejected', severity: 'decision' }),
    ).rejects.toThrow(/reasonCode/);
  });
});
```

`packages/sandbox-core/src/events/jsonl-event-log.test.ts`:

```ts
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { JsonlEventLog } from './jsonl-event-log';
import type { SandboxEventInput } from './event-types';

const input: SandboxEventInput = {
  runId: 'run-1',
  clockTime: '2026-01-01T00:00:00.000Z',
  module: 'run',
  eventType: 'run.started',
  severity: 'info',
  dataSnapshotId: 'snapshot-1',
  configVersion: 'config-1',
  seed: 7,
};

describe('JsonlEventLog', () => {
  it('writes one JSON object per line and preserves the hash', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sandbox-'));
    const file = join(dir, 'events.jsonl');
    const log = await JsonlEventLog.open(file);
    await log.append(input);
    await log.append({ ...input, eventType: 'run.finished' });
    await log.close();
    const lines = (await readFile(file, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(2);
    const parsed = JSON.parse(lines[0] ?? '');
    expect(parsed.hash).toBe(log.events()[0]?.hash);
    expect(log.hash()).toBe(log.events().at(-1)?.hash);
  });
});
```

- [ ] **Step 3: Run the tests and verify they fail**

Run: `npx pnpm@10.20.0 --filter @nexter/sandbox-core test -- src/events`
Expected: FAIL because the event log modules do not exist.

- [ ] **Step 4: Implement the event schema**

`packages/sandbox-core/src/events/event-schema.ts`:

```ts
import { z } from 'zod';
import type { SandboxEventInput } from './event-types';

const isoDate = z.iso.datetime();
const action = z.enum(['buy', 'sell', 'hold', 'block', 'noop']);

const decisionSchema = z.object({
  action,
  sizeUsd: z.string().nullable(),
  reasonCode: z.string().min(1),
  reasonText: z.string().min(1),
});

const alternativeSchema = z.object({
  action,
  reasonCode: z.string().min(1),
  whyNot: z.string().min(1),
});

const riskCheckSchema = z.object({
  name: z.string().min(1),
  value: z.string().min(1),
  limit: z.string().min(1),
  passed: z.boolean(),
});

export const sandboxEventInputSchema = z
  .object({
    runId: z.string().min(1),
    clockTime: isoDate,
    module: z.enum([
      'run',
      'data',
      'clock',
      'regime',
      'strategy',
      'portfolio',
      'risk',
      'execution',
      'ledger',
      'manual',
    ]),
    eventType: z.string().min(1),
    severity: z.enum(['debug', 'info', 'warn', 'error', 'decision']),
    tokenId: z.string().nullable().optional(),
    strategyId: z.string().nullable().optional(),
    regime: z.string().nullable().optional(),
    stateBefore: z.record(z.string(), z.unknown()).nullable().optional(),
    stateAfter: z.record(z.string(), z.unknown()).nullable().optional(),
    inputs: z.record(z.string(), z.unknown()).optional(),
    timing: z.record(z.string(), z.unknown()).nullable().optional(),
    decision: decisionSchema.nullable().optional(),
    alternatives: z.array(alternativeSchema).optional(),
    riskChecks: z.array(riskCheckSchema).optional(),
    dataSnapshotId: z.string().min(1),
    configVersion: z.string().min(1),
    seed: z.number().int(),
    correlationId: z.string().nullable().optional(),
    reasonCode: z.string().nullable().optional(),
    reasonText: z.string().nullable().optional(),
  })
  .superRefine((value, ctx) => {
    const hasDecision = value.decision !== null && value.decision !== undefined;
    const needsReason =
      hasDecision ||
      /^(signal|order|position|strategy|risk)\./.test(value.eventType) ||
      value.eventType === 'run.failed';
    if (needsReason && !value.reasonCode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reasonCode'],
        message: 'reasonCode is required for decision, rejection and failure events',
      });
    }
    if (hasDecision && (value.alternatives?.length ?? 0) < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['alternatives'],
        message: 'at least one alternative is required for decision events',
      });
    }
  }) satisfies z.ZodType<SandboxEventInput>;
```

- [ ] **Step 5: Implement the event log base and memory log**

`packages/sandbox-core/src/events/event-log.ts`:

```ts
import type { SandboxEvent, SandboxEventInput } from './event-types';

export interface EventLog {
  append(input: SandboxEventInput): Promise<SandboxEvent>;
  events(): readonly SandboxEvent[];
  hash(): string;
}
```

`packages/sandbox-core/src/events/memory-event-log.ts`:

```ts
import { sha256Hex, stableStringify } from '../util/hash';
import { sandboxEventInputSchema } from './event-schema';
import { GENESIS_HASH, type SandboxEvent, type SandboxEventInput } from './event-types';
import type { EventLog } from './event-log';

export function eventHash(event: Omit<SandboxEvent, 'hash'>): string {
  const { recordedAt: _recordedAt, timing: _timing, ...hashable } = event;
  return sha256Hex(stableStringify(hashable));
}

export class MemoryEventLog implements EventLog {
  private readonly entries: SandboxEvent[] = [];

  async append(input: SandboxEventInput): Promise<SandboxEvent> {
    const event = this.buildEvent(input);
    this.commitEvent(event);
    return event;
  }

  events(): readonly SandboxEvent[] {
    return [...this.entries];
  }

  hash(): string {
    return this.entries.at(-1)?.hash ?? GENESIS_HASH;
  }

  /** Validates the input and computes the next chained event without storing it. */
  protected buildEvent(input: SandboxEventInput): SandboxEvent {
    const parsed = sandboxEventInputSchema.parse(input);
    const prevHash = this.entries.at(-1)?.hash ?? GENESIS_HASH;
    const base = {
      ...parsed,
      tokenId: parsed.tokenId ?? null,
      strategyId: parsed.strategyId ?? null,
      regime: parsed.regime ?? null,
      stateBefore: parsed.stateBefore ?? null,
      stateAfter: parsed.stateAfter ?? null,
      inputs: parsed.inputs ?? {},
      timing: parsed.timing ?? null,
      decision: parsed.decision ?? null,
      alternatives: parsed.alternatives ?? [],
      riskChecks: parsed.riskChecks ?? [],
      correlationId: parsed.correlationId ?? null,
      reasonCode: parsed.reasonCode ?? null,
      reasonText: parsed.reasonText ?? null,
      seq: this.entries.length,
      recordedAt: new Date().toISOString(),
      prevHash,
    };
    return { ...base, hash: eventHash(base) };
  }

  /** Appends an already built event to the in-memory chain. */
  protected commitEvent(event: SandboxEvent): void {
    this.entries.push(event);
  }
}
```

- [ ] **Step 6: Implement the JSONL log**

`packages/sandbox-core/src/events/jsonl-event-log.ts`:

```ts
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { stableStringify } from '../util/hash';
import { MemoryEventLog } from './memory-event-log';
import type { SandboxEvent, SandboxEventInput } from './event-types';

export class JsonlEventLog extends MemoryEventLog {
  private queue: Promise<void> = Promise.resolve();
  private closed = false;

  private constructor(private readonly filePath: string) {
    super();
  }

  static async open(filePath: string): Promise<JsonlEventLog> {
    await mkdir(dirname(filePath), { recursive: true });
    let existing: string | null = null;
    try {
      existing = await readFile(filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (existing !== null && existing.trim().length > 0) {
      throw new Error(`Event log already exists and is not empty: ${filePath}`);
    }
    return new JsonlEventLog(filePath);
  }

  override append(input: SandboxEventInput): Promise<SandboxEvent> {
    const result = this.queue.then(() => this.appendQueued(input));
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async close(): Promise<void> {
    await this.queue;
    this.closed = true;
  }

  private async appendQueued(input: SandboxEventInput): Promise<SandboxEvent> {
    if (this.closed) throw new Error(`Event log is closed: ${this.filePath}`);
    const event = this.buildEvent(input);
    // Persist the canonical form used for hashing so a replayed line hashes identically.
    await appendFile(this.filePath, `${stableStringify(event)}\n`, 'utf8');
    // Only advance seq/hash after the durable write succeeded.
    this.commitEvent(event);
    return event;
  }
}
```

Update `packages/sandbox-core/src/index.ts` to export `./events/event-types`, `./events/event-log`, `./events/memory-event-log` and `./events/jsonl-event-log`.

Additional regression tests required after the event-log hardening (these pin the review findings):

- a decision event without alternatives rejects; with one alternative and a `reasonCode` it is accepted;
- `JsonlEventLog.open` rejects a non-empty existing file;
- concurrent appends are serialized: `seq` 0 then 1, `prevHash` links to the first hash;
- append after `close()` rejects;
- persisted canonical line round-trips: parse it, strip `hash`, recompute with `eventHash`, and get the stored hash;
- changing `inputs`, `seq` or `prevHash` changes the hash;
- nested `undefined` in `inputs` is persisted as `null` and still round-trips.

- [ ] **Step 7: Run the event tests and typecheck**

Run:

```bash
npx pnpm@10.20.0 --filter @nexter/sandbox-core test -- src/events
npx pnpm@10.20.0 --filter @nexter/sandbox-core typecheck
```

Expected: all tests pass; typecheck exits 0.

- [ ] **Step 8: Commit**

```bash
git add packages/sandbox-core/src/events
git commit -m "feat(sandbox): add deterministic hash-chained event log"
```

---

### Task 4: Replay runner

**Files:**
- Create: `packages/sandbox-core/src/runner/context.ts`
- Create: `packages/sandbox-core/src/runner/replay-runner.ts`
- Test: `packages/sandbox-core/src/runner/replay-runner.test.ts`

**Interfaces:**
- Consumes: `Clock`, `Candle`, `CandleSource`, `MarketView`, `EventLog`, `TIMEFRAME_MS`, `candleCloseTime`.
- Produces: `SandboxContext`, `ReplayRunnerOptions`, `ReplaySummary`, `ReplayRunner`, `DataSourceOrderError`.

- [ ] **Step 1: Add context types**

`packages/sandbox-core/src/runner/context.ts`:

```ts
import type { Clock, Timestamp } from '../types';
import type { EventLog } from '../events/event-log';
import type { MarketView } from '../data/market-view';

export interface SandboxContext {
  runId: string;
  // Handlers may read simulated time but must never advance it.
  clock: Pick<Clock, 'now'>;
  market: MarketView;
  log: EventLog;
  configVersion: string;
  seed: number;
}

export interface ReplaySummary {
  candles: number;
  firstTime: Timestamp | null;
  lastTime: Timestamp | null;
  gaps: number;
  eventCount: number;
  eventHash: string;
}
```

- [ ] **Step 2: Write the failing runner tests**

`packages/sandbox-core/src/runner/replay-runner.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Candle } from '../types';
import { SimulationClock } from '../clock';
import { ArrayCandleSource } from '../data/array-candle-source';
import { ClockedMarketView } from '../data/market-view';
import { snapshotCandles } from '../data/snapshot';
import { MemoryEventLog } from '../events/memory-event-log';
import { candleCloseTime } from '../timeframes';
import { DataSourceOrderError, ReplayRunner } from './replay-runner';

function candle(openTime: number, close = '100'): Candle {
  return {
    tokenId: 'btc',
    timeframe: '1h',
    openTime,
    open: close,
    high: close,
    low: close,
    close,
    volumeUsd: '10',
  };
}

function setup(candles: Candle[], start = candles[0] ? candleCloseTime(candles[0]) : 1_000) {
  const clock = new SimulationClock(start);
  const source = new ArrayCandleSource(candles);
  const snapshot = snapshotCandles(source.candles);
  const market = new ClockedMarketView(snapshot.candles, clock, snapshot.id);
  const log = new MemoryEventLog();
  return { clock, source, market, log, snapshot };
}

describe('ReplayRunner', () => {
  it('walks candles in order and logs run/data/cycle/finish events', async () => {
    const { clock, source, market, log, snapshot } = setup([
      candle(1_000),
      candle(3_600_000 + 1_000),
      candle(7_200_000 + 1_000),
    ]);
    const seen: Array<{ now: number; latest: number | null }> = [];
    const runner = new ReplayRunner({
      runId: 'run-1',
      seed: 7,
      configVersion: 'config-1',
      dataSnapshotId: snapshot.id,
      clock,
      source,
      market,
      eventLog: log,
      onCandle: (ctx) => {
        seen.push({
          now: ctx.clock.now(),
          latest: ctx.market.latest('btc', '1h')?.openTime ?? null,
        });
      },
    });
    const summary = await runner.run();
    expect(summary.candles).toBe(3);
    expect(seen).toEqual([
      { now: 3_601_000, latest: 1_000 },
      { now: 7_201_000, latest: 3_601_000 },
      { now: 10_801_000, latest: 7_201_000 },
    ]);
    expect(log.events().filter((e) => e.eventType === 'data.tick')).toHaveLength(3);
    expect(log.events().filter((e) => e.eventType === 'cycle.completed')).toHaveLength(3);
    expect(log.events()[0]?.eventType).toBe('run.started');
    expect(log.events().at(-1)?.eventType).toBe('run.finished');
    expect(summary.eventHash).toBe(log.hash());
  });

  it('logs a data gap per token/timeframe', async () => {
    const { clock, source, market, log, snapshot } = setup([candle(1_000), candle(7_201_000)]);
    const runner = new ReplayRunner({
      runId: 'run-1',
      seed: 7,
      configVersion: 'config-1',
      dataSnapshotId: snapshot.id,
      clock,
      source,
      market,
      eventLog: log,
    });
    const summary = await runner.run();
    expect(summary.gaps).toBe(1);
    const gap = log.events().find((e) => e.eventType === 'data.gap');
    expect(gap?.inputs).toMatchObject({ expectedMs: 3_600_000, actualMs: 7_200_000 });
  });

  it('rejects an out-of-order source and logs data.out_of_order', async () => {
    const { clock, market, log, snapshot } = setup([candle(10_000)]);
    let call = 0;
    const outOfOrderSource = {
      next: () => {
        call += 1;
        if (call === 1) return candle(10_000);
        if (call === 2) return candle(1_000);
        return null;
      },
    };
    const runner = new ReplayRunner({
      runId: 'run-1',
      seed: 7,
      configVersion: 'config-1',
      dataSnapshotId: snapshot.id,
      clock,
      source: outOfOrderSource,
      market,
      eventLog: log,
    });
    await expect(runner.run()).rejects.toThrow(DataSourceOrderError);
    expect(log.events().some((event) => event.eventType === 'data.out_of_order')).toBe(true);
    expect(log.events().at(-1)?.reasonCode).toBe('DATA_OUT_OF_ORDER');
  });

  it('logs run.failed and rethrows when the handler fails', async () => {
    const { clock, source, market, log, snapshot } = setup([candle(1_000)]);
    const runner = new ReplayRunner({
      runId: 'run-1',
      seed: 7,
      configVersion: 'config-1',
      dataSnapshotId: snapshot.id,
      clock,
      source,
      market,
      eventLog: log,
      onCandle: () => {
        throw new Error('handler boom');
      },
    });
    await expect(runner.run()).rejects.toThrow('handler boom');
    const failed = log.events().at(-1);
    expect(failed?.eventType).toBe('run.failed');
    expect(failed?.reasonCode).toBe('HANDLER_ERROR');
  });

  it('handles an empty source', async () => {
    const { clock, source, market, log, snapshot } = setup([]);
    const runner = new ReplayRunner({
      runId: 'run-1',
      seed: 7,
      configVersion: 'config-1',
      dataSnapshotId: snapshot.id,
      clock,
      source,
      market,
      eventLog: log,
    });
    const summary = await runner.run();
    expect(summary.candles).toBe(0);
    expect(log.events().map((e) => e.eventType)).toEqual(['run.started', 'run.finished']);
  });
});
```

`ArrayCandleSource` and `CandleSource` are already implemented and committed in Task 2.

- [ ] **Step 3: Run the runner tests and verify they fail**

Run: `npx pnpm@10.20.0 --filter @nexter/sandbox-core test -- src/runner`
Expected: FAIL because `ReplayRunner` does not exist.

- [ ] **Step 4: Implement the runner**

`packages/sandbox-core/src/runner/replay-runner.ts`:

```ts
import { performance } from 'node:perf_hooks';
import type { Candle, Clock } from '../types';
import type { CandleSource } from '../data/array-candle-source';
import type { MarketView } from '../data/market-view';
import type { EventLog } from '../events/event-log';
import { candleCloseTime, TIMEFRAME_MS } from '../timeframes';
import type { SandboxContext, ReplaySummary } from './context';

export class DataSourceOrderError extends Error {
  constructor(message = 'data source returned a candle older than the clock') {
    super(message);
    this.name = 'DataSourceOrderError';
  }
}

export interface ReplayRunnerOptions {
  runId: string;
  seed: number;
  configVersion: string;
  dataSnapshotId: string;
  clock: Clock;
  source: CandleSource;
  market: MarketView;
  eventLog: EventLog;
  onCandle?: (ctx: SandboxContext, candle: Candle) => Promise<void> | void;
}

function iso(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

export class ReplayRunner {
  constructor(private readonly options: ReplayRunnerOptions) {}

  async run(): Promise<ReplaySummary> {
    const { runId, seed, configVersion, dataSnapshotId, clock, source, market, eventLog } =
      this.options;
    const context: SandboxContext = { runId, clock, market, log: eventLog, configVersion, seed };
    let candles = 0;
    let firstTime: number | null = null;
    let lastTime: number | null = null;
    let gaps = 0;
    const lastByKey = new Map<string, number>();

    await eventLog.append({
      runId,
      clockTime: iso(clock.now()),
      module: 'run',
      eventType: 'run.started',
      severity: 'info',
      inputs: { seed },
      dataSnapshotId,
      configVersion,
      seed,
    });

    try {
      for (;;) {
        const candle = source.next();
        if (!candle) break;
        if (candle.openTime < clock.now()) {
          await eventLog.append({
            runId,
            clockTime: iso(clock.now()),
            module: 'data',
            eventType: 'data.out_of_order',
            severity: 'error',
            tokenId: candle.tokenId,
            inputs: { candleOpenTime: iso(candle.openTime), clockTime: iso(clock.now()) },
            dataSnapshotId,
            configVersion,
            seed,
            reasonCode: 'DATA_OUT_OF_ORDER',
            reasonText: 'candle is older than the simulation clock',
          });
          throw new DataSourceOrderError();
        }
        const closeTime = candleCloseTime(candle);
        clock.advanceTo(closeTime);
        firstTime ??= candle.openTime;
        lastTime = candle.openTime;

        const key = `${candle.tokenId}|${candle.timeframe}`;
        const previous = lastByKey.get(key);
        const expected = TIMEFRAME_MS[candle.timeframe];
        if (previous !== undefined && expected !== undefined && candle.openTime - previous > expected) {
          gaps += 1;
          await eventLog.append({
            runId,
            clockTime: iso(closeTime),
            module: 'data',
            eventType: 'data.gap',
            severity: 'warn',
            tokenId: candle.tokenId,
            inputs: {
              timeframe: candle.timeframe,
              expectedMs: expected,
              actualMs: candle.openTime - previous,
              previousOpenTime: iso(previous),
            },
            dataSnapshotId,
            configVersion,
            seed,
            reasonCode: 'DATA_GAP',
            reasonText: 'missing candles between data points',
          });
        }
        lastByKey.set(key, candle.openTime);

        await eventLog.append({
          runId,
          clockTime: iso(closeTime),
          module: 'data',
          eventType: 'data.tick',
          severity: 'info',
          tokenId: candle.tokenId,
          inputs: {
            timeframe: candle.timeframe,
            openTime: iso(candle.openTime),
            closeTime: iso(closeTime),
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
            volumeUsd: candle.volumeUsd,
          },
          dataSnapshotId,
          configVersion,
          seed,
        });

        const started = performance.now();
        await this.options.onCandle?.(context, candle);
        await eventLog.append({
          runId,
          clockTime: iso(closeTime),
          module: 'run',
          eventType: 'cycle.completed',
          severity: 'debug',
          tokenId: candle.tokenId,
          timing: { durationMs: Math.round(performance.now() - started) },
          dataSnapshotId,
          configVersion,
          seed,
        });
        candles += 1;
      }
    } catch (error) {
      await eventLog.append({
        runId,
        clockTime: iso(clock.now()),
        module: 'run',
        eventType: 'run.failed',
        severity: 'error',
        inputs: { candles },
        dataSnapshotId,
        configVersion,
        seed,
        reasonCode: error instanceof DataSourceOrderError ? 'DATA_OUT_OF_ORDER' : 'HANDLER_ERROR',
        reasonText: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    await eventLog.append({
      runId,
      clockTime: iso(clock.now()),
      module: 'run',
      eventType: 'run.finished',
      severity: 'info',
      inputs: { candles, firstTime: firstTime === null ? null : iso(firstTime), lastTime: lastTime === null ? null : iso(lastTime), gaps },
      dataSnapshotId,
      configVersion,
      seed,
    });

    return {
      candles,
      firstTime,
      lastTime,
      gaps,
      eventCount: eventLog.events().length,
      eventHash: eventLog.hash(),
    };
  }
}
```

Update `packages/sandbox-core/src/index.ts` to export `./runner/context` and `./runner/replay-runner`.

- [ ] **Step 5: Run runner tests and typecheck**

Run:

```bash
npx pnpm@10.20.0 --filter @nexter/sandbox-core test -- src/runner
npx pnpm@10.20.0 --filter @nexter/sandbox-core typecheck
```

Expected: all tests pass; typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add packages/sandbox-core/src/runner packages/sandbox-core/src/index.ts
git commit -m "feat(sandbox): add chronological replay runner"
```

---

### Task 5: CLI replay driver and fixture

**Files:**
- Create: `packages/sandbox-core/src/cli/replay.ts`
- Create: `packages/sandbox-core/src/cli/main.ts`
- Create: `packages/sandbox-core/src/cli/replay.test.ts`
- Create: `packages/sandbox-core/src/fixtures/candles-1h.jsonl`

**Interfaces:**
- Consumes: all previous modules.
- Produces: `ReplayFromFileOptions`, `ReplayFromFileResult`, `runReplayFromFile`.

- [ ] **Step 1: Write the failing CLI test**

`packages/sandbox-core/src/cli/replay.test.ts`:

```ts
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runReplayFromFile } from './replay';

const candles = [
  { tokenId: 'btc', timeframe: '1h', openTime: '2026-01-01T00:00:00.000Z', open: '100', high: '101', low: '99', close: '100', volumeUsd: '10' },
  { tokenId: 'btc', timeframe: '1h', openTime: '2026-01-01T01:00:00.000Z', open: '100', high: '102', low: '100', close: '101', volumeUsd: '11' },
  { tokenId: 'btc', timeframe: '1h', openTime: '2026-01-01T02:00:00.000Z', open: '101', high: '103', low: '101', close: '102', volumeUsd: '12' },
];

describe('runReplayFromFile', () => {
  it('writes a deterministic event log and summary', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sandbox-'));
    const input = join(dir, 'candles.jsonl');
    const output1 = join(dir, 'events-1.jsonl');
    const output2 = join(dir, 'events-2.jsonl');
    await writeFile(input, candles.map((candle) => JSON.stringify(candle)).join('\n'));

    const one = await runReplayFromFile({ filePath: input, outputPath: output1, runId: 'run-1', seed: 7 });
    const two = await runReplayFromFile({ filePath: input, outputPath: output2, runId: 'run-1', seed: 7 });

    expect(one.candles).toBe(3);
    expect(one.eventCount).toBe(8);
    expect(one.eventHash).toBe(two.eventHash);
    expect(one.eventHash).toMatch(/^[a-f0-9]{64}$/);
    const lines = (await readFile(output1, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(8);
    expect(JSON.parse(lines[0] ?? '').eventType).toBe('run.started');
    expect(JSON.parse(lines.at(-1) ?? '').eventType).toBe('run.finished');
  });

  it('rejects an empty file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sandbox-'));
    const input = join(dir, 'empty.jsonl');
    await writeFile(input, '');
    await expect(
      runReplayFromFile({ filePath: input, outputPath: join(dir, 'events.jsonl'), runId: 'run-1', seed: 7 }),
    ).rejects.toThrow(/no candles/i);
  });
});
```

- [ ] **Step 2: Run the CLI test and verify it fails**

Run: `npx pnpm@10.20.0 --filter @nexter/sandbox-core test -- src/cli`
Expected: FAIL because `./replay` does not exist.

- [ ] **Step 3: Implement the CLI driver**

`packages/sandbox-core/src/cli/replay.ts`:

```ts
import { SimulationClock } from '../clock';
import { ArrayCandleSource } from '../data/array-candle-source';
import { loadJsonlCandles } from '../data/jsonl-candles';
import { ClockedMarketView } from '../data/market-view';
import { snapshotCandles } from '../data/snapshot';
import { configVersion } from '../config';
import { JsonlEventLog } from '../events/jsonl-event-log';
import { ReplayRunner } from '../runner/replay-runner';
import type { ReplaySummary } from '../runner/context';
import { candleCloseTime } from '../timeframes';
import type { RunConfig } from '../types';

export interface ReplayFromFileOptions {
  filePath: string;
  outputPath: string;
  runId: string;
  seed: number;
  timeframe?: string;
}

export interface ReplayFromFileResult extends ReplaySummary {
  outputPath: string;
  configVersion: string;
  dataSnapshotId: string;
}

export async function runReplayFromFile(
  options: ReplayFromFileOptions,
): Promise<ReplayFromFileResult> {
  const candles = await loadJsonlCandles(options.filePath);
  if (candles.length === 0) throw new Error('No candles found');
  const source = new ArrayCandleSource(candles);
  const snapshot = snapshotCandles(source.candles);
  const first = snapshot.candles[0];
  if (!first) throw new Error('No candles found');
  const clock = new SimulationClock(candleCloseTime(first));
  const market = new ClockedMarketView(snapshot.candles, clock, snapshot.id);
  const config: RunConfig = {
    runId: options.runId,
    seed: options.seed,
    timeframe: options.timeframe ?? snapshot.candles[0]?.timeframe ?? '1h',
    tokenIds: [...new Set(snapshot.candles.map((candle) => candle.tokenId))],
    initialCapitalUsd: '1000',
    feeBps: 25,
    slippageBps: 10,
  };
  const version = configVersion(config);
  const log = await JsonlEventLog.open(options.outputPath);
  const runner = new ReplayRunner({
    runId: config.runId,
    seed: config.seed,
    configVersion: version,
    dataSnapshotId: snapshot.id,
    clock,
    source,
    market,
    eventLog: log,
  });
  const summary = await runner.run();
  await log.close();
  return { ...summary, outputPath: options.outputPath, configVersion: version, dataSnapshotId: snapshot.id };
}
```

`src/cli/replay.ts` exports only `runReplayFromFile`; it has no side effects and is safe to import in tests.

`packages/sandbox-core/src/cli/main.ts`:

```ts
import { runReplayFromFile } from './replay';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const read = (name: string): string | undefined => {
    const index = args.indexOf(name);
    return index === -1 ? undefined : args[index + 1];
  };
  const filePath = read('--file');
  if (!filePath) {
    throw new Error('Usage: replay --file <candles.jsonl> [--out events.jsonl] [--run-id id] [--seed 7]');
  }
  const runId = read('--run-id') ?? `sandbox-${Date.now()}`;
  const seed = Number(read('--seed') ?? 7);
  const outputPath = read('--out') ?? `sandbox-events-${runId}.jsonl`;
  const result = await runReplayFromFile({ filePath, outputPath, runId, seed });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
```

- [ ] **Step 4: Add a small fixture**

`packages/sandbox-core/src/fixtures/candles-1h.jsonl`:

```jsonl
{"tokenId":"btc","timeframe":"1h","openTime":"2026-01-01T00:00:00.000Z","open":"100","high":"101","low":"99","close":"100","volumeUsd":"10"}
{"tokenId":"btc","timeframe":"1h","openTime":"2026-01-01T01:00:00.000Z","open":"100","high":"102","low":"100","close":"101","volumeUsd":"11"}
{"tokenId":"btc","timeframe":"1h","openTime":"2026-01-01T02:00:00.000Z","open":"101","high":"103","low":"101","close":"102","volumeUsd":"12"}
```

- [ ] **Step 5: Run Task 5 tests, typecheck and a CLI smoke**

Run:

```bash
npx pnpm@10.20.0 --filter @nexter/sandbox-core test -- src/cli
npx pnpm@10.20.0 --filter @nexter/sandbox-core typecheck
npx pnpm@10.20.0 --filter @nexter/sandbox-core replay -- --file src/fixtures/candles-1h.jsonl --out sandbox-events.jsonl
```

Expected: tests pass; typecheck exits 0; CLI prints a summary with `candles: 3`, `eventCount: 8`, a 64-char `eventHash`. The generated `sandbox-events.jsonl` is a temporary artifact; do not commit it unless the review packet needs a small sample.

- [ ] **Step 6: Commit**

```bash
git add packages/sandbox-core/src/cli packages/sandbox-core/src/fixtures
git commit -m "feat(sandbox): add historical replay CLI"
```

---

### Task 6: Stage 1A review packet and gate

**Files:**
- Create: `docs/reviews/2026-11-23-sandbox-stage-1a-review-request.md`
- Optionally create: `docs/reviews/artifacts/sandbox-stage-1a-events.jsonl` (sample output, if small)

**Interfaces:**
- No code interfaces. This task prepares the independent review gate.

- [ ] **Step 1: Run the full checks**

Run:

```bash
npx pnpm@10.20.0 --filter @nexter/sandbox-core test
npx pnpm@10.20.0 --filter @nexter/sandbox-core typecheck
npx pnpm@10.20.0 lint
npx pnpm@10.20.0 format:check
```

Expected: all pass. If `format:check` fails, run `npx pnpm@10.20.0 format`, re-run, and include the formatting changes in the commit.

- [ ] **Step 2: Produce the review packet**

Create `docs/reviews/2026-11-23-sandbox-stage-1a-review-request.md` with:

- scope: Stage 1A only;
- files changed;
- exact commands and expected outputs;
- checklist:
  - no imports from old AI/legacy/apps;
  - clock monotonic; backwards/NaN rejected;
  - candles sorted/validated; duplicates rejected;
  - market view at a candle's open time does not expose that candle; at its close time it does;
  - the next candle is not exposed until its own close;
  - handler look-ahead test passes; `data.tick` clockTime is the candle close time;
  - gaps logged; out-of-order source fails with a log;
  - event schema requires `reasonCode` for decision/rejection/failure events;
  - hash excludes wall-clock `recordedAt` and `timing`; same decision inputs = same hash;
  - JSONL round-trip; CLI smoke output has 8 events and a 64-char hash;
  - empty CLI file rejected;
  - tests/typecheck/lint/format pass;
  - no UI/live/real money/strategies/portfolio/execution in Stage 1A.
- evidence:
  - test summary output;
  - sample first/last event lines;
  - summary JSON from the CLI;
  - event hash.
- review outcome template: findings by severity, sign-off, list of open critical/major findings.
- explicit gate: **Stage 1B must not start until the review is signed off.**

- [ ] **Step 3: Commit the review packet**

```bash
git add docs/reviews/2026-11-23-sandbox-stage-1a-review-request.md
git commit -m "docs(sandbox): add stage 1a review request"
```

- [ ] **Step 4: Stop for independent review**

Do not start Stage 1B. Hand the review packet to an independent reviewer (agent and/or owner). The reviewer does not edit code. Fix critical/major findings and re-run the gate before Stage 1B.

---

## Plan self-review

- **Spec coverage:** Stage 1A items (clock, data source, snapshot, market view, look-ahead guard, event schema/log, replay runner, CLI smoke, review gate) are covered. Stage 1B/C are intentionally separate plans.
- **Review Focus:** each failure mode has a test in Tasks 1–5: future data (Task 4), order/duplicates/empty (Tasks 1, 2, 4), gaps/timestamps (Task 4), log completeness/determinism (Task 3), failures/partial logs (Tasks 4, 5).
- **Type consistency:** `Candle`, `Timestamp`, `Clock`, `MarketView`, `CandleSource`, `EventLog`, `ReplayRunnerOptions`, `ReplaySummary` are defined once and reused.
- **Proportion:** this plan defines interfaces, tests and exact files; it does not transcribe the whole implementation. The engineer writes the bodies.
