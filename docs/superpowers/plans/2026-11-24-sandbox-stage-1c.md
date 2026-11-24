# Sandbox Stage 1C — Paper Execution, Ledger and Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Stage 1B decision stream into a deterministic paper-trading run: next-open fills with fees/slippage/liquidity, an append-only ledger, a portfolio/equity curve, metrics, a hindsight counterfactual report, and a 180-day end-to-end run with a review gate.

**Architecture:** New `src/paper/` module inside `@nexter/sandbox-core`. A `PaperRunner` groups historical candles into bars, calls the Stage 1B `DecisionEngine` once per bar close, fills queued intents at the next bar open through a pure fill model, applies fills to a pure ledger, marks the portfolio, overlays post-stop cooldowns, and writes a JSON/Markdown report. No live data, UI, HTTP, DB/schema, wallets, real money or real execution.

**Tech Stack:** TypeScript strict, Node.js, Zod 4, decimal.js 10.6.0, Vitest, tsx.

**Design:** `docs/superpowers/specs/2026-11-24-sandbox-stage-1c-paper-execution-design.md`

**Status:** Stage 1C implemented; independent review gate.

**Base:** Stage 1B merged as `ef2f342`; Stage 1B design is signed off.

## Global Constraints

- Stage 1C only: paper fills, ledger, equity/P&L, metrics/report. No live data, UI, HTTP, DB/schema, wallets, signing, real money or real execution. Stage 2 stays blocked until Stage 1C is signed off.
- Work only inside `packages/sandbox-core` plus docs. Do not modify `apps/api` or old AI/legacy modules.
- No imports from `apps/*`, `@nexter/ai-trading`, `trading-bots`, or old search code.
- TypeScript strict; no `any` in public APIs.
- Money is decimal strings. Use `decimal.js` for every money computation; native numbers only for counts, percentages used in metrics, and sorting.
- Determinism: same candles + config + seed = same fills, ledger, report hash and event hash. No wall-clock value in the report hash or event hash.
- No look-ahead: decisions use candles closed at/before `clockTime`; fills use the **next bar open**, never the decision close.
- No adds, no shorts, no leverage. The ledger is append-only; corrections are new entries.
- Every fill is accounted for exactly once; every intent ends as filled/partial/rejected/expired.
- The Stage 1B behavior must remain unchanged for valid no-cooldown inputs; its golden hash must keep passing.
- No schema or migration.
- Run commands with `npx pnpm@10.20.0` from the repo root.
- TDD: write failing tests first; each task leaves package tests, typecheck, build, eslint and prettier green.

## Review Focus

1. **Look-ahead in execution** — a decision at close `T` must fill at the next open, not at `T`'s close. Tested in Tasks 2 and 4.
2. **Accounting integrity** — cash, positions, fees, realized/unrealized P&L must reconcile; no negative cash/amount; no fill without a ledger entry. Tested in Tasks 3, 4 and 8.
3. **Liquidity and partial fills** — a thin bar cannot fill the full order; IOC remainder is explicit. Tested in Task 2.
4. **Cooldown and F2** — a stop fill sets a 24h cooldown; cooled-down signals are filtered before ranking and cannot consume slots. Tested in Tasks 1 and 4.
5. **Report/counterfactual truth** — metrics are hand-computable; counterfactuals are labeled hindsight and never feed decisions. Tested in Tasks 5, 6 and 8.
6. **Determinism** — two runs same report/event hash; reversing token order does not change the report hash. Tested in Task 8.

---

## File Structure

```
packages/sandbox-core/
  package.json                         (+ paper script)
  src/
    index.ts                           (+ ./paper)
    decision/
      reason-codes.ts                  (+ paper/execution codes)
      strategies/                      (+ finite guards, registry keys)
      decision-engine.ts               (+ cooldown/blocked candidate filter)
    util/json-value.ts                 (+ sparse array rejection)
    events/event-schema.ts             (+ execution|ledger|paper families)
    paper/
      index.ts
      types.ts
      defaults.ts
      execution.ts
      ledger.ts
      metrics.ts
      counterfactual.ts
      report.ts
      paper-logger.ts
      paper-runner.ts
      fixtures.test-helpers.ts
      *.test.ts
    cli/
      paper.ts
      paper-main.ts
      paper.test.ts
```

Tests are co-located as `*.test.ts`. Shared paper fixtures live in `paper/fixtures.test-helpers.ts` and are excluded from the build.

---

### Task 1: Stage 1B debt, cooldown filter, strategy registry and paper event families

**Files:**

