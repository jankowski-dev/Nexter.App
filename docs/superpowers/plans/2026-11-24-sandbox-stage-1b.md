# Sandbox Stage 1B — Decision Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the deterministic decision layer of the `Песочница` sandbox: regime classification, three long-only strategy families, opportunity ranking, portfolio allocation, hard risk veto and a complete decision event log. Stage 1B produces `OrderIntent`s only; it never fills, books or reports.

**Architecture:** New `src/decision/` module inside `@nexter/sandbox-core`. A pure per-bar `DecisionEngine.decide(input)` reads closed candles through the Stage 1A `MarketView`, evaluates each token's regime and strategy, ranks buy candidates, allocates size, applies risk vetoes, appends structured events to the existing hash-chained `EventLog`, and returns intents plus the next engine state. No persistence, no fills, no UI, no live data.

**Tech Stack:** TypeScript strict, Node.js, Zod 4, decimal.js 10.6.0, Vitest.

**Design:** `docs/superpowers/specs/2026-11-24-sandbox-stage-1b-decision-engine-design.md`

**Base:** Stage 1A merged as `28176d1`; Stage 1A design `docs/superpowers/specs/2026-11-23-sandbox-core-replay-design.md` is signed off.

**Status:** approved in principle under owner pre-approval; implementation not started.

## Global Constraints

- Stage 1B only: no fills, fees, ledger, equity computation, P&L report, UI, HTTP, DB, live data, real money, wallets, signing or execution. Stage 1C stays blocked until Stage 1B is signed off.
- Work only inside `packages/sandbox-core` plus docs. Do not modify `apps/api` or old AI/legacy modules.
- No imports from `apps/*`, `@nexter/ai-trading`, `trading-bots`, or old search code.
- TypeScript strict; no `any` in public APIs.
- Money is always a decimal string. Use `decimal.js` for every money computation. Native numbers are allowed only for indicators, regime classification and ranking scores, as the design permits; convert to a decimal string before it becomes an order size or a logged money value.
- Never use `localeCompare` or default-locale sorting; all string ordering is UTF-16 code-unit ordering.
- Determinism: same candles + same settings + same state + same seed = same intents and same final event hash. No wall-clock value may enter a decision.
- Every event that carries a `decision` object must have a stable `reasonCode` and at least one `alternative`. Every risk check is logged with value, limit and pass/fail.
- Look-ahead is forbidden: read candles only through `MarketView`; the engine never receives raw future candles.
- The engine never mutates its inputs. It returns the next `EngineState`; the host owns persistence and fills.
- An open position is always evaluated with its original strategy, in every regime.
- No new schema or migration.
- Run commands with `npx pnpm@10.20.0` from the repo root.
- TDD: write failing tests first. Each task must leave package tests, typecheck, build, eslint and prettier green.

## Review Focus

These are the failure modes most likely to make the decision layer untrustworthy. Each has a test in the owning task.

1. **Regime flapping or mis-priority** — CRASH/ILLIQUID must win immediately, other regimes need dwell, recovery needs confirmation. Tested in Task 3.
2. **Stranded positions** — a regime switch must never stop an open position's original strategy from producing an exit. Tested in Tasks 4 and 7.
3. **Risk invariant breach** — no buy intent may exceed token/strategy/cash/risk/liquidity limits, and no sell may be blocked by daily loss or drawdown. Tested in Tasks 5, 6 and 7.
4. **Non-determinism** — float money, locale ordering, caller token order or wall-clock values changing intents/hashes. Tested in Tasks 2, 5 and 7, golden-pinned in Task 8.
5. **Incomplete audit** — a decision without a reason or alternative, a risk check without value/limit, a missing intent event. Tested in Task 7.

---

## File Structure

```
packages/sandbox-core/
  tsconfig.json                        (exclude *.test-helpers.ts)
  package.json                         (+ decimal.js)
  src/
    index.ts                           (+ ./decision)
    decision/
      index.ts
      types.ts
      defaults.ts
      reason-codes.ts
      decimal.ts
      indicators.ts
      regime-classifier.ts
      strategies/
        index.ts
        trend-pullback.ts
        range-reversion.ts
        recovery.ts
      opportunity-ranker.ts
      portfolio-allocator.ts
      risk-manager.ts
      token-state.ts
      decision-logger.ts
      decision-engine.ts
      fixtures.test-helpers.ts
    util/json-value.ts                 (Task 1)
```

Tests are co-located as `*.test.ts` next to the code. Shared deterministic candle builders live in `decision/fixtures.test-helpers.ts` and are excluded from the package build.

---

### Task 1: Close the Stage 1A debt

**Files:**

- Modify: `packages/sandbox-core/src/data/candles.ts`
- Modify: `packages/sandbox-core/src/data/candles.test.ts`
- Modify: `packages/sandbox-core/src/runner/replay-runner.ts`
- Modify: `packages/sandbox-core/src/runner/replay-runner.test.ts`
- Modify: `packages/sandbox-core/src/cli/replay.ts`
- Modify: `packages/sandbox-core/src/cli/main.ts`
- Modify: `packages/sandbox-core/src/cli/replay.test.ts`
- Create: `packages/sandbox-core/src/util/json-value.ts`
- Create: `packages/sandbox-core/src/util/json-value.test.ts`
- Modify: `packages/sandbox-core/src/events/memory-event-log.ts`
- Modify: `packages/sandbox-core/src/events/event-schema.ts`
- Modify: `packages/sandbox-core/src/events/event-log.test.ts`
- Modify: `.gitignore`

The Stage 1A final review triaged these as first-Stage-1B items. Close all of them here so the decision layer starts from a clean foundation.

- [ ] **Step 1: Prices must be positive, volume non-negative**

In `candles.ts`, replace the single `DECIMAL` regex validation with:

```ts
const NON_NEGATIVE_DECIMAL = /^\d+(\.\d+)?$/;

function assertPrice(value: string, field: string): void {
  if (!NON_NEGATIVE_DECIMAL.test(value) || Number(value) <= 0) {
    throw new CandleValidationError(`${field} must be a positive decimal string`);
  }
}

function assertVolume(value: string): void {
  if (!NON_NEGATIVE_DECIMAL.test(value)) {
    throw new CandleValidationError('volumeUsd must be a non-negative decimal string');
  }
}
```

Use `assertPrice` for `open`, `high`, `low`, `close` and `assertVolume` for `volumeUsd`. Add tests: `-1` price rejected, `0` price rejected, `0` volume accepted, `-0.1` volume rejected.

- [ ] **Step 2: Distinguish data-source failures from handler failures**

In `replay-runner.ts`:

```ts
export class DataSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataSourceError';
  }
}
```

Wrap `source.next()` and `candleCloseTime(candle)` so their throws become `DataSourceError`. In the outer catch classify:

```ts
const reasonCode =
  error instanceof DataSourceOrderError
    ? 'DATA_OUT_OF_ORDER'
    : error instanceof DataSourceError
      ? 'DATA_SOURCE_ERROR'
      : 'HANDLER_ERROR';
```

Test: a `CandleSource` whose `next()` throws produces a final `run.failed` event with `reasonCode: 'DATA_SOURCE_ERROR'` and the original error is rethrown.

- [ ] **Step 3: Complete the out-of-order payload**

Add `candleCloseTime: iso(closeTime)` and `timeframe: candle.timeframe` to the `data.out_of_order` inputs. Test that both keys are present.

- [ ] **Step 4: Always close the CLI log**

In `replay.ts`, wrap the runner call:

```ts
const log = await JsonlEventLog.open(options.outputPath);
try {
  const summary = await runner.run();
  return {
    ...summary,
    outputPath: options.outputPath,
    configVersion: version,
    dataSnapshotId: snapshot.id,
  };
} finally {
  await log.close();
}
```

- [ ] **Step 5: Reject mixed timeframes and use the first candle's timeframe**

In `runReplayFromFile`, after loading candles:

```ts
const timeframes = [...new Set(candles.map((candle) => candle.timeframe))];
if (timeframes.length > 1) {
  throw new Error(`Mixed timeframes are not supported: ${timeframes.join(', ')}`);
}
```

Then set `timeframe: first.timeframe` in the `RunConfig` and remove the decorative `options.timeframe ?? ... ?? '1h'` chain. Test: a two-timeframe JSONL file rejects with `/Mixed timeframes/`.

- [ ] **Step 6: Harden the CLI**

In `main.ts`:

- `read(name)` returns `undefined` when the following token is missing or starts with `--`.
- Parse `--seed` with `Number`, require `Number.isSafeInteger(parsed)` and throw the usage string on failure.
- Default output path is `out/sandbox-events-${runId}.jsonl` (package-relative `out/`).
- Add `packages/sandbox-core/out/` to `.gitignore`.

Tests are optional for argv parsing; if practical, export a pure `parseArgs(argv): ReplayArgs` from `main.ts`? Keep `main.ts` as the side-effect entrypoint and put `parseReplayArgs(argv)` in `replay.ts`, tested there:

```ts
export interface ReplayArgs {
  filePath: string;
  outputPath: string;
  runId: string;
  seed: number;
}
export function parseReplayArgs(argv: readonly string[]): ReplayArgs;
```

`parseReplayArgs` must skip a literal `--` inserted by pnpm, reject a flag-as-value, reject a non-integer seed, and default the output to `out/sandbox-events-${runId}.jsonl`. `main.ts` calls it and passes the result to `runReplayFromFile`.

- [ ] **Step 7: Reject non-JSON event payloads**

Create `util/json-value.ts`:

```ts
export class NonJsonValueError extends Error {
  constructor(path: string, detail: string) {
    super(`Non-JSON value at ${path}: ${detail}`);
    this.name = 'NonJsonValueError';
  }
}

export function assertJsonValue(value: unknown, path = '$'): void;
```

Rules:

- `null`, `boolean`, `string` allowed;
- `number` allowed only when `Number.isFinite`;
- `undefined` is allowed and normalizes to `null` in the canonical serializer; do not reject it, because Stage 1A round-trip behaviour depends on it;
- arrays allowed, recursively walked;
- plain objects only (`Object.getPrototypeOf(value) === Object.prototype || null`), recursively walked; reject `Date`, `Map`, `Set`, class instances, functions, symbols, bigints;
- reject circular references with a `WeakSet`.

Call `assertJsonValue` in `MemoryEventLog.buildEvent` for `parsed.inputs`, `stateBefore`, `stateAfter` and `timing` before hashing. Tests: a nested plain object passes; `new Date()` in `inputs` throws `NonJsonValueError`; a function throws; a circular object throws.

- [ ] **Step 8: Extend the reason-code event families**

In `event-schema.ts`, extend the decision-like family regex:

```ts
/^(signal|order|position|strategy|risk|regime|opportunity|portfolio|token|decision)\./;
```

Tests: `regime.changed`, `opportunity.ranked`, `portfolio.allocated`, `token.state_changed` and `decision.cycle` without `reasonCode` are rejected; the same events with a `reasonCode` are accepted.

- [ ] **Step 9: Verify and commit**

```bash
npx pnpm@10.20.0 --filter @nexter/sandbox-core test
npx pnpm@10.20.0 --filter @nexter/sandbox-core typecheck
npx pnpm@10.20.0 --filter @nexter/sandbox-core build
npx eslint packages/sandbox-core
npx prettier --check "packages/sandbox-core/src/**/*.ts"
git add -A packages/sandbox-core .gitignore
git commit -m "fix(sandbox): close stage 1a debt before decision engine"
```

---

### Task 2: Decision domain, settings, reason codes, decimal math and indicators

**Files:**

- Modify: `packages/sandbox-core/package.json` (add `decimal.js` 10.6.0)
- Modify: `pnpm-lock.yaml` (via `pnpm install`)
- Modify: `packages/sandbox-core/tsconfig.json` (exclude `src/**/*.test-helpers.ts`)
- Modify: `packages/sandbox-core/src/index.ts` (append `export * from './decision';`)
- Create: `packages/sandbox-core/src/decision/index.ts`
- Create: `packages/sandbox-core/src/decision/types.ts`
- Create: `packages/sandbox-core/src/decision/reason-codes.ts`
- Create: `packages/sandbox-core/src/decision/defaults.ts`
- Create: `packages/sandbox-core/src/decision/defaults.test.ts`
- Create: `packages/sandbox-core/src/decision/decimal.ts`
- Create: `packages/sandbox-core/src/decision/decimal.test.ts`
- Create: `packages/sandbox-core/src/decision/indicators.ts`
- Create: `packages/sandbox-core/src/decision/indicators.test.ts`
- Create: `packages/sandbox-core/src/decision/fixtures.test-helpers.ts`

**Produces:** every shared Stage 1B type, the approved defaults, stable reason codes, decimal helpers, indicator helpers and deterministic candle builders. Later tasks must not redefine these.

- [ ] **Step 1: Add the dependency**

```bash
npx pnpm@10.20.0 --filter @nexter/sandbox-core add decimal.js@10.6.0
```

The package becomes dependent on `decimal.js` only; no other dependency changes. Commit the updated `pnpm-lock.yaml`.

- [ ] **Step 2: Define the decision types**

`types.ts` must contain exactly these public shapes (comments may be added):

```ts
import type { Candle, Timestamp } from '../types';
import type { MarketView } from '../data/market-view';
import type { ReasonCode } from './reason-codes';

export type Regime =
  'TREND_UP' | 'TREND_DOWN' | 'RANGE' | 'CRASH' | 'RECOVERY' | 'ILLIQUID' | 'UNKNOWN';

export type StrategyKey = 'trend_pullback' | 'range_reversion' | 'recovery';
export type TokenPhase = 'SLEEPING' | 'ARMED' | 'IN_POSITION' | 'COOLDOWN' | 'BLOCKED';
export type SignalAction = 'buy' | 'sell' | 'hold';
export type IntentSide = 'buy' | 'sell';

export interface RegimeFeatures {
  readonly bars: number;
  readonly lastClose: string | null;
  readonly fastSma: string | null;
  readonly slowSma: string | null;
  readonly longSma: string | null;
  readonly atrPct: string | null;
  readonly recentHigh: string | null;
  readonly recentLow: string | null;
  readonly avgVolumeUsd: string | null;
  readonly drawdownPct: string | null;
  readonly staleBars: number;
}

export interface RegimeState {
  readonly regime: Regime;
  readonly reasonCode: ReasonCode;
  readonly candidate: Regime | null;
  readonly candidateBars: number;
  readonly since: Timestamp;
  readonly rulesVersion: string;
  readonly features: RegimeFeatures;
}

export interface PortfolioPosition {
  readonly tokenId: string;
  readonly strategyKey: StrategyKey;
  readonly strategyVersion: number;
  readonly amount: string;
  readonly avgCostUsd: string;
  readonly marketPriceUsd: string;
  readonly marketValueUsd: string;
  readonly openedAt: Timestamp;
  readonly stopLossPct: string | null;
  readonly takeProfitPct: string | null;
}

export interface PortfolioSnapshot {
  readonly equityUsd: string;
  readonly cashUsd: string;
  readonly dayStartEquityUsd: string;
  readonly peakEquityUsd: string;
  readonly positions: readonly PortfolioPosition[];
}

export interface TokenRuntimeState {
  readonly tokenId: string;
  readonly regime: RegimeState;
  readonly phase: TokenPhase;
  readonly cooldownUntil: Timestamp | null;
  readonly strategyState: Readonly<Record<string, unknown>>;
}

export interface EngineState {
  readonly tokens: Readonly<Record<string, TokenRuntimeState>>;
}

export interface OrderIntent {
  readonly intentId: string;
  readonly tokenId: string;
  readonly side: IntentSide;
  readonly strategyKey: StrategyKey;
  readonly strategyVersion: number;
  readonly reasonCode: ReasonCode;
  readonly sizeUsd: string;
  readonly amount: string | null;
  readonly stopLossPct: string | null;
  readonly takeProfitPct: string | null;
  readonly decisionPriceUsd: string;
  readonly clockTime: Timestamp;
}

export interface TokenStateView {
  readonly tokenId: string;
  readonly phase: TokenPhase;
  readonly reasonCode: ReasonCode;
}

export interface DecisionInput {
  readonly runId: string;
  readonly seed: number;
  readonly configVersion: string;
  readonly dataSnapshotId: string;
  readonly clockTime: Timestamp;
  readonly tokenIds: readonly string[];
  readonly market: MarketView;
  readonly portfolio: PortfolioSnapshot;
  readonly state: EngineState;
  readonly settings: SandboxDecisionSettings;
}

export interface DecisionResult {
  readonly clockTime: Timestamp;
  readonly intents: readonly OrderIntent[];
  readonly tokenViews: readonly TokenStateView[];
  readonly state: EngineState;
  readonly eventCount: number;
  readonly eventHash: string;
}

export interface TrendPullbackParams {
  readonly fastPeriod: number;
  readonly slowPeriod: number;
  readonly pullbackPct: number;
  readonly atrStopMult: number;
  readonly trailActivationPct: number;
  readonly trailPct: number;
}

export interface RangeReversionParams {
  readonly lookback: number;
  readonly bandAtrMult: number;
  readonly stopAtrMult: number;
}

export interface RecoveryParams {
  readonly fastPeriod: number;
  readonly confirmBars: number;
  readonly stopPct: number;
  readonly riskWeight: number;
}

export interface StrategySettings {
  readonly trendPullback: TrendPullbackParams;
  readonly rangeReversion: RangeReversionParams;
  readonly recovery: RecoveryParams;
}

export interface RegimeSettings {
  readonly fastHours: number;
  readonly slowHours: number;
  readonly longHours: number;
  readonly atrPeriod: number;
  readonly rangeWindowHours: number;
  readonly liquidityWindowHours: number;
  readonly trendSpreadPct: number;
  readonly trendMaxAtrPct: number;
  readonly rangeSpreadPct: number;
  readonly rangeMaxAtrPct: number;
  readonly crashDrawdownPct: number;
  readonly crashAtrPct: number;
  readonly recoveryConfirmBars: number;
  readonly regimeDwellBars: number;
  readonly minLiquidityUsd: string;
}

export interface SandboxDecisionSettings {
  readonly timeframe: string;
  readonly maxPositions: number;
  readonly maxTokenExposurePct: number;
  readonly maxStrategyExposurePct: number;
  readonly cashBufferPct: number;
  readonly dailyLossLimitPct: number;
  readonly maxDrawdownPct: number;
  readonly perTradeRiskPct: number;
  readonly minOrderUsd: string;
  readonly liquidityCapPct: number;
  readonly defaultStopPct: number;
  readonly regime: RegimeSettings;
  readonly strategies: StrategySettings;
}
```