- Modify: `packages/sandbox-core/src/util/json-value.ts`
- Modify: `packages/sandbox-core/src/util/json-value.test.ts`
- Modify: `packages/sandbox-core/src/decision/strategies/index.ts`
- Modify: `packages/sandbox-core/src/decision/strategies/index.test.ts`
- Modify: `packages/sandbox-core/src/decision/strategies/trend-pullback.ts`
- Modify: `packages/sandbox-core/src/decision/strategies/range-reversion.ts`
- Modify: `packages/sandbox-core/src/decision/strategies/recovery.ts`
- Modify: `packages/sandbox-core/src/decision/strategies/*.test.ts`
- Modify: `packages/sandbox-core/src/decision/decision-engine.ts`
- Modify: `packages/sandbox-core/src/decision/decision-engine.test.ts`
- Modify: `packages/sandbox-core/src/decision/reason-codes.ts`
- Modify: `packages/sandbox-core/src/decision/reason-codes.test.ts`
- Modify: `packages/sandbox-core/src/events/event-schema.ts`
- Modify: `packages/sandbox-core/src/events/event-log.test.ts`
- Modify: `packages/sandbox-core/src/cli/replay.ts`
- Modify: `packages/sandbox-core/src/cli/replay.test.ts`
- Modify: `.gitignore`

Close the Stage 1C debt from Stage 1B design §12.

- [ ] **Step 1: Reject sparse arrays in `assertJsonValue`**

`Array.prototype.forEach` skips holes. Walk arrays by index and reject a hole:

```ts
for (let index = 0; index < container.length; index += 1) {
  if (!(index in container)) {
    throw new NonJsonValueError(`${path}[${index}]`, 'sparse array hole');
  }
  walk(container[index], `${path}[${index}]`, seen);
}
```

Add tests: `[,1]` throws; `[1,2]` passes; a nested sparse array throws with its path.

- [ ] **Step 2: Guard strategy `avgCost`/SMA**

In `trend-pullback.ts`, `range-reversion.ts` and `recovery.ts`, before using `Number(position.avgCostUsd)`, require `Number.isFinite(avgCost) && avgCost > 0`; otherwise return `hold` + `STRATEGY_NO_DATA` with the incoming state and a text naming the invalid position cost. In `recovery.ts`, also require `Number.isFinite(fast)` (not only `fast !== null`). Add tests with `avgCostUsd: 'not-a-number'` and an extremely long decimal that becomes `Infinity`; no throw, no NaN HWM, `hold`/`STRATEGY_NO_DATA`.

- [ ] **Step 3: Filter COOLDOWN/BLOCKED buy candidates before ranking**

In `decision-engine.ts`, the preliminary `phases` are built before the buy loop. In the candidate collection:

- If the token's preliminary phase is `COOLDOWN`, do not add it to `candidates`; build a `RankingDrop` with reason `RANK_COOLDOWN` and the strategy signal, and log `opportunity.dropped`.
- If `BLOCKED`, do the same with `RANK_BLOCKED`.
- Keep the strategy evaluation/hold logging; only ranking/allocation is skipped.
- Add the codes to `reason-codes.ts` and the counterfactual/report reason vocabulary.
- Tests: a token with a future `cooldownUntil` and a buy signal produces `opportunity.dropped` with `RANK_COOLDOWN`, no allocation/intent, `COOLDOWN` phase; a lower-ranked valid token still gets the slot. A blocked/illiquid token is not a candidate (no eligible strategy), but a defensively blocked phase with a buy signal is dropped with `RANK_BLOCKED`.
- The Stage 1B golden (no cooldowns) must remain byte-identical; if not, stop and report.

- [ ] **Step 4: Single strategy-key source**

Export `STRATEGY_KEYS` (a sorted readonly array of all three keys) from `strategies/index.ts`; the engine's `validatePositions` uses it instead of a local literal. Add a sync test: `STRATEGY_KEYS` equals `Object.keys(createStrategySet(DEFAULT_STRATEGY_SETTINGS))` in a stable order. No behavior change.

- [ ] **Step 5: Paper event families and reason codes**

Add to `reason-codes.ts`:

`RANK_COOLDOWN`, `RANK_BLOCKED`, `FILL_FILLED`, `FILL_PARTIAL`, `FILL_REJECTED`, `FILL_EXPIRED`, `FILL_NO_DATA`, `FILL_INSUFFICIENT_CASH`, `FILL_LIQUIDITY`, `FILL_POSITION_EXISTS`, `FILL_NO_POSITION`, `FILL_DUPLICATE`, `LEDGER_BUY`, `LEDGER_SELL`, `PAPER_RUN_STARTED`, `PAPER_RUN_COMPLETED`, `COOLDOWN_AFTER_STOP`.

Extend `event-schema.ts`'s decision-like family regex to include `execution|ledger|paper`. Tests: `execution.filled`, `ledger.entry` and `paper.run_started` without `reasonCode` reject; with one they accept.