- [ ] **Step 3: Define the reason codes**

`reason-codes.ts` is a single frozen object plus a derived union:

```ts
export const Reason = {
  DECISION_CYCLE: 'DECISION_CYCLE',
  DECISION_CYCLE_COMPLETED: 'DECISION_CYCLE_COMPLETED',

  REGIME_INSUFFICIENT_HISTORY: 'REGIME_INSUFFICIENT_HISTORY',
  REGIME_STALE_DATA: 'REGIME_STALE_DATA',
  REGIME_LOW_LIQUIDITY: 'REGIME_LOW_LIQUIDITY',
  REGIME_TREND_UP: 'REGIME_TREND_UP',
  REGIME_TREND_DOWN: 'REGIME_TREND_DOWN',
  REGIME_RANGE: 'REGIME_RANGE',
  REGIME_CRASH: 'REGIME_CRASH',
  REGIME_RECOVERY: 'REGIME_RECOVERY',
  REGIME_UNKNOWN: 'REGIME_UNKNOWN',
  REGIME_HELD: 'REGIME_HELD',
  REGIME_CHANGED: 'REGIME_CHANGED',

  STRATEGY_SELECTED_BY_REGIME: 'STRATEGY_SELECTED_BY_REGIME',
  STRATEGY_ORIGINAL_POSITION: 'STRATEGY_ORIGINAL_POSITION',
  STRATEGY_NOT_ELIGIBLE: 'STRATEGY_NOT_ELIGIBLE',
  STRATEGY_NO_DATA: 'STRATEGY_NO_DATA',
  STRATEGY_BUY_WITH_POSITION: 'STRATEGY_BUY_WITH_POSITION',
  STRATEGY_UNKNOWN_KEY: 'STRATEGY_UNKNOWN_KEY',

  TREND_PULLBACK_ENTRY: 'TREND_PULLBACK_ENTRY',
  TREND_PULLBACK_HOLD: 'TREND_PULLBACK_HOLD',
  TREND_PULLBACK_STOP: 'TREND_PULLBACK_STOP',
  TREND_PULLBACK_TREND_BREAK: 'TREND_PULLBACK_TREND_BREAK',
  TREND_PULLBACK_TRAIL: 'TREND_PULLBACK_TRAIL',

  RANGE_REVERSION_ENTRY: 'RANGE_REVERSION_ENTRY',
  RANGE_REVERSION_HOLD: 'RANGE_REVERSION_HOLD',
  RANGE_REVERSION_STOP: 'RANGE_REVERSION_STOP',
  RANGE_REVERSION_MID: 'RANGE_REVERSION_MID',

  RECOVERY_ENTRY: 'RECOVERY_ENTRY',
  RECOVERY_HOLD: 'RECOVERY_HOLD',
  RECOVERY_CONFIRMING: 'RECOVERY_CONFIRMING',
  RECOVERY_STOP: 'RECOVERY_STOP',
  RECOVERY_TREND_BREAK: 'RECOVERY_TREND_BREAK',

  RANK_SELECTED: 'RANK_SELECTED',
  RANK_ILLIQUID: 'RANK_ILLIQUID',
  RANK_NO_DATA: 'RANK_NO_DATA',
  RANK_LOWER_PRIORITY: 'RANK_LOWER_PRIORITY',
  RANK_NO_ALTERNATIVE: 'RANK_NO_ALTERNATIVE',

  ALLOC_SELECTED: 'ALLOC_SELECTED',
  ALLOC_EXISTING_POSITION: 'ALLOC_EXISTING_POSITION',
  ALLOC_MAX_POSITIONS: 'ALLOC_MAX_POSITIONS',
  ALLOC_TOKEN_CAP: 'ALLOC_TOKEN_CAP',
  ALLOC_STRATEGY_CAP: 'ALLOC_STRATEGY_CAP',
  ALLOC_CASH_BUFFER: 'ALLOC_CASH_BUFFER',
  ALLOC_RISK_CAP: 'ALLOC_RISK_CAP',
  ALLOC_LIQUIDITY_CAP: 'ALLOC_LIQUIDITY_CAP',
  ALLOC_SIZE_TOO_SMALL: 'ALLOC_SIZE_TOO_SMALL',
  ALLOC_INVALID_STOP: 'ALLOC_INVALID_STOP',
  ALLOC_NO_ALTERNATIVE: 'ALLOC_NO_ALTERNATIVE',

  RISK_PASSED: 'RISK_PASSED',
  RISK_HOLD: 'RISK_HOLD',
  RISK_MAX_POSITIONS: 'RISK_MAX_POSITIONS',
  RISK_TOKEN_EXPOSURE: 'RISK_TOKEN_EXPOSURE',
  RISK_STRATEGY_EXPOSURE: 'RISK_STRATEGY_EXPOSURE',
  RISK_CASH_BUFFER: 'RISK_CASH_BUFFER',
  RISK_DAILY_LOSS: 'RISK_DAILY_LOSS',
  RISK_MAX_DRAWDOWN: 'RISK_MAX_DRAWDOWN',
  RISK_PER_TRADE: 'RISK_PER_TRADE',
  RISK_LIQUIDITY: 'RISK_LIQUIDITY',
  RISK_DATA_STALE: 'RISK_DATA_STALE',
  RISK_COOLDOWN: 'RISK_COOLDOWN',
  RISK_TOKEN_BLOCKED: 'RISK_TOKEN_BLOCKED',
  RISK_SIZE_TOO_SMALL: 'RISK_SIZE_TOO_SMALL',

  INTENT_NO_ALTERNATIVE: 'INTENT_NO_ALTERNATIVE',

  TOKEN_SLEEPING: 'TOKEN_SLEEPING',
  TOKEN_ARMED: 'TOKEN_ARMED',
  TOKEN_IN_POSITION: 'TOKEN_IN_POSITION',
  TOKEN_COOLDOWN: 'TOKEN_COOLDOWN',
  TOKEN_BLOCKED: 'TOKEN_BLOCKED',
} as const;

export type ReasonCode = (typeof Reason)[keyof typeof Reason];
```

Test that every value of `Reason` is unique.

- [ ] **Step 4: Define the approved defaults**

`defaults.ts`:

```ts
import { sha256Hex, stableStringify } from '../util/hash';
import type {
  EngineState,
  RegimeSettings,
  SandboxDecisionSettings,
  StrategySettings,
} from './types';

export const DECISION_ENGINE_VERSION = 'decision-engine-v1';
export const REGIME_RULES_VERSION = 'regime-rules-v1';

export const DEFAULT_STRATEGY_SETTINGS: StrategySettings = {
  trendPullback: {
    fastPeriod: 24,
    slowPeriod: 168,
    pullbackPct: 2,
    atrStopMult: 2.5,
    trailActivationPct: 5,
    trailPct: 5,
  },
  rangeReversion: { lookback: 72, bandAtrMult: 1.5, stopAtrMult: 2 },
  recovery: { fastPeriod: 24, confirmBars: 3, stopPct: 3, riskWeight: 0.5 },
};

export const DEFAULT_REGIME_SETTINGS: RegimeSettings = {
  fastHours: 24,
  slowHours: 168,
  longHours: 720,
  atrPeriod: 14,
  rangeWindowHours: 72,
  liquidityWindowHours: 24,
  trendSpreadPct: 0.5,
  trendMaxAtrPct: 8,
  rangeSpreadPct: 0.75,
  rangeMaxAtrPct: 3.5,
  crashDrawdownPct: 12,
  crashAtrPct: 10,
  recoveryConfirmBars: 3,
  regimeDwellBars: 3,
  minLiquidityUsd: '50000',
};

export const DEFAULT_SETTINGS: SandboxDecisionSettings = {
  timeframe: '1h',
  maxPositions: 5,
  maxTokenExposurePct: 20,
  maxStrategyExposurePct: 40,
  cashBufferPct: 10,
  dailyLossLimitPct: 2,
  maxDrawdownPct: 15,
  perTradeRiskPct: 1,
  minOrderUsd: '10',
  liquidityCapPct: 1,
  defaultStopPct: 3,
  regime: DEFAULT_REGIME_SETTINGS,
  strategies: DEFAULT_STRATEGY_SETTINGS,
};

export function settingsVersion(settings: SandboxDecisionSettings): string {
  return sha256Hex(stableStringify(settings));
}

export const EMPTY_ENGINE_STATE: EngineState = { tokens: {} };
```

Tests: defaults match the design table exactly; `settingsVersion` is stable across two calls; changing one setting changes the hash; two objects with a different key insertion order hash the same.

- [ ] **Step 5: Decimal helpers**

`decimal.ts` wraps decimal.js:

```ts
import Decimal from 'decimal.js';

const DECIMAL = /^\d+(\.\d+)?$/;

export class DecimalInputError extends Error {}
export function toDecimal(value: string, label: string): Decimal;
export function money(value: Decimal): string; // toFixed(2)
export function percent(value: Decimal): string; // toFixed(2)
export function minDecimal(...values: Decimal[]): Decimal;
export function maxDecimal(...values: Decimal[]): Decimal;
```

Rules:

- `toDecimal` rejects anything that is not a non-negative decimal string, including `NaN`, `Infinity`, `1e3`, `+1`, leading/trailing spaces; throw `DecimalInputError` with the label.
- `money`/`percent` use `toFixed(2)`.
- Set `Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP })` once at module load; tests pin `0.1 + 0.2` style results and a high-precision division.

- [ ] **Step 6: Indicators**

`indicators.ts` operates on closed candles and returns native numbers (allowed by the design) plus stable decimal strings for logging:

```ts
export function closes(candles: readonly Candle[]): number[];
export function sma(values: readonly number[], period: number): number | null;
export function smaSeries(values: readonly number[], period: number): Array<number | null>;
export function atrPct(candles: readonly Candle[], period: number): number | null;
export function highestHigh(candles: readonly Candle[], period: number): number | null;
export function lowestLow(candles: readonly Candle[], period: number): number | null;
export function averageVolumeUsd(candles: readonly Candle[], period: number): number | null;
export function drawdownPct(candles: readonly Candle[], period: number): number | null;
export function formatPct(value: number): string; // toFixed(2)
export function formatUsd(value: number): string; // toFixed(2)
export function numeric(value: unknown): number | null; // state reader: finite number only
```

Definitions:

- `sma`: arithmetic mean of the last `period` values; `null` when `values.length < period` or `period <= 0`.
- `smaSeries`: index-aligned array; entries before `period - 1` are `null`.
- `atrPct`: true range `max(high-low, |high-prevClose|, |low-prevClose|)` averaged over the last `period` true ranges (simple average, not Wilder); result `(atr / lastClose) * 100`; `null` when fewer than `period + 1` candles or lastClose is not positive.
- `highestHigh` / `lowestLow`: over the last `period` candles.
- `averageVolumeUsd`: arithmetic mean of the `volumeUsd` numbers over the last `period` candles.
- `drawdownPct`: `(maxHigh(period) - lastClose) / maxHigh(period) * 100`, never below 0.
- All functions ignore nothing; they use the last N closed candles the caller passes.

Tests use hand-computed values (e.g. closes `[1,2,3,4]`, `sma(...,2) === 3.5`; a known 3-candle ATR; drawdown 20% for high 100 → close 80).

- [ ] **Step 7: Deterministic candle builders**

`fixtures.test-helpers.ts` (excluded from build) exports:

```ts
export interface SeriesOptions {
  tokenId?: string;
  timeframe?: string;
  start?: number;
  count: number;
  startPrice: number;
  stepPct?: number;
  pattern?: 'linear' | 'flat' | 'wave' | 'crash-recovery';
  volumeUsd?: number;
}
export function makeSeries(options: SeriesOptions): Candle[];
export function makeCandlesFromCloses(
  closes: readonly number[],
  options?: {
    tokenId?: string;
    timeframe?: string;
    start?: number;
    volumeUsd?: number;
  },
): Candle[];
```

Rules:

- `openTime = start + index * TIMEFRAME_MS[timeframe]`, default start `Date.UTC(2026, 0, 1)`, default timeframe `'1h'`.
- linear: close compounds by `stepPct` per bar (default `0.1`); the implementer's compound reading is the canonical one.
- flat: constant price.
- wave: one full sine period over `count` bars, ±`stepPct`% around `startPrice`.
- crash-recovery: first 60% linear up, next 15% drop 20%, rest linear up.
- Each candle has `open = previous close` (first open = startPrice), `high = max(open, close) * 1.001`, `low = min(open, close) * 0.999`, all `toFixed(8)`; volume default `100000`.
- Builders must produce valid candles for `sortAndValidateCandles` and be fully deterministic (no `Math.random`, no `Date.now`).

- [ ] **Step 8: Wire exports**

`decision/index.ts` re-exports `types`, `reason-codes`, `defaults`, `decimal`, `indicators` for now; later tasks append their modules. `src/index.ts` appends `export * from './decision';` without removing existing exports.

- [ ] **Step 9: Verify and commit**

Run the Task 1 command set. Then:

```bash
git add packages/sandbox-core pnpm-lock.yaml
git commit -m "feat(sandbox): add decision domain, defaults and indicators"
```

---

### Task 3: Regime classifier

**Files:**

- Create: `packages/sandbox-core/src/decision/regime-classifier.ts`
- Create: `packages/sandbox-core/src/decision/regime-classifier.test.ts`
- Modify: `packages/sandbox-core/src/decision/index.ts`

**Consumes:** Task 2 types, defaults, indicators, reason codes.

**Produces:**

```ts
export interface RegimeInput {
  readonly tokenId: string;
  readonly now: Timestamp;
  readonly candles: readonly Candle[];
  readonly previous: RegimeState | null;
  readonly settings: RegimeSettings;
}

export interface RegimeEvaluation {
  readonly state: RegimeState;
  readonly rawRegime: Regime;
  readonly changed: boolean;
  readonly reasonCode: ReasonCode;
  readonly reasonText: string;
}

export function computeRegimeFeatures(
  candles: readonly Candle[],
  now: Timestamp,
  settings: RegimeSettings,
): RegimeFeatures;

export function classifyRegime(input: RegimeInput): RegimeEvaluation;
```

- [ ] **Step 1: Compute features**

Compute with small, configurable periods from `RegimeSettings`. `staleBars` is `floor((now - candleCloseTime(last)) / TIMEFRAME_MS[timeframe])`, clamped at 0; `0` when there are no candles. `longSma` may be `null` when history is shorter than `longHours` and must not block classification. `drawdownPct` uses `drawdownWindowHours = max(slowHours, rangeWindowHours)`, matching design §5.1. Log-facing feature strings use `formatPct`/`formatUsd`; `bars` and `staleBars` are integers.

- [ ] **Step 2: Choose the raw regime in fixed priority order**

```text
1. insufficient history  -> ILLIQUID / REGIME_INSUFFICIENT_HISTORY
2. staleBars > 0         -> ILLIQUID / REGIME_STALE_DATA
3. avgVolume < minLiquidityUsd -> ILLIQUID / REGIME_LOW_LIQUIDITY
4. drawdown >= crashDrawdownPct OR atrPct >= crashAtrPct -> CRASH / REGIME_CRASH
5. previous regime in {CRASH, TREND_DOWN}
   AND close > fastSma
   AND fastSma rose on each of the last recoveryConfirmBars transitions -> RECOVERY / REGIME_RECOVERY
6. fastSma > slowSma * (1 + trendSpreadPct/100)
   AND close > slowSma
   AND atrPct <= trendMaxAtrPct -> TREND_UP / REGIME_TREND_UP
7. fastSma < slowSma * (1 - trendSpreadPct/100)
   AND close < slowSma -> TREND_DOWN / REGIME_TREND_DOWN
8. |fastSma - slowSma| / slowSma * 100 <= rangeSpreadPct
   AND atrPct <= rangeMaxAtrPct -> RANGE / REGIME_RANGE
9. otherwise -> UNKNOWN / REGIME_UNKNOWN
```

`minBars = max(atrPeriod + 1, slowHours + 1, liquidityWindowHours, rangeWindowHours)`; fewer candles means insufficient history. Guard every division: if slowSma or lastClose is not positive, return `UNKNOWN` with `REGIME_UNKNOWN` and zero features rather than dividing by zero.

- [ ] **Step 3: Apply hysteresis**

- No previous state: adopt the raw regime immediately, `candidate = null`, `candidateBars = 0`, `since = now`.
- Raw equals the held regime: hold, clear candidate/count.
- Raw is `CRASH` or `ILLIQUID`: adopt immediately, `since = now`.
- Raw equals `previous.candidate`: increment `candidateBars`; adopt when `candidateBars >= regimeDwellBars`, otherwise hold.
- Otherwise: candidate = raw, `candidateBars = 1`, hold.
- On hold: keep the held `regime`, `since` and the held regime's stored `reasonCode`; update `features`. `RegimeEvaluation.reasonCode` is `REGIME_HELD` with a text naming the pending candidate and count.
- On adoption: `reasonCode` is the raw regime's reason; `state.reasonCode` is that code.
- `changed` is `true` for the first classification and for every adoption of a different regime.
- `rulesVersion` is `REGIME_RULES_VERSION`.

- [ ] **Step 4: Tests**

Use `makeSeries` with small periods, e.g. `fastHours: 3`, `slowHours: 6`, `atrPeriod: 3`, `rangeWindowHours: 4`, `liquidityWindowHours: 3`, `regimeDwellBars: 3`, `recoveryConfirmBars: 3`.

Cover:

1. insufficient history → `ILLIQUID` + `REGIME_INSUFFICIENT_HISTORY`;
2. stale data (now one bar after the last close) → `ILLIQUID` + `REGIME_STALE_DATA`;
3. volume below `minLiquidityUsd` → `ILLIQUID` + `REGIME_LOW_LIQUIDITY`;
4. strong linear uptrend with normal ATR → `TREND_UP`;
5. crash fixture → `CRASH` adopted on the first crash bar even when dwell is 3;
6. drawdown window: a high that is inside `drawdownWindowHours` but outside `rangeWindowHours` changes the drawdown/CRASH result; and a history shorter than `rangeWindowHours` is insufficient history even when other windows fit;
7. hysteresis: held `TREND_UP`, two range-like bars stay `TREND_UP` with `candidate='RANGE'`, third adopts `RANGE`;
8. `CRASH` then rising recovery fixture → `RECOVERY` after confirmation, not before;
9. downtrend → `TREND_DOWN`; flat wave → `RANGE`; contradictory/no-feature input → `UNKNOWN`;
10. same input twice → identical state and features;
11. first classification is `changed: true`.