- [ ] **Step 6: CLI output hygiene**

- Default the replay output to a path under `out/` and add `/out/` and `packages/sandbox-core/out/` to `.gitignore` (the current package entry stays).
- Reject empty `--out` and `--run-id` values in `parseReplayArgs` with the usage error.
- Do not change the Stage 1A CLI smoke hash; the fixture run uses explicit `--out`/`--run-id`.

- [ ] **Step 7: Verify and commit**

Run the full package test/typecheck/build/eslint/prettier. Assert the Stage 1B golden hash/event count are unchanged. Commit:

```bash
git add packages/sandbox-core .gitignore
git commit -m "fix(sandbox): close stage 1b debt before paper execution"
```

---

### Task 2: Paper types, defaults and fill model

**Files:**

- Create: `packages/sandbox-core/src/paper/types.ts`
- Create: `packages/sandbox-core/src/paper/defaults.ts`
- Create: `packages/sandbox-core/src/paper/defaults.test.ts`
- Create: `packages/sandbox-core/src/paper/execution.ts`
- Create: `packages/sandbox-core/src/paper/execution.test.ts`
- Create: `packages/sandbox-core/src/paper/index.ts`
- Create: `packages/sandbox-core/src/paper/fixtures.test-helpers.ts`
- Modify: `packages/sandbox-core/src/index.ts` (append `export * from './paper';`)
- Modify: `packages/sandbox-core/tsconfig.json` if a fixture helper pattern is needed (the existing `*.test-helpers.ts` exclusion already covers it)

**Produces:** paper config/types and a pure next-open fill model.

- [ ] **Step 1: Types**

Define the public shapes:

```ts
export interface PaperRunSettings {
  readonly feeBps: number;
  readonly slippageBps: number;
  readonly liquidityCapPct: number;
  readonly maxPendingBars: number;
  readonly cooldownHoursAfterStop: number;
  readonly counterfactualHorizonHours: number;
}

export interface PaperRunConfig {
  readonly runId: string;
  readonly seed: number;
  readonly timeframe: string;
  readonly tokenIds: readonly string[];
  readonly initialCapitalUsd: string;
  readonly feeBps: number;
  readonly slippageBps: number;
  readonly liquidityCapPct: number;
  readonly maxPendingBars: number;
  readonly cooldownHoursAfterStop: number;
  readonly counterfactualHorizonHours: number;
}

export type FillStatus = 'filled' | 'partial' | 'rejected' | 'expired';

export interface BuyFillPlan {
  readonly status: 'filled' | 'partial' | 'rejected';
  readonly tokenId: string;
  readonly intentId: string;
  readonly requestedUsd: string;
  readonly filledUsd: string;
  readonly unfilledUsd: string;
  readonly amount: string;
  readonly priceUsd: string;
  readonly feeUsd: string;
  readonly reasonCode: ReasonCode;
  readonly reasonText: string;
}

export interface SellFillPlan {
  readonly status: 'filled' | 'partial' | 'rejected';
  readonly tokenId: string;
  readonly intentId: string;
  readonly requestedAmount: string;
  readonly filledAmount: string;
  readonly unfilledAmount: string;
  readonly priceUsd: string;
  readonly notionalUsd: string;
  readonly feeUsd: string;
  readonly proceedsUsd: string;
  readonly reasonCode: ReasonCode;
  readonly reasonText: string;
}
```

`PaperRunConfig` is the `RunConfig` superset used by the host; `configVersion` from Stage 1A is computed over it.

- [ ] **Step 2: Defaults**

```ts
export const PAPER_VERSION = 'paper-run-v1';
export const DEFAULT_PAPER_SETTINGS: PaperRunSettings = {
  feeBps: 25,
  slippageBps: 10,
  liquidityCapPct: 1,
  maxPendingBars: 1,
  cooldownHoursAfterStop: 24,
  counterfactualHorizonHours: 24,
};
```

Tests: exact values, positive invariants, `PAPER_VERSION` stable.

- [ ] **Step 3: Fill model**

`execution.ts` exports pure functions:

```ts
export function planBuyFill(input: {
  intent: OrderIntent;
  candle: Candle;
  cashUsd: string;
  equityUsd: string;
  cashBufferPct: number;
  settings: PaperRunSettings;
  hasPosition: boolean;
}): BuyFillPlan;

export function planSellFill(input: {
  intent: OrderIntent;
  candle: Candle;
  positionAmount: string;
  settings: PaperRunSettings;
}): SellFillPlan;
```

Rules:

- Reject a buy when `hasPosition` (`FILL_POSITION_EXISTS`), a sell when the position is missing/zero (`FILL_NO_POSITION`).
- `fillPriceBuy = open * (1 + slippageBps/10000)`, `fillPriceSell = open * (1 - slippageBps/10000)`; format to 8 decimals.
- `liquidityCapUsd = volumeUsd * liquidityCapPct/100`.
- Buy: `fillUsd = min(intent.sizeUsd, liquidityCapUsd)`; floor it to cents first: `bookedFill = fillUsd.toFixed(2, ROUND_DOWN)`; `bookedFee = usd(Decimal(bookedFill)*feeBps/10000)`; `cashFloor = equity*cashBufferPct/100`; if `Decimal(bookedFill) + Decimal(bookedFee) > cash - cashFloor` → reject `FILL_INSUFFICIENT_CASH`; `amount = Decimal(bookedFill) / fillPrice` (8 decimals); status `partial` when the booked 2-decimal fill is below the requested 2-decimal size; emit `requestedUsd - filledUsd = unfilledUsd`.
- Sell: `fillAmount = min(intent.amount, positionAmount, liquidityCapUsd / fillPrice)`; if zero → reject `FILL_LIQUIDITY`; `bookedNotional = usd(fillAmount*fillPrice)`; `bookedFee = usd(Decimal(bookedNotional)*feeBps/10000)`; `bookedProceeds = Decimal(bookedNotional) - Decimal(bookedFee)`; emit the three strings so `notionalUsd - feeUsd === proceedsUsd`; status `partial` when the rounded 8-decimal fill is below the rounded 8-decimal requested amount.
- Zero/negative open/volume (validated candles prevent it) → reject `FILL_NO_DATA`.
- All USD/amount strings are 2/8-decimal formatted; internal Decimal exact.
- No ledger, no events here.

- [ ] **Step 4: Fixtures**

`fixtures.test-helpers.ts` exports deterministic candle builders (reuse `makeCandlesFromCloses` conceptually) and a `makeIntent` helper for a buy/sell with explicit size/amount/price, plus a `makeCandle` helper. Excluded from build.

- [ ] **Step 5: Tests**

- buy math: open 100, slippage 10 bps → price 100.10; size 200 → amount 1.998..., fee 0.50; cash 1000, equity 1000, buffer 10% → available 900, passes; exact strings.
- sell math: amount 2, open 90, slippage 10 bps → 89.91; notional 179.82; fee 0.45; proceeds.
- partial buy when size > 1% of volume; partial sell when position > cap.
- insufficient cash: size near available with fee pushes over → reject.
- position exists → reject; no position → reject; zero volume → reject.
- deterministic: same inputs twice identical.

- [ ] **Step 6: Verify and commit**

```bash
git add packages/sandbox-core/src/paper packages/sandbox-core/src/index.ts
git commit -m "feat(sandbox): add paper fill model"
```

---

### Task 3: Paper ledger, trades and reconciliation

**Files:**

- Create: `packages/sandbox-core/src/paper/ledger.ts`
- Create: `packages/sandbox-core/src/paper/ledger.test.ts`
- Modify: `packages/sandbox-core/src/paper/types.ts`
- Modify: `packages/sandbox-core/src/paper/index.ts`

**Consumes:** Task 2 fill plans.

**Produces:** an append-only ledger with positions, trades, realized P&L and reconciliation.

- [ ] **Step 1: Types**

```ts
export interface PaperPosition {
  readonly tokenId: string;
  readonly strategyKey: StrategyKey;
  readonly strategyVersion: number;
  readonly amount: string;
  readonly avgCostUsd: string; // includes buy fees
  readonly openedAt: Timestamp;
  readonly stopLossPct: string | null;
  readonly takeProfitPct: string | null;
  readonly entryIntentId: string;
  readonly feesPaidUsd: string;
}

export interface PaperTrade {
  readonly tradeId: string;
  readonly tokenId: string;
  readonly strategyKey: StrategyKey;
  readonly strategyVersion: number;
  readonly entryAt: Timestamp;
  readonly entryPriceUsd: string;
  readonly entryAmount: string;
  readonly entryNotionalUsd: string;
  readonly entryFeeUsd: string;
  readonly entryIntentId: string;
  readonly exitAt: Timestamp | null;
  readonly exitPriceUsd: string | null;
  readonly exitAmount: string;
  readonly exitNotionalUsd: string;
  readonly exitFeeUsd: string;
  readonly exitReasonCode: ReasonCode | null;
  readonly exitIntentId: string | null;
  readonly realizedPnlUsd: string;
  readonly status: 'open' | 'closed';
}

export interface LedgerEntry { ... } // as design §6.1
export interface PaperLedgerState { ... } // as design §6.1
export interface LedgerApplyResult {
  readonly state: PaperLedgerState;
  readonly entry: LedgerEntry;
  readonly trade: PaperTrade | null;
}
```