- [ ] **Step 5: Verify and commit**

```bash
git add packages/sandbox-core/src/decision
git commit -m "feat(sandbox): add regime classifier with hysteresis"
```

---

### Task 4: Strategies

**Files:**

- Create: `packages/sandbox-core/src/decision/strategies/index.ts`
- Create: `packages/sandbox-core/src/decision/strategies/trend-pullback.ts`
- Create: `packages/sandbox-core/src/decision/strategies/range-reversion.ts`
- Create: `packages/sandbox-core/src/decision/strategies/recovery.ts`
- Create: `packages/sandbox-core/src/decision/strategies/trend-pullback.test.ts`
- Create: `packages/sandbox-core/src/decision/strategies/range-reversion.test.ts`
- Create: `packages/sandbox-core/src/decision/strategies/recovery.test.ts`
- Create: `packages/sandbox-core/src/decision/strategies/index.test.ts`
- Modify: `packages/sandbox-core/src/decision/index.ts`

**Consumes:** Task 2 types/defaults/indicators/reasons.

**Produces:**

```ts
export interface StrategyContext {
  readonly now: Timestamp;
  readonly tokenId: string;
  readonly timeframe: string;
  readonly regime: Regime;
  readonly candles: readonly Candle[];
  readonly position: PortfolioPosition | null;
  readonly state: Readonly<Record<string, unknown>>;
}

export interface StrategySignal {
  readonly action: SignalAction;
  readonly reasonCode: ReasonCode;
  readonly reasonText: string;
  readonly confidence: number;
  readonly riskWeight: number;
  readonly stopLossPct: string | null;
  readonly takeProfitPct: string | null;
  readonly nextState: Readonly<Record<string, unknown>>;
}

export interface StrategyDefinition<P extends object> {
  readonly key: StrategyKey;
  readonly version: number;
  readonly eligibleRegimes: readonly Regime[];
  readonly defaultParams: P;
  evaluate(ctx: StrategyContext, params: P): StrategySignal;
}

export interface StrategyRuntime {
  readonly key: StrategyKey;
  readonly version: number;
  readonly eligibleRegimes: readonly Regime[];
  evaluate(ctx: StrategyContext): StrategySignal;
}

export function createStrategySet(
  settings: StrategySettings,
): Readonly<Record<StrategyKey, StrategyRuntime>>;

export function eligibleStrategyFor(regime: Regime): StrategyKey | null;
```

`createStrategySet` closes over the typed params so the engine can call a uniform `evaluate(ctx)` without `any`. `eligibleStrategyFor` maps `TREND_UP → trend_pullback`, `RANGE → range_reversion`, `RECOVERY → recovery`, everything else → `null`.

All prices come from `closes(candles)` and indicators. Every signal sets a non-empty `reasonText`. `stopLossPct` values are `formatPct(...)` output. Entry `takeProfitPct` is `null` in Stage 1B; exits are strategy-driven. No strategy may emit `buy` when `position !== null`. No-data and not-eligible branches must return `nextState` equal to the incoming state so a data gap cannot wipe trailing/confirmation memory; the one exception is recovery's not-eligible branch, which intentionally resets `aboveFastBars` to `0`.

Strategy state may store native numbers for HWM and confirmation counters; these are rule inputs, never money, and never become order sizes. Price comparisons may convert `avgCostUsd`/`close` with `Number`; every persisted money value and every stop/take percentage stays a decimal string. No strategy computes a USD order size.

- [ ] **Step 1: Trend pullback** (`version: 1`, eligible `['TREND_UP']`)

Params from `DEFAULT_STRATEGY_SETTINGS.trendPullback`.

- If fast/slow/ATR is unavailable → `hold` + `STRATEGY_NO_DATA`.
- No position:
  - regime not `TREND_UP` → `hold` + `STRATEGY_NOT_ELIGIBLE`;
  - `fast > slow && close > slow && close <= fast * (1 - pullbackPct/100)` → `buy` + `TREND_PULLBACK_ENTRY`, confidence `0.6`, riskWeight `1`, `stopLossPct = formatPct(atrStopMult * atrPct)`;
  - otherwise `hold` + `TREND_PULLBACK_HOLD`.
  - `nextState = { hwm: close, trailActive: false }` for this branch. Strategy state stores the native-number HWM (not money), so `numeric(state.hwm)` can read it back next bar.
- In position (stop first, then trend break, then trail):
  - `hwm = max(numeric(state.hwm) ?? avgCost, close)`;
  - `trailActive = state.trailActive === true || hwm >= avgCost * (1 + trailActivationPct/100)`;
  - stop: `close <= avgCost * (1 - atrStopMult * atrPct/100)` → `sell` + `TREND_PULLBACK_STOP`;
  - trend break: `fast < slow` → `sell` + `TREND_PULLBACK_TREND_BREAK`;
  - trailing: `trailActive && close <= hwm * (1 - trailPct/100)` → `sell` + `TREND_PULLBACK_TRAIL`;
  - otherwise `hold` + `TREND_PULLBACK_HOLD`;
  - `nextState = { hwm, trailActive }` for every in-position branch.

- [ ] **Step 2: Range reversion** (`version: 1`, eligible `['RANGE']`)

Params `lookback`, `bandAtrMult`, `stopAtrMult`.

- Need ATR and the last `lookback` candles; otherwise `hold` + `STRATEGY_NO_DATA`.
- `mid = (highestHigh + lowestLow) / 2`.
- No position:
  - regime not `RANGE` → `hold` + `STRATEGY_NOT_ELIGIBLE`;
  - `close <= mid - bandAtrMult * atrPct/100 * mid` → `buy` + `RANGE_REVERSION_ENTRY`, confidence `0.55`, riskWeight `1`, `stopLossPct = formatPct(stopAtrMult * atrPct)`;
  - otherwise `hold` + `RANGE_REVERSION_HOLD`.
- In position (stop first):
  - `close <= avgCost * (1 - stopAtrMult * atrPct/100)` → `sell` + `RANGE_REVERSION_STOP`;
  - `close >= mid` → `sell` + `RANGE_REVERSION_MID`;
  - otherwise `hold` + `RANGE_REVERSION_HOLD`.
- `nextState = {}`.

Note: the band threshold is `mid - bandAtrMult * (atrPct/100) * mid`, i.e. ATR% of the range midpoint, not of the current price.

- [ ] **Step 3: Recovery** (`version: 1`, eligible `['RECOVERY']`)

Params `fastPeriod`, `confirmBars`, `stopPct`, `riskWeight`.

- Need fast SMA; otherwise `hold` + `STRATEGY_NO_DATA`.
- No position:
  - regime not `RECOVERY` → `hold` + `STRATEGY_NOT_ELIGIBLE`, `nextState = { aboveFastBars: 0 }`;
  - `count = close > fast ? (numeric(state.aboveFastBars) ?? 0) + 1 : 0`;
  - `count >= confirmBars` → `buy` + `RECOVERY_ENTRY`, confidence `0.5`, riskWeight from params, `stopLossPct = formatPct(stopPct)`;
  - otherwise `hold` + `RECOVERY_CONFIRMING` with `nextState = { aboveFastBars: count }`.
- In position (stop first):
  - `close <= avgCost * (1 - stopPct/100)` → `sell` + `RECOVERY_STOP`;
  - `close < fast` → `sell` + `RECOVERY_TREND_BREAK`;
  - otherwise `hold` + `RECOVERY_HOLD`.

- [ ] **Step 4: Tests**

Use custom small params (`fastPeriod: 3`, `slowPeriod: 6`, etc.) so fixtures stay short.

Trend pullback:

- rising series then a 2% pullback → entry, `stopLossPct` matches `formatPct(2.5 * atrPct)`;
- entry in a non-`TREND_UP` regime → `STRATEGY_NOT_ELIGIBLE`;
- in-position hard stop → `TREND_PULLBACK_STOP`;
- fast below slow → `TREND_PULLBACK_TREND_BREAK`;
- HWM 110, activation reached, close 104 → `TREND_PULLBACK_TRAIL`;
- normal hold keeps `hwm` monotonic;
- never returns `buy` when a position is present.

Range reversion:

- close below the lower band → entry;
- close back at/above mid → `RANGE_REVERSION_MID`;
- hard stop → `RANGE_REVERSION_STOP`;
- non-`RANGE` regime → `STRATEGY_NOT_ELIGIBLE`.

Recovery:

- two closes above fast do not buy; the third buys;
- a close below fast resets the counter;
- entry stop is `3.00`;
- in-position close below fast → `RECOVERY_TREND_BREAK`;
- hard stop → `RECOVERY_STOP`;
- riskWeight is `0.5`.

Registry:

- `eligibleStrategyFor` maps exactly three regimes and returns `null` for the rest;
- `createStrategySet` returns three runtimes with the expected versions and eligible regimes;
- every signal carries a reason code and reason text.

- [ ] **Step 5: Verify and commit**

```bash
git add packages/sandbox-core/src/decision
git commit -m "feat(sandbox): add trend, range and recovery strategies"
```

---

### Task 5: Opportunity ranking and portfolio allocation

**Files:**

- Create: `packages/sandbox-core/src/decision/opportunity-ranker.ts`
- Create: `packages/sandbox-core/src/decision/opportunity-ranker.test.ts`
- Create: `packages/sandbox-core/src/decision/portfolio-allocator.ts`
- Create: `packages/sandbox-core/src/decision/portfolio-allocator.test.ts`
- Modify: `packages/sandbox-core/src/decision/index.ts`

**Consumes:** Task 2 types/defaults/decimal/indicators; Task 4 `StrategySignal`.

**Produces:**

```ts
export interface OpportunityCandidate {
  readonly tokenId: string;
  readonly strategyKey: StrategyKey;
  readonly signal: StrategySignal;
  readonly atrPct: string | null;
  readonly avgVolumeUsd: string | null;
}

export interface RankedOpportunity extends OpportunityCandidate {
  readonly score: string;
  readonly rank: number;
}

export interface RankingDrop {
  readonly candidate: OpportunityCandidate;
  readonly reasonCode: ReasonCode;
  readonly reasonText: string;
}

export interface RankingResult {
  readonly ranked: readonly RankedOpportunity[];
  readonly dropped: readonly RankingDrop[];
}

export function rankOpportunities(
  candidates: readonly OpportunityCandidate[],
  settings: SandboxDecisionSettings,
): RankingResult;

export interface Allocation {
  readonly candidate: RankedOpportunity;
  readonly sizeUsd: string;
  readonly stopLossPct: string;
  readonly takeProfitPct: string | null;
  readonly bindingConstraint: ReasonCode;
}

export interface AllocationDrop {
  readonly candidate: RankedOpportunity;
  readonly reasonCode: ReasonCode;
  readonly reasonText: string;
}

export interface AllocationResult {
  readonly allocations: readonly Allocation[];
  readonly drops: readonly AllocationDrop[];
}

export function allocateOpportunities(
  ranked: readonly RankedOpportunity[],
  portfolio: PortfolioSnapshot,
  settings: SandboxDecisionSettings,
): AllocationResult;
```

- [ ] **Step 1: Rank**

For each candidate, in input order but never relying on it:

- missing/non-finite `atrPct` or `avgVolumeUsd` → drop `RANK_NO_DATA`;
- `avgVolumeUsd < minLiquidityUsd` → drop `RANK_ILLIQUID`;
- `liquidityFactor`:
  - `>= 2 * min` → `1`;
  - `>= min` → `0.5 + 0.5 * (volume - min) / min`;
  - otherwise dropped above;
- `score = confidence * (1 / (atrPct + 1)) * liquidityFactor`;
- sort by `score` desc, `confidence` desc, `tokenId` code-unit asc, `strategyKey` code-unit asc;
- `rank` is 1-based; `score` is `score.toFixed(6)`.

Use native numbers only for the score, as the design allows. Never use `localeCompare`.

- [ ] **Step 2: Allocate**

Use `decimal.js` for every money value. Iterate ranked candidates in rank order. Maintain mutable copies of: open position count, per-token current value, per-strategy current value, cash available.

For each candidate:

1. A position already exists for the token → drop `ALLOC_EXISTING_POSITION`.
2. `openPositions >= maxPositions` → drop `ALLOC_MAX_POSITIONS` for this and every remaining candidate.
3. `tokenCap = equity * maxTokenExposurePct/100 - tokenCurrentValue`.
4. `strategyCap = equity * maxStrategyExposurePct/100 - strategyCurrentValue`.
5. `cashAvailable = cash - equity * cashBufferPct/100` (decremented by each accepted allocation).
6. `riskUsd = equity * perTradeRiskPct/100 * signal.riskWeight`.
7. `stopDistancePct = signal.stopLossPct ?? String(defaultStopPct)`; if `<= 0` → drop `ALLOC_INVALID_STOP`.
8. `sizeByRisk = riskUsd * 100 / stopDistancePct`.
9. `liquidityCap = avgVolumeUsd * liquidityCapPct/100`.
10. If any of the five caps is `<= 0`, drop with the matching reason in fixed order: token, strategy, cash, risk, liquidity.
11. `size = min(tokenCap, strategyCap, cashAvailable, sizeByRisk, liquidityCap)`.
12. If `size < minOrderUsd` → drop `ALLOC_SIZE_TOO_SMALL`.
13. Otherwise accept: `sizeUsd = money(size)`, `bindingConstraint` = the constraint equal to the minimum (first in the fixed order), then increment open positions, token value, strategy value and decrement cash available by `size`.

Sells never enter this function.

- [ ] **Step 3: Tests**

Ranking:

- exact formula: confidence `0.6`, ATR `2`, volume `200000`, min `50000` → score `0.200000` (`0.6 * 1/(2+1) * 1`); volume `75000` → liquidity factor `0.75`, score `0.150000`;
- tie on score breaks by tokenId code-unit (`Token-1` before `token-1`);
- volume exactly at min → factor `0.5`; at twice min → `1`;
- below min → `RANK_ILLIQUID`; missing ATR → `RANK_NO_DATA`;
- input order does not change the result.

Allocation:

- token cap binds with `maxTokenExposurePct: 5` (equity 1000, cap 50, no existing position); an existing position is a separate `ALLOC_EXISTING_POSITION` test, since an existing position never reaches the cap checks;
- strategy cap binds;
- cash buffer binds (cash 100, equity 1000, buffer 10%);
- per-trade risk binds (`equity 1000`, risk 1%, stop 4% → 250);
- liquidity cap binds;
- min order drop;
- max positions drop for current and remaining candidates;
- existing position skip;
- sequential allocations reduce cash available (two allocations cannot both spend the same buffer);
- all `sizeUsd` values match `/^\d+\.\d{2}$/` and there is no float drift (`0.1 + 0.2` style fixture);
- no allocations when cash is already at/below the buffer.

- [ ] **Step 4: Verify and commit**

```bash
git add packages/sandbox-core/src/decision
git commit -m "feat(sandbox): add opportunity ranking and portfolio allocation"
```

---

### Task 6: Risk manager and token state

**Files:**

- Create: `packages/sandbox-core/src/decision/risk-manager.ts`
- Create: `packages/sandbox-core/src/decision/risk-manager.test.ts`
- Create: `packages/sandbox-core/src/decision/token-state.ts`
- Create: `packages/sandbox-core/src/decision/token-state.test.ts`
- Modify: `packages/sandbox-core/src/decision/index.ts`

**Consumes:** Task 2 types/defaults/decimal; Stage 1A `SandboxRiskCheck`.

**Produces:**

```ts
export interface RiskContext {
  readonly now: Timestamp;
  readonly portfolio: PortfolioSnapshot;
  readonly settings: SandboxDecisionSettings;
  readonly phases: Readonly<Record<string, TokenPhase>>;
  readonly features: Readonly<Record<string, RegimeFeatures>>;
}

export interface RiskOutcome {
  readonly passed: boolean;
  readonly checks: readonly SandboxRiskCheck[];
  readonly failedCode: ReasonCode | null;
}

export function checkBuyRisk(input: {
  tokenId: string;
  strategyKey: StrategyKey;
  sizeUsd: string;
  stopLossPct: string | null;
  riskWeight: number;
  context: RiskContext;
}): RiskOutcome;

export function checkSellRisk(input: {
  tokenId: string;
  sizeUsd: string;
  context: RiskContext;
}): RiskOutcome;

export interface TokenStateInput {
  readonly tokenId: string;
  readonly position: PortfolioPosition | null;
  readonly previous: TokenPhase | null;
  readonly cooldownUntil: Timestamp | null;
  readonly now: Timestamp;
  readonly regime: Regime;
  readonly staleBars: number;
  readonly hasBuyIntent: boolean;
}

export interface TokenStateOutcome {
  readonly phase: TokenPhase;
  readonly reasonCode: ReasonCode;
  readonly changed: boolean;
}

export function deriveTokenPhase(input: TokenStateInput): TokenStateOutcome;
```

- [ ] **Step 1: Buy checks**

Always return all twelve checks in this order; each has decimal-string `value`/`limit` and a boolean `passed`. Calculate with decimal.js.

| name                    | value                                      | limit                                       | pass            |
| ----------------------- | ------------------------------------------ | ------------------------------------------- | --------------- |
| `max_positions`         | `positions.length`                         | `maxPositions`                              | `<`             |
| `max_token_exposure`    | `(tokenValue + size) / equity * 100`       | `maxTokenExposurePct`                       | `<=`            |
| `max_strategy_exposure` | `(strategyValue + size) / equity * 100`    | `maxStrategyExposurePct`                    | `<=`            |
| `cash_buffer`           | `cash - size`                              | `equity * cashBufferPct/100`                | `>=`            |
| `daily_loss_limit`      | `max(0, (dayStart - equity)/dayStart*100)` | `dailyLossLimitPct`                         | `<`             |
| `max_drawdown`          | `max(0, (peak - equity)/peak*100)`         | `maxDrawdownPct`                            | `<`             |
| `per_trade_risk`        | `size * stopPct/100`                       | `equity * perTradeRiskPct/100 * riskWeight` | `<=`            |
| `liquidity`             | `size`                                     | `avgVolume * liquidityCapPct/100`           | `<=`            |
| `data_stale`            | `features.staleBars`                       | `0`                                         | `<=`            |
| `cooldown`              | `cooldown ISO` or `none`                   | `now ISO`                                   | `none` or `<=`  |
| `token_blocked`         | phase                                      | `not_blocked`                               | `!== 'BLOCKED'` |
| `size_too_small`        | `size`                                     | `minOrderUsd`                               | `>=`            |