- [ ] **Step 2: Functions**

```ts
export function createLedger(initialCapitalUsd: string): PaperLedgerState;
export function applyBuyFill(
  state: PaperLedgerState,
  plan: BuyFillPlan,
  intent: OrderIntent,
  clockTime: Timestamp,
): LedgerApplyResult;
export function applySellFill(
  state: PaperLedgerState,
  plan: SellFillPlan,
  intent: OrderIntent,
  clockTime: Timestamp,
): LedgerApplyResult;
export function markPortfolio(
  state: PaperLedgerState,
  marks: Readonly<Record<string, string>>,
): {
  readonly equityUsd: string;
  readonly positionsValueUsd: string;
  readonly unrealizedPnlUsd: string;
  readonly positions: readonly PortfolioPosition[];
};
export function reconcileLedger(
  state: PaperLedgerState,
  marks: Readonly<Record<string, string>>,
): { readonly ok: boolean; readonly discrepancies: readonly string[] };
```

Rules:

- Buy: reject a second position for the token (the fill model already does; defensively throw). `newAmount = old + fillAmount`; `newCost = oldAmount*oldAvgCost + filledUsd + fee`; `newAvgCost = newCost/newAmount`; cash -= filledUsd+fee; open a trade; entry fields from the intent.
- Sell: costBasis = filledAmount*avgCost; realized = proceeds - costBasis; cash += proceeds; reduce amount; when zero remove and close the trade; aggregate exits until then.
- Entry sequence starts at 1; `entryId = runId:ledger:<sequence>` — the ledger state must carry `runId` or the entry id is built from the plan/intent run id. Add `runId` to `createLedger` or build `entryId` from `intent.intentId` + sequence. Use `${intent.intentId}:ledger:${sequence}`? The intent id contains runId; deterministic. Simpler: `entryId = \`${intent.intentId}:ledger\``(one entry per fill; a partial fill has one intent but one fill, so unique; if the same intent could produce two fills? No, IOC partial fills once. Use`intentId:ledger`). The `sequence` is a monotonic counter in the ledger.
- All values decimal strings; internal Decimal.
- `markPortfolio`: mark each position at its mark; equity = cash + sum; unrealized = sum((mark - avgCost)*amount); positions mapped to `PortfolioPosition`.
- `reconcileLedger`: the five identities from design §6.3; `discrepancies` messages.
- No mutation of input state.

- [ ] **Step 3: Tests**

- buy: cash 1000, size 200, fee 0.50, amount 1.998... → cash 799.50, avgCost 100.25..., trade open.
- sell: realized P&L = proceeds - costBasis; fees; position removed; trade closed; cash.
- partial sell keeps the position/trade open; next sell closes.
- reconciliation: clean ledger ok; tampered cash/amount/equity produce discrepancies.
- equity identity within a cent; no negative cash/amount; entries count = fills.
- deterministic entry ids/sequence.

- [ ] **Step 4: Verify and commit**

```bash
git add packages/sandbox-core/src/paper
git commit -m "feat(sandbox): add paper ledger and reconciliation"
```

---

### Task 4: Paper runner, paper logger and host loop

**Files:**

- Create: `packages/sandbox-core/src/paper/paper-logger.ts`
- Create: `packages/sandbox-core/src/paper/paper-runner.ts`
- Create: `packages/sandbox-core/src/paper/paper-runner.test.ts`
- Create: `packages/sandbox-core/src/paper/paper-logger.test.ts`
- Modify: `packages/sandbox-core/src/paper/types.ts`
- Modify: `packages/sandbox-core/src/paper/index.ts`

**Consumes:** Stage 1B `DecisionEngine`, Task 2 fill model, Task 3 ledger.

**Produces:**

```ts
export interface PaperRunInput {
  readonly runId: string;
  readonly seed: number;
  readonly configVersion: string;
  readonly dataSnapshotId: string;
  readonly tokenIds: readonly string[];
  readonly candles: readonly Candle[];
  readonly settings: SandboxDecisionSettings;
  readonly paper: PaperRunSettings;
  readonly initialState?: EngineState;
}

export interface PaperRunResult {
  readonly config: PaperRunConfig;
  readonly ledger: PaperLedgerState;
  readonly state: EngineState;
  readonly intents: readonly IntentRecord[];
  readonly equityCurve: readonly EquityPoint[];
  readonly eventCount: number;
  readonly eventHash: string;
}

export class PaperRunner {
  constructor(private readonly log: EventLog);
  run(input: PaperRunInput): Promise<PaperRunResult>;
}
```

- [ ] **Step 1: Paper logger**

Methods: `runStarted`, `filled`, `partial`, `rejected`, `expired`, `ledgerEntry`, `cooldownSet`, `runCompleted`. All events carry the Stage 1A base fields and `module` (`run` for paper._, `execution` for execution._, `ledger` for ledger.*). Fill/rejection events carry a `decision` object (buy/sell/block) and an alternative (`hold`); rejection/expiry use `block`/`noop` with `hold`. Reason codes from Task 1. Test the decision/alternative invariant.

- [ ] **Step 2: Host loop**

As design §7. Build bar close times from all candles. Initialize the ledger/cash/state/portfolio. For each bar:

1. Fill pending intents at the bar open (the token's candle with `openTime = close - timeframe`); use `planBuyFill`/`planSellFill`, apply to the ledger, log fill/partial/rejection/expiry, set cooldowns after a stop sell fill.
2. Advance the clock to the close; mark; update dayStart/peak; build the portfolio; call the engine; queue intents.
3. Record an equity point; keep the state.
4. Expire pending intents beyond `maxPendingBars`; at the end expire all.
5. Log `paper.run_completed`.

Use a `MemoryEventLog` (the caller supplies it) for the run; the CLI writes it at the end. The runner must not mutate the input arrays/objects.

- [ ] **Step 3: Cooldown overlay**

After a stop sell fill, construct a new `EngineState` with the token's `cooldownUntil = fill close + hours`. Log `paper.cooldown_set`. The next decision sees `COOLDOWN`; the engine filters the candidate (Task 1). Test: stop fill → cooldown; no buy for 24h; after expiry, a new signal can buy.

- [ ] **Step 4: Tests**

- next-open fill: a buy decided at bar close T fills at bar T+1 open with slippage/fee, not at T close.
- fill before decision: the next decision sees the position/cash.
- sell fills at the next open and updates the ledger.
- cooldown after stop; no re-entry during; expiry.
- missing next bar → expire after `maxPendingBars`.
- state pass-through (regime hysteresis/strategy state).
- no-add rejection; duplicate pending.
- portfolio marks/dayStart/peak.
- empty token list/no candles error; missing mark error.
- event log includes paper/execution/ledger events; every fill has a ledger entry.
- deterministic two runs (small fixture).

- [ ] **Step 5: Verify and commit**

```bash
git add packages/sandbox-core/src/paper
git commit -m "feat(sandbox): add paper runner and host loop"
```

---

### Task 5: Equity curve, metrics and trade summary

**Files:**

- Create: `packages/sandbox-core/src/paper/metrics.ts`
- Create: `packages/sandbox-core/src/paper/metrics.test.ts`
- Modify: `packages/sandbox-core/src/paper/types.ts`
- Modify: `packages/sandbox-core/src/paper/index.ts`

**Produces:**

```ts
export interface EquityPoint {
  readonly clockTime: Timestamp;
  readonly equityUsd: string;
  readonly cashUsd: string;
  readonly positionsValueUsd: string;
  readonly drawdownPct: string;
}

export interface RunMetrics {
  readonly initialCapitalUsd: string;
  readonly finalEquityUsd: string;
  readonly totalReturnPct: string;
  readonly maxDrawdownPct: string;
  readonly peakEquityUsd: string;
  readonly realizedPnlUsd: string;
  readonly unrealizedPnlUsd: string;
  readonly feesPaidUsd: string;
  readonly tradeCount: number;
  readonly wins: number;
  readonly losses: number;
  readonly winRatePct: string | null;
  readonly profitFactor: string | null;
  readonly averageWinUsd: string | null;
  readonly averageLossUsd: string | null;
  readonly timeInMarketPct: string;
  readonly averageExposurePct: string;
  readonly perStrategy: readonly StrategyMetric[];
  readonly perToken: readonly TokenMetric[];
}

export function buildEquityCurve(points): EquityPoint[]; // or take raw marks
export function computeMetrics(input): RunMetrics;
```

- [ ] **Step 1: Equity/drawdown**

Build the curve from the runner's per-bar equity; drawdown `(peak-equity)/peak*100`, never negative. If the curve is empty, max DD 0.

- [ ] **Step 2: Metrics**

- total return = (final/initial - 1)*100.
- max DD from the curve.
- realized/unrealized/fees from the ledger.
- closed trades: wins = realized > 0, losses < 0; win rate = wins/closed*100 (null if none); profit factor = gross profit / |gross loss| (null if no losses); average win/loss.
- time in market = bars with positionsValue > 0 / bars; average exposure = average(positionsValue/equity*100).
- per strategy/token: closed trade counts, realized P&L, win rate; open positions excluded from trade counts but included in current value.
- All money/percent strings 2 decimals; counts integers; null for undefined.

- [ ] **Step 3: Tests**

Hand-computed small curve: initial 1000, points 1000/1100/990 → return -1%, max DD 10%, etc. Trades: +20/-10 → win rate 50%, PF 2, averages. Exposure/time in market. Empty/no-loss cases.

- [ ] **Step 4: Verify and commit**

```bash
git add packages/sandbox-core/src/paper
git commit -m "feat(sandbox): add paper metrics and equity curve"
```

---

### Task 6: Hindsight counterfactuals

**Files:**

- Create: `packages/sandbox-core/src/paper/counterfactual.ts`
- Create: `packages/sandbox-core/src/paper/counterfactual.test.ts`
- Modify: `packages/sandbox-core/src/paper/types.ts`
- Modify: `packages/sandbox-core/src/paper/index.ts`

**Produces:**

```ts
export interface RejectedBuy {
  readonly tokenId: string;
  readonly decisionTime: Timestamp;
  readonly reasonCode: ReasonCode;
}

export interface CounterfactualRecord {
  readonly tokenId: string;
  readonly decisionTime: Timestamp;
  readonly reasonCode: ReasonCode;
  readonly entryAt: Timestamp | null;
  readonly entryPriceUsd: string | null;
  readonly exitAt: Timestamp | null;
  readonly exitPriceUsd: string | null;
  readonly returnPct: string | null;
  readonly outcome: 'missed_opportunity' | 'bad_save' | 'neutral' | 'insufficient_data';
  readonly hindsight: true;
  readonly usedForDecisions: false;
}

export function analyzeRejectedBuys(input: {
  rejected: readonly RejectedBuy[];
  candles: readonly Candle[];
  horizonHours: number;
  feeBps: number;
  slippageBps: number;
}): readonly CounterfactualRecord[];
```

- Entry at the first candle open **after** `decisionTime`; exit at the first close at/after entryOpen + horizon; if either is missing → `insufficient_data`.
- Normalized $100 notional: buy at open*(1+slippage), fee; sell at close*(1-slippage), fee; return %.
- Positive > 0.01% → missed_opportunity; negative < -0.01% → bad_save; else neutral. The exact threshold can be 0 (return > 0 / < 0) for simplicity; pin it.
- Sort by decisionTime then token code-unit.
- Deduplicate `(tokenId, decisionTime, reasonCode)`.
- Tests: positive/negative/neutral, exact entry/exit times, insufficient data, dedupe, sort, labels.

- [ ] **Step 1-3: Implement and test**

- [ ] **Step 4: Verify and commit**

```bash
git add packages/sandbox-core/src/paper
git commit -m "feat(sandbox): add hindsight counterfactual analysis"
```

---

### Task 7: Report, artifacts and paper CLI

**Files:**

- Create: `packages/sandbox-core/src/paper/report.ts`
- Create: `packages/sandbox-core/src/paper/report.test.ts`
- Create: `packages/sandbox-core/src/cli/paper.ts`
- Create: `packages/sandbox-core/src/cli/paper-main.ts`
- Create: `packages/sandbox-core/src/cli/paper.test.ts`
- Modify: `packages/sandbox-core/package.json` (`paper` script)
- Modify: `packages/sandbox-core/src/paper/types.ts`
- Modify: `packages/sandbox-core/src/paper/index.ts`
- Modify: `packages/sandbox-core/src/index.ts` (paper export already)
- Modify: `.gitignore` if needed

**Produces:**

```ts
export interface RunReport {
  readonly paperVersion: string;
  readonly runId: string;
  readonly seed: number;
  readonly configVersion: string;
  readonly dataSnapshotId: string;
  readonly settingsVersion: string;
  readonly config: PaperRunConfig;
  readonly period: { readonly firstBar: Timestamp; readonly lastBar: Timestamp; readonly bars: number; readonly tokens: readonly string[] };
  readonly metrics: RunMetrics;
  readonly equityCurve: readonly EquityPoint[];
  readonly positions: readonly PortfolioPosition[];
  readonly trades: readonly PaperTrade[];
  readonly intentJournal: readonly IntentRecord[];
  readonly counterfactuals: readonly CounterfactualRecord[];
  readonly eventCount: number;
  readonly eventHash: string;
  readonly ledgerEntries: number;
  readonly reconciliationOk: boolean;
  readonly reportHash: string;
}

export function buildReport(input): RunReport;
export function reportHash(report): string;
export function renderMarkdown(report): string;
export async function writePaperArtifacts(input): Promise<...>;
```

- [ ] **Step 1: Report JSON/hash**

Build the report from the run result, ledger, metrics, trades, intents and counterfactuals; JSON-safe values; `reportHash = sha256Hex(stableStringify(report without reportHash))`. Exclude wall-clock/generatedAt from the hash (omit `generatedAt` entirely for simplicity). Test stable hash across two builds and key-order perturbations.

- [ ] **Step 2: Markdown**

Sections: run/config, summary metrics, equity/drawdown, open positions, closed trades, intent journal counts, counterfactuals (hindsight label), event/ledger/report hashes, reconciliation. No wall-clock. Test headings and key values.

- [ ] **Step 3: CLI**

`parsePaperArgs` (files repeated, out, run-id, seed, fee/slippage/liquidity/cooldown/cf horizon, initial capital), validation, usage. `runPaperFromFiles` loads JSONL (Stage 1A loader), combines, validates single timeframe/duplicates, builds `PaperRunConfig`/`configVersion`, `MemoryEventLog`, `PaperRunner`, writes `events.jsonl` (canonical lines), `report.json`, `report.md`. Refuse an existing/non-empty output file. `paper-main.ts` calls it and prints the summary.

- [ ] **Step 4: Tests**

- report hash stable/round-trip; Markdown sections.
- CLI args: defaults, repeats, invalid seed/flag/empty, out required.
- End-to-end small JSONL run: loads, runs, artifacts written, summary; output dir refusal.
- events JSONL lines parse and re-hash (canonical).

- [ ] **Step 5: Verify and commit**

```bash
git add packages/sandbox-core .gitignore
git commit -m "feat(sandbox): add paper report and CLI"
```

---

### Task 8: 180-day golden run, determinism, performance, Stage 1C review packet

**Files:**

- Create: `packages/sandbox-core/src/paper/paper-runner.golden.test.ts`
- Create: `docs/reviews/2026-11-24-sandbox-stage-1c-review-request.md`
- Modify: `docs/superpowers/specs/2026-11-24-sandbox-stage-1c-paper-execution-design.md` (status)
- Modify: this plan (status)

- [ ] **Step 1: Golden 180-day scenario**

Build deterministic 1h data for three tokens over 180 days (4,320 bars), with a trend/pullback token, a range token and a crash/recovery token (reuse/extend the Stage 1B golden patterns). Run the full `PaperRunner` with default paper settings. Assert:

- at least one buy, one sell, one partial or rejection, one cooldown and one counterfactual;
- every intent ends filled/partial/rejected/expired; every fill has a ledger entry;
- reconciliation ok; equity identity within a cent;
- two runs same intents, ledger, report hash and event hash; pinned report hash, event hash, event count, trade count and final equity;
- reversing token ids does not change the report hash (the engine/golden ordering is code-unit);
- the Stage 1B golden still passes unchanged.

If a pin changes for a reason other than a deliberate contract change, stop and report.

- [ ] **Step 2: Performance**

Record the 180-day run duration, event count, ledger entries and report size in the packet. No hard CI bound; a generous smoke bound may be added (e.g. < 120s) if stable.

- [ ] **Step 3: Full gate**

```bash
npx pnpm@10.20.0 --filter @nexter/sandbox-core test
npx pnpm@10.20.0 --filter @nexter/sandbox-core typecheck
npx pnpm@10.20.0 --filter @nexter/sandbox-core build
npx pnpm@10.20.0 lint
npx pnpm@10.20.0 format:check
```

Plus the Stage 1A replay smoke and a small paper CLI smoke. Delete artifacts.

- [ ] **Step 4: Review packet**

`docs/reviews/2026-11-24-sandbox-stage-1c-review-request.md`: scope/out-of-scope, base, head, commits/files, commands/outputs, checklist (fill timing, fees/slippage/liquidity, partials, ledger identity, reconciliation, cooldowns/F2, metrics, counterfactual labeling, determinism, 180-day report, no old imports/schema/real money), sample report summary/trade/intent/counterfactual, deferred items, explicit gate: **Stage 2 must not start until Stage 1C is signed off; the owner must accept the Stage 1 report.**

- [ ] **Step 5: Status and stop**

Set design/plan status to `Stage 1C implemented; independent review gate`. Commit the packet/docs. Stop for independent review.

---

## Plan self-review

- **Spec coverage:** fill model, ledger, host loop, cooldown/F2, equity/metrics, counterfactual, report/CLI, 180-day run and review gate map to Tasks 2–8; the Stage 1B debt and cooldown filter map to Task 1.
- **Review focus:** look-ahead (Tasks 2/4), accounting (3/4/8), liquidity/partials (2), cooldown/F2 (1/4), report/counterfactual truth (5/6/8), determinism (8).
- **Type consistency:** paper types are defined once; the fill plans feed the ledger; the runner consumes the ledger/metrics; the report consumes all.
- **Money safety:** every money value goes through decimal.js; native numbers are counts/metrics only.
- **Scope guard:** no live data, UI, HTTP, DB/schema, wallets or real execution; the 180-day run is historical paper only.
- **Proportion:** the plan fixes interfaces, rules and tests; implementers write the bodies.