`stopLossPct` defaults to `String(settings.defaultStopPct)`. Missing features count as stale (`value = '999999'`). `failedCode` is the reason of the **first** failing check in table order, mapped from the check name. `passed` is true only when every check passed.

- [ ] **Step 2: Sell checks**

Exactly two checks, same formatting:

| name         | value      | limit                             | pass |
| ------------ | ---------- | --------------------------------- | ---- |
| `data_stale` | stale bars | `0`                               | `<=` |
| `liquidity`  | `sizeUsd`  | `avgVolume * liquidityCapPct/100` | `<=` |

Daily loss and drawdown block at or above the limit (strictly below passes); exposure, cash-buffer, per-trade, liquidity and min-order checks pass at equality. Daily loss, drawdown, cooldown and token-blocked never block a sell. Test this explicitly with a portfolio that breaches both loss limits and a token in `BLOCKED`/cooldown, and with a portfolio exactly at each loss limit.

- [ ] **Step 3: Derive token phase**

Precedence:

1. position exists → `IN_POSITION` / `TOKEN_IN_POSITION`;
2. `cooldownUntil !== null && cooldownUntil > now` → `COOLDOWN` / `TOKEN_COOLDOWN`;
3. regime `ILLIQUID` or `UNKNOWN` or `staleBars > 0` → `BLOCKED` / `TOKEN_BLOCKED`;
4. `hasBuyIntent` → `ARMED` / `TOKEN_ARMED`;
5. otherwise `SLEEPING` / `TOKEN_SLEEPING`.

`changed = previous !== phase`, so the first observation (`previous === null`) is logged as a change.

- [ ] **Step 4: Tests**

- every buy check passes in a healthy portfolio;
- each check can fail alone with the exact name, value, limit and `failedCode`;
- a breached daily loss and a breached drawdown block a buy but not a sell;
- cooldown and `BLOCKED` block a buy but not a sell;
- all checks are present even when an early check fails;
- values are decimal strings (`/^\d+\.\d{2}$/` where applicable);
- phase precedence: position beats cooldown, cooldown beats blocked, blocked beats armed, armed beats sleeping;
- all changed transitions and first observation.

- [ ] **Step 5: Verify and commit**

```bash
git add packages/sandbox-core/src/decision
git commit -m "feat(sandbox): add risk veto and token state"
```

---

### Task 7: Decision logger and decision engine

**Files:**

- Create: `packages/sandbox-core/src/decision/decision-logger.ts`
- Create: `packages/sandbox-core/src/decision/decision-engine.ts`
- Create: `packages/sandbox-core/src/decision/decision-engine.test.ts`
- Modify: `packages/sandbox-core/src/decision/index.ts`

**Consumes:** everything from Tasks 2–6.

**Produces:**

```ts
export class DecisionInputError extends Error {
  constructor(message: string);
}

export class DecisionLogger {
  constructor(log: EventLog, base: {
    runId: string;
    seed: number;
    configVersion: string;
    dataSnapshotId: string;
    clockTime: string; // ISO
  });
  // one method per event in the catalog below
}

export class DecisionEngine {
  constructor(private readonly log: EventLog);
  decide(input: DecisionInput): Promise<DecisionResult>;
}
```

The engine builds its strategy set from `input.settings.strategies` inside each `decide` call, so settings and runtimes can never drift. It reads state from `input.state`, never mutates `input` (including arrays/objects), and appends events only through `DecisionLogger`.

Event `module` values must stay inside the Stage 1A `SandboxModule` union: `run` for `decision.*`; `regime` for `regime.*`; `strategy` for `strategy.*` and `opportunity.*`; `portfolio` for `portfolio.*`, `order.intent` and `token.state_changed`; `risk` for `risk.*`.

- [ ] **Step 1: Implement the event catalog**

Every event uses the Stage 1A base fields (`runId`, `seed`, `configVersion`, `dataSnapshotId`, `clockTime`, `module`, `eventType`, `severity`). Use these event types and reasons:

| eventType             | severity | reason                                                       | when                             | decision + alternatives                                            |
| --------------------- | -------- | ------------------------------------------------------------ | -------------------------------- | ------------------------------------------------------------------ |
| `decision.cycle`      | info     | `DECISION_CYCLE`                                             | start                            | no                                                                 |
| `regime.evaluated`    | debug    | evaluation reason                                            | every token/bar (hold record)    | no                                                                 |
| `regime.changed`      | info     | `REGIME_CHANGED`                                             | first classification or adoption | no                                                                 |
| `strategy.selected`   | debug    | `STRATEGY_SELECTED_BY_REGIME` / `STRATEGY_ORIGINAL_POSITION` | token has a strategy             | no                                                                 |
| `strategy.skipped`    | debug    | `STRATEGY_NOT_ELIGIBLE`                                      | no eligible strategy             | no                                                                 |
| `strategy.evaluated`  | debug    | signal reason                                                | after evaluate                   | no                                                                 |
| `strategy.rejected`   | warn     | `STRATEGY_BUY_WITH_POSITION`                                 | defensive buy-with-position      | yes: `block` + hold                                                |
| `opportunity.ranked`  | decision | `RANK_SELECTED`                                              | each ranked candidate            | yes: `buy`, size null + lower-ranked/`RANK_NO_ALTERNATIVE`         |
| `opportunity.dropped` | decision | drop reason                                                  | each ranking drop                | yes: `block` + `hold`                                              |
| `portfolio.allocated` | decision | `ALLOC_SELECTED`                                             | each allocation                  | yes: `buy`, size + `ALLOC_NO_ALTERNATIVE`                          |
| `portfolio.dropped`   | decision | drop reason                                                  | each allocation drop             | yes: `block` + `hold`                                              |
| `risk.checked`        | decision | `RISK_PASSED` or `failedCode`                                | every buy/sell intent attempt    | yes: attempted action or `block` + `RISK_HOLD`; `riskChecks` array |
| `order.intent`        | decision | strategy entry/exit reason                                   | each intent                      | yes: action + `INTENT_NO_ALTERNATIVE`                              |
| `token.state_changed` | info     | phase reason                                                 | phase changed                    | no                                                                 |
| `decision.completed`  | debug    | `DECISION_CYCLE_COMPLETED`                                   | end                              | no                                                                 |

`regime.evaluated`/`regime.changed` set `regime`, `stateBefore`/`stateAfter` where meaningful, and `inputs.features` + raw/candidate/count. `strategy.*` set `tokenId` and `strategyId` (the strategy key) and `inputs.strategyVersion`. `order.intent` sets `decision.action`, `decision.sizeUsd`, and inputs `{intentId, amount, stopLossPct, takeProfitPct, decisionPriceUsd, bindingConstraint}`. `risk.checked` sets `riskChecks` and inputs `{kind, stopLossPct, riskWeight}`.

Alternatives are deterministic:

- ranked: the next ranked candidate with `RANK_LOWER_PRIORITY`, else `hold` + `RANK_NO_ALTERNATIVE`;
- allocated: `buy` of the next unallocated ranked candidate with `ALLOC_NO_ALTERNATIVE`/drop reason, else `hold` + `ALLOC_NO_ALTERNATIVE`;
- risk: `hold` + `RISK_HOLD` with a text naming the failed check or “all limits passed”; for a sell that fails, the same hold alternative;
- intent: `hold` + `INTENT_NO_ALTERNATIVE`;
- dropped: `hold` + the same drop reason family or `RANK_NO_ALTERNATIVE`/`ALLOC_NO_ALTERNATIVE`.

- [ ] **Step 2: Validate the input**

Throw `DecisionInputError` when:

- `tokenIds` contains an empty or duplicate id, or `clockTime` is not a safe integer; an empty `tokenIds` is allowed so an open position outside the universe can still be evaluated (a completely empty cycle is a valid no-op);
- `market.snapshotId() !== dataSnapshotId`;
- a decimal field is invalid (`equityUsd`, `cashUsd`, `dayStartEquityUsd`, `peakEquityUsd`, position `amount`/`avgCostUsd`/`marketValueUsd`/`stopLossPct`/`takeProfitPct`);
- `equityUsd`, `dayStartEquityUsd` or `peakEquityUsd` is zero (percent-of-equity checks divide by it);
- positions contain duplicate token ids or an unknown strategy key;
- settings have an unknown timeframe (`Object.hasOwn(TIMEFRAME_MS, timeframe)` is false), `maxPositions < 0`, or negative percentages;
- any regime/strategy period is not a positive integer; `regimeDwellBars < 1`, `recoveryConfirmBars < 1`, `slowHours < fastHours`, or `minLiquidityUsd` is not a non-negative decimal string;
- `settings.regime.atrPeriod` differs from `DEFAULT_REGIME_SETTINGS.atrPeriod` (Stage 1B strategies pin the ATR period at 14; the engine must reject a divergence instead of letting classifier and strategy use different volatilities);
- a strategy stop or risk weight is invalid (`stopPct <= 0`, `atrStopMult <= 0`, `stopAtrMult <= 0`, `riskWeight <= 0`, `riskWeight > 1`).

Do not silently repair input.

- [ ] **Step 3: Orchestrate one decision cycle**

1. Record `before = log.events().length`. Log `decision.cycle` with `{tokenIds, settingsVersion, equityUsd, cashUsd, openPositions}`.
2. Build the evaluated token set from `tokenIds ∪ position tokenIds`, sorted by code unit. Extra position tokens outside the universe are still managed.
3. For each token, sorted: read `market.candles(tokenId, settings.timeframe)`; run `classifyRegime` with the previous state; log `regime.evaluated`; log `regime.changed` if changed.
4. Find the position; choose the runtime:
   - position → its `strategyKey`, reason `STRATEGY_ORIGINAL_POSITION`;
   - else `eligibleStrategyFor(regime)`; if `null`, log `strategy.skipped` and continue with no signal;
   - else reason `STRATEGY_SELECTED_BY_REGIME`.
5. Evaluate the strategy with `{now, tokenId, timeframe, regime, candles, position, state: previous.strategyState}`. Log `strategy.evaluated`. If a position exists and the signal is `buy`, replace it with `hold` + `STRATEGY_BUY_WITH_POSITION`, log `strategy.rejected`.
6. Build the risk context once: `phases` for every evaluated token (derive the preliminary phase with `hasBuyIntent: false`), `features` from each regime state, and `cooldowns` containing every non-null `cooldownUntil`. Always pass the cooldown map; the `'cooldown'` fallback value is a misconfiguration marker only.
7. Collect sell intents first (risk-reducing), in token code-unit order: for each position token with a `sell` signal, run `checkSellRisk`, log `risk.checked`; if passed, build and log `order.intent`.
8. Collect buy candidates (`buy` signals without a position) and rank them. Log `opportunity.ranked` in rank order and `opportunity.dropped` in token code-unit order.
9. Allocate. Log `portfolio.allocated` in allocation order and `portfolio.dropped` in ranked order.
10. For each allocation in order: run `checkBuyRisk`, log `risk.checked`; if passed, build and log `order.intent`.
11. Derive phases and build `nextState` for every evaluated token: regime state, phase, `cooldownUntil` unchanged from the previous state, `strategyState` = signal `nextState` when a signal was produced, otherwise the previous strategy state. Log `token.state_changed` when changed.
12. Log `decision.completed` with `{intents, buys, sells, dropped, tokens}`.
13. Return `{clockTime, intents, tokenViews, state, eventCount: log.events().length - before, eventHash: log.hash()}`.

Intent construction:

```ts
intentId = `${runId}:${tokenId}:${side}:${new Date(clockTime).toISOString()}:${strategyKey}`;
```

Buy: `sizeUsd` from the allocation, `amount = null`, stop/take from the allocation, `decisionPriceUsd` = last close.
Sell: `sizeUsd = position.marketValueUsd`, `amount = position.amount`, stop/take from the position, `decisionPriceUsd` = last close.
No duplicate `(tokenId, side)` intent in one cycle.

- [ ] **Step 4: Engine tests**

Use `MemoryEventLog`, `ClockedMarketView` and a fixed clock; build candles with the fixtures.

Cover:

1. single token, `TREND_UP`, pullback → exactly one buy intent; intent fields, id format and decision price match the last close;
2. multi-token ranking: two candidates allocate in score order; a third is dropped by `ALLOC_MAX_POSITIONS`;
3. open position in `CRASH` still evaluates its original strategy and emits a sell intent when the exit fires;
4. a non-eligible regime produces `strategy.skipped`, no intent, `SLEEPING`/`BLOCKED` phase;
5. a token with a position but absent from `tokenIds` is still evaluated; an empty `tokenIds` with a position evaluates only that position, and an empty universe with no positions is a valid no-op;
6. duplicate `tokenIds` or duplicate position tokens throw `DecisionInputError`;
7. a snapshot mismatch throws `DecisionInputError`;
8. `cooldown` and `BLOCKED` prevent a buy but never a sell;
9. every event with a `decision` has a non-empty `reasonCode` and at least one alternative;
10. every buy/sell attempt has a `risk.checked` event with the expected check count (12 buy, 2 sell) and `order.intent` only after a pass;
11. token phases and state changes are correct; `nextState` can be passed directly into a second `decide` call and preserves regime hysteresis;
12. two identical runs produce the same final event hash and intents; reversing `tokenIds` does not change the hash;
13. a different seed changes the hash but not the intents;
14. no look-ahead: a candle after `clockTime` is invisible to every strategy (assert the decision price and signals do not use it);
15. no duplicate intents in a multi-token cycle.

- [ ] **Step 5: Verify and commit**

```bash
git add packages/sandbox-core/src/decision
git commit -m "feat(sandbox): add decision engine and audit log"
```

---

### Task 8: Golden multi-bar replay, Stage 1B review packet and gate

**Files:**

- Create: `packages/sandbox-core/src/decision/decision-engine.golden.test.ts`
- Create: `docs/reviews/2026-11-24-sandbox-stage-1b-review-request.md`
- Modify: `docs/superpowers/specs/2026-11-24-sandbox-stage-1b-decision-engine-design.md` (status)
- Modify: this plan (status + completed checkboxes)

- [ ] **Step 1: Golden multi-bar scenario**

Build a deterministic 3-token, >= 260-bar scenario with the fixtures:

- token `AAA`: linear uptrend, then a pullback, then a resume, then a crash;
- token `BBB`: flat/wave range;
- token `CCC`: crash then recovery.

Drive the engine bar by bar through a test host that:

- advances a `SimulationClock` to each bar close;
- builds a `ClockedMarketView` over the full series;
- fills intents in the test only at the decision price with no fees (this is a test host, not Stage 1C), updating cash, equity, positions and cost basis deterministically;
- passes the returned state into the next `decide` call.

Assert:

- at least one buy, one exit and one skipped/blocked cycle occur;
- no intent violates a risk limit;
- every decision event has a reason and alternative;
- two full replays produce the exact same intents and **the exact same final `eventHash`**; pin the hash as a string literal;
- the final event count is pinned;
- a snapshot of the intent list is pinned (token, side, reason, size string).

If the golden hash changes during implementation for any reason other than a deliberate contract change, stop and report it — do not silently re-pin it.

- [ ] **Step 2: Run the full gate**

```bash
npx pnpm@10.20.0 --filter @nexter/sandbox-core test
npx pnpm@10.20.0 --filter @nexter/sandbox-core typecheck
npx pnpm@10.20.0 --filter @nexter/sandbox-core build
npx pnpm@10.20.0 lint
npx pnpm@10.20.0 format:check
```

Also run the Stage 1A CLI smoke to prove the debt work did not regress it:

```bash
npx pnpm@10.20.0 --filter @nexter/sandbox-core replay -- --file src/fixtures/candles-1h.jsonl --out out/stage1b-smoke.jsonl --run-id stage1b-smoke --seed 7
```

Expected: 3 candles, 8 events, 64-char hash. Delete the artifact after capturing the output.

- [ ] **Step 3: Write the review packet**

`docs/reviews/2026-11-24-sandbox-stage-1b-review-request.md` must contain:

- scope and out-of-scope (no fills/ledger/UI/live/real money; Stage 1C blocked);
- base `28176d1`, head, commit list, changed files;
- exact commands and observed outputs (tests, typecheck, build, lint, format, CLI smoke);
- checklist with evidence: regime priority/hysteresis, recovery confirmation, strategy exits in hostile regimes, no adds, ranking determinism, all allocation/risk limits, sell exemption from loss limits, token states, decision reason/alternatives, risk check completeness, deterministic golden hash, no look-ahead, no old imports, no `any`, decimal money;
- sample event lines (first `decision.cycle`, a `regime.changed`, a `risk.checked`, an `order.intent`, the last `decision.completed`) and the golden intent list;
- the Stage 1A debt closure list with tests;
- deferred items (if any) with severity;
- the explicit gate: **Stage 1C must not start until this review is signed off.**

- [ ] **Step 4: Update status and commit**

Set the design and plan status to `Stage 1B implemented; independent review gate`.

```bash
git add docs/reviews docs/superpowers packages/sandbox-core
git commit -m "docs(sandbox): add stage 1b review request"
```

- [ ] **Step 5: Stop for independent review**

Do not start Stage 1C. Hand the packet to an independent reviewer (agent and/or owner). Fix critical/major findings and re-run the gate before Stage 1C.

---

## Plan self-review

- **Spec coverage:** every Stage 1B goal in the design (regime classifier, three strategies, eligibility/open-position safety, ranking, allocation, risk veto, token states, engine/logging, determinism, review gate) maps to Tasks 2–8. The Stage 1A debt from design §10 maps to Task 1.
- **Review Focus coverage:** regime flapping/priority (Task 3), stranded positions (Tasks 4, 7), risk invariants (Tasks 5–7), determinism (Tasks 2, 5, 7, 8), audit completeness (Task 7).
- **Type consistency:** all shared types are defined once in Task 2; strategies consume `PortfolioPosition`/`StrategySettings`; the engine consumes the Task 5/6 outputs without redefining them. `ReasonCode` is a single union.
- **Money safety:** every order size, cap, risk value and logged money value goes through `decimal.js`; native numbers appear only in indicators, regime rules and ranking.
- **Scope guard:** no fills, ledger, equity computation, UI, HTTP, persistence, live data, wallets or old imports. The golden test's fill host is explicitly test-only.
- **Proportion:** the plan fixes interfaces, rules, event catalog and tests; implementers write the bodies.
