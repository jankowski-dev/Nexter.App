# Stage 1B review request — `@nexter/sandbox-core` decision engine

- Date: 2026-11-24
- Branch: `feat/sandbox-stage-1b`
- Base: `28176d1` (Stage 1A merged)
- Code head at request: `b407592`
- Review-request commit: `b771499` (golden test, this packet, design/plan status)
- F1 fix commit: the commit with subject `fix(sandbox): align allocation rounding with risk caps` (moneyDown, allocator accounting, regression tests, re-pinned golden values, this packet update)
- Package: `packages/sandbox-core`
- Reviewer: independent (agent and/or owner). The reviewer does not edit code.
- Design: `docs/superpowers/specs/2026-11-24-sandbox-stage-1b-decision-engine-design.md`
- Plan: `docs/superpowers/plans/2026-11-24-sandbox-stage-1b.md`
- Stage 1A review (signed off): `docs/reviews/2026-11-23-sandbox-stage-1a-review-request.md`

Stage 1B is **implemented**. The full gate is green. The golden replay found one
major defect in the allocator/risk seam (F1); it is **fixed and regression-tested**
in the F1 fix commit, and the golden values were re-pinned deliberately (section
7.1). **Stage 1B is not signed off until the independent review closes.**

## 1. Scope

In scope — the deterministic decision layer, `packages/sandbox-core/src/decision`:

- decision input/result/state types, defaults and settings version;
- shared indicators and decimal money helpers;
- regime classifier with priority, dwell hysteresis and recovery confirmation;
- three long-only strategy families (`trend_pullback`, `range_reversion`, `recovery`);
- deterministic opportunity ranking;
- portfolio allocation (token/strategy/cash/risk/liquidity caps, min order);
- risk veto for buys and the narrow sell path;
- token phases;
- the per-bar `DecisionEngine` and the structured `DecisionLogger`;
- the golden 400-bar replay and its pinned hash.

Explicitly **out of scope** (must not be present, is not reviewed here):

- fills, fees, cost basis, ledger, equity/P&L computation (the golden test's
  fill host is a test-only harness and is documented as such);
- UI, HTTP API, database, migrations, workers, persistence;
- live market data, wallets, signing, on-chain execution, real money;
- the old AI module (`@nexter/ai-trading`, `trading-bots`, search, legacy/Notion
  code) and `apps/*`: no import from any of them exists;
- Stage 1C (intent consumption, execution, ledger, reporting).

Stage 1B produces `OrderIntent`s and events only. The engine never fills, never
reads the wall clock, never uses `Date.now`, `Math.random` or `localeCompare`, and
never mutates its inputs.

## 2. Commits (base `28176d1` .. code head `b407592`)

```
b407592 docs(sandbox): document decision cycle audit fields
ef502ea fix(sandbox): refine decision audit cycle inputs
9788a24 feat(sandbox): add decision engine and audit log
2d5221e docs(sandbox): pass cooldowns into the risk context
349d53d feat(sandbox): add risk veto and token state
7ff5fb5 docs(sandbox): allow an empty universe with an open position
c450b60 fix(sandbox): prevent duplicate token allocation
6624791 docs(sandbox): fix allocation test and loss-limit boundaries
b3def02 feat(sandbox): add opportunity ranking and portfolio allocation
11624a6 docs(sandbox): pin strategy atr period for stage 1b
af54196 feat(sandbox): add trend, range and recovery strategies
d1b35e2 fix(sandbox): align regime drawdown window and stale guards
d877df3 docs(sandbox): pin decision input validation
4e52bb4 docs(sandbox): pin regime drawdown window
a03aad0 feat(sandbox): add regime classifier with hysteresis
d96f464 docs(sandbox): store strategy hwm as a number
500c42d docs(sandbox): pin fixture compound growth semantics
22f4124 feat(sandbox): add decision domain, defaults and indicators
8dcb49f docs(sandbox): require fresh candles for decisions
ec31b56 fix(sandbox): close stage 1a debt before decision engine
9382375 docs(sandbox): add stage 1b design and plan
```

The review-request commit adds the golden test, this packet and the status lines.
It changes no engine code.

## 3. Changed files (`28176d1..b407592`)

```
M .gitignore
A docs/superpowers/plans/2026-11-24-sandbox-stage-1b.md
A docs/superpowers/specs/2026-11-24-sandbox-stage-1b-decision-engine-design.md
M packages/sandbox-core/package.json
M packages/sandbox-core/src/cli/main.ts
M packages/sandbox-core/src/cli/replay.test.ts
M packages/sandbox-core/src/cli/replay.ts
M packages/sandbox-core/src/data/candles.test.ts
M packages/sandbox-core/src/data/candles.ts
A packages/sandbox-core/src/decision/decimal.test.ts
A packages/sandbox-core/src/decision/decimal.ts
A packages/sandbox-core/src/decision/decision-engine.test.ts
A packages/sandbox-core/src/decision/decision-engine.ts
A packages/sandbox-core/src/decision/decision-logger.ts
A packages/sandbox-core/src/decision/defaults.test.ts
A packages/sandbox-core/src/decision/defaults.ts
A packages/sandbox-core/src/decision/fixtures.test-helpers.ts
A packages/sandbox-core/src/decision/index.ts
A packages/sandbox-core/src/decision/indicators.test.ts
A packages/sandbox-core/src/decision/indicators.ts
A packages/sandbox-core/src/decision/opportunity-ranker.test.ts
A packages/sandbox-core/src/decision/opportunity-ranker.ts
A packages/sandbox-core/src/decision/portfolio-allocator.test.ts
A packages/sandbox-core/src/decision/portfolio-allocator.ts
A packages/sandbox-core/src/decision/reason-codes.test.ts
A packages/sandbox-core/src/decision/reason-codes.ts
A packages/sandbox-core/src/decision/regime-classifier.test.ts
A packages/sandbox-core/src/decision/regime-classifier.ts
A packages/sandbox-core/src/decision/risk-manager.test.ts
A packages/sandbox-core/src/decision/risk-manager.ts
A packages/sandbox-core/src/decision/strategies/index.test.ts
A packages/sandbox-core/src/decision/strategies/index.ts
A packages/sandbox-core/src/decision/strategies/range-reversion.test.ts
A packages/sandbox-core/src/decision/strategies/range-reversion.ts
A packages/sandbox-core/src/decision/strategies/recovery.test.ts
A packages/sandbox-core/src/decision/strategies/recovery.ts
A packages/sandbox-core/src/decision/strategies/trend-pullback.test.ts
A packages/sandbox-core/src/decision/strategies/trend-pullback.ts
A packages/sandbox-core/src/decision/token-state.test.ts
A packages/sandbox-core/src/decision/token-state.ts
A packages/sandbox-core/src/decision/types.ts
M packages/sandbox-core/src/events/event-log.test.ts
M packages/sandbox-core/src/events/event-schema.ts
M packages/sandbox-core/src/events/memory-event-log.ts
M packages/sandbox-core/src/index.ts
M packages/sandbox-core/src/runner/replay-runner.test.ts
M packages/sandbox-core/src/runner/replay-runner.ts
A packages/sandbox-core/src/util/json-value.test.ts
A packages/sandbox-core/src/util/json-value.ts
M packages/sandbox-core/tsconfig.json
M pnpm-lock.yaml
```

The review-request commit additionally adds:

```
A packages/sandbox-core/src/decision/decision-engine.golden.test.ts
A docs/reviews/2026-11-24-sandbox-stage-1b-review-request.md
M docs/superpowers/specs/2026-11-24-sandbox-stage-1b-decision-engine-design.md
M docs/superpowers/plans/2026-11-24-sandbox-stage-1b.md
```

The F1 fix commit touches only:

```
M packages/sandbox-core/src/decision/decimal.ts
M packages/sandbox-core/src/decision/decimal.test.ts
M packages/sandbox-core/src/decision/portfolio-allocator.ts
M packages/sandbox-core/src/decision/portfolio-allocator.test.ts
M packages/sandbox-core/src/decision/decision-engine.golden.test.ts
M docs/reviews/2026-11-24-sandbox-stage-1b-review-request.md
```

No `apps/*`, no database, no old AI/legacy file is touched. `.gitignore` only adds
`packages/sandbox-core/out/` (CLI smoke artifacts). `package.json` gains the
runtime dependency `decimal.js` (10.6.0) and keeps `zod`; `tsx`, `typescript` and
`vitest` stay dev-only.

## 4. Commands and observed results

All from the repo root with `npx pnpm@10.20.0`.

### 4.1 Package tests

```bash
npx pnpm@10.20.0 --filter @nexter/sandbox-core test
```

```
 Test Files  27 passed (27)
      Tests  330 passed (330)
   Duration  10.2s
```

The golden file is one of the 27; the Stage 1A suite and all Stage 1B unit
suites are green. The F1 fix adds five tests: two for `moneyDown` and three
allocator cent-truncation tests (including a cap-binding allocation that is then
accepted by `checkBuyRisk`).

### 4.2 Typecheck

```bash
npx pnpm@10.20.0 --filter @nexter/sandbox-core typecheck
```

Exit code 0, no diagnostics.

### 4.3 Build

```bash
npx pnpm@10.20.0 --filter @nexter/sandbox-core build
```

Exit code 0.

### 4.4 Lint

```bash
npx pnpm@10.20.0 lint
```

```
> nexter@0.1.0 lint .../crypto-hub
> eslint .
```

Exit code 0, no output.

### 4.5 Format

```bash
npx pnpm@10.20.0 format:check
```

```
Checking formatting...
All matched files use Prettier code style!
```

Note for reproducibility: the first run of this command failed with 12 warnings,
all of them the **gitignored workflow scratch files** under
`.superpowers/sdd/**` (task briefs and reports, ignored by
`.superpowers/sdd/.gitignore`). No repository file failed. Those scratch files
were formatted with `npx prettier --write .superpowers` (no tracked file change)
and the root gate then passed as shown. Scoped evidence for the review artifacts:

```bash
npx prettier --check packages/sandbox-core/src/decision/decision-engine.golden.test.ts
# All matched files use Prettier code style!
```

### 4.6 Stage 1A CLI smoke (debt regression check)

```bash
npx pnpm@10.20.0 --filter @nexter/sandbox-core replay -- \
  --file src/fixtures/candles-1h.jsonl --out out/stage1b-smoke.jsonl \
  --run-id stage1b-smoke --seed 7
```

```
{
  "candles": 3,
  "firstTime": 1767225600000,
  "lastTime": 1767232800000,
  "gaps": 0,
  "eventCount": 8,
  "eventHash": "44acfab4fd1633176d3caa411bf3ba710e045d0cee1cbd88f270749e0260c2d4",
  "outputPath": "out/stage1b-smoke.jsonl",
  "configVersion": "6082bbcf4407b31bb56c54ef65672dd1a87e624e8b58f90c8ac217dad8c50dcd",
  "dataSnapshotId": "4d62f7195b100cd88d33896545038526decac00c03208447a155d212996c1a99"
}
```

3 candles, 8 events, 64-hex-character hash. The hash differs from the Stage 1A
golden `1e762672…` only because the run id is `stage1b-smoke` instead of
`stage1a-golden`; `configVersion` and `dataSnapshotId` are identical. The
artifact `out/stage1b-smoke.jsonl` and the `out/` directory were deleted; nothing
generated is committed (`out/` is gitignored).

## 5. Golden multi-bar replay

File: `packages/sandbox-core/src/decision/decision-engine.golden.test.ts`.

### 5.1 Scenario

Deterministic, 400 closed 1h bars per token, volume 100,000 USD, all prices
positive, built with `makeCandlesFromCloses` (fixed 8-decimal prices, no
`Math.sin`/`Math.random`/clock reads):

| Token | Shape                                                                                                                                                                                                                                                                                 |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AAA` | 175 bars +0.1% → 6 bars −4% → 80 bars +0.1% → one −13% bar → 138 recovery bars. The pullback starts just after the 169-bar regime warmup; the single crash bar pushes the 168-bar drawdown past 12%, so CRASH is adopted with no dwell and the open position is stopped inside CRASH. |
| `BBB` | 24-bar sine around 50, ±3% amplitude, 16 full cycles + 16 bars. Fast SMA (24) equals slow SMA (168 = 7 cycles), so the classifier sees a stable RANGE while price travels from the lower band to the midpoint.                                                                        |
| `CCC` | 180 bars +0.1% → 40 bars −25% → 180 recovery bars, so CRASH happens after warmup and RECOVERY follows.                                                                                                                                                                                |

`BBB` uses a 24-bar period on purpose: with the default 24/168 SMAs a 48-bar
period makes the fast SMA lead the slow SMA by ±1.9%, above `rangeSpreadPct`
(0.75%), so the raw regime is TREND_DOWN exactly at the lower band and the range
strategy could never enter. This is a fixture choice, not a product change.

### 5.2 Test host (test-only; not Stage 1C)

Per bar: advance `SimulationClock` to the candle close; assert the
`ClockedMarketView` exposes exactly `barIndex + 1` candles and that the latest
close equals the current bar (look-ahead guard); mark open positions to the close;
`equity = cash + Σ mark`; reset `dayStartEquityUsd` when the UTC date changes;
`peak = max(peak, equity)`; call `decide` with fixed `runId: 'golden-run-7'`,
`seed: 7`, `configVersion: 'golden-config-v1'`,
`dataSnapshotId = snapshot.id`, sorted `tokenIds = ['AAA','BBB','CCC']` and
`DEFAULT_SETTINGS`; then apply intents at `decisionPriceUsd` with no fees using
`decimal.js`.

Host invariants enforced by construction: a buy for a token that already holds a
position throws (no adds), a sell without a position throws (no orphan sell), a
sell amount must equal the host position amount, and two intents for the same
token in one cycle throw. USD is `toFixed(2)`; token amounts are `toFixed(8)`.

### 5.3 Pinned outcome

Two independent replays produce identical intents, the same event count and the
same final hash. Pinned literals (re-pinned deliberately by the F1 fix; the
pre-fix values are in section F1.1):

| Pin                                 | Value                                                              |
| ----------------------------------- | ------------------------------------------------------------------ |
| final `eventHash`                   | `b260f984250cf2cca57610a3fe47c85d91d5f93c26472818f2e21f564226847a` |
| total events                        | `3936`                                                             |
| intents (buys / sells)              | `45` (`24` / `21`)                                                 |
| final host equity                   | `1047.32` USD                                                      |
| positions still open at the end     | `AAA`, `BBB`, `CCC`                                                |
| `dataSnapshotId` of the scenario    | `6bcc8b50894a6be2918a4b8cfbe556102353bcfc5ea04800be323c1eeef54330` |
| `settingsVersion(DEFAULT_SETTINGS)` | `cc3d30cf416f7fac9a96b96d40868050cce7e68cb300f47d17fc92b789f1a26c` |
| risk-vetoed allocations in the run  | `0`                                                                |

Pinned intent list (token, side, reason code, size USD) in replay order:

```
AAA buy TREND_PULLBACK_ENTRY 200.00
BBB buy RANGE_REVERSION_ENTRY 199.76
CCC buy TREND_PULLBACK_ENTRY 199.40
BBB sell RANGE_REVERSION_STOP 196.93
BBB buy RANGE_REVERSION_ENTRY 198.78
CCC sell TREND_PULLBACK_STOP 195.12
CCC buy TREND_PULLBACK_ENTRY 197.47
CCC sell TREND_PULLBACK_STOP 191.84
BBB sell RANGE_REVERSION_MID 206.52
BBB buy RANGE_REVERSION_ENTRY 199.73
BBB sell RANGE_REVERSION_STOP 196.90
BBB buy RANGE_REVERSION_ENTRY 199.33
BBB sell RANGE_REVERSION_MID 207.09
BBB buy RANGE_REVERSION_ENTRY 201.70
BBB sell RANGE_REVERSION_STOP 198.84
BBB buy RANGE_REVERSION_ENTRY 201.30
BBB sell RANGE_REVERSION_MID 209.14
BBB buy RANGE_REVERSION_ENTRY 203.71
BBB sell RANGE_REVERSION_STOP 200.82
BBB buy RANGE_REVERSION_ENTRY 203.30
AAA sell TREND_PULLBACK_STOP 187.20
BBB sell RANGE_REVERSION_MID 211.21
BBB buy RANGE_REVERSION_ENTRY 199.42
BBB sell RANGE_REVERSION_STOP 196.59
BBB buy RANGE_REVERSION_ENTRY 198.86
BBB sell RANGE_REVERSION_MID 206.60
AAA buy RECOVERY_ENTRY 167.00
BBB buy RANGE_REVERSION_ENTRY 200.77
BBB sell RANGE_REVERSION_STOP 197.92
BBB buy RANGE_REVERSION_ENTRY 200.34
BBB sell RANGE_REVERSION_MID 208.14
BBB buy RANGE_REVERSION_ENTRY 202.58
BBB sell RANGE_REVERSION_STOP 199.71
BBB buy RANGE_REVERSION_ENTRY 202.15
BBB sell RANGE_REVERSION_MID 210.02
BBB buy RANGE_REVERSION_ENTRY 204.42
BBB sell RANGE_REVERSION_STOP 201.52
BBB buy RANGE_REVERSION_ENTRY 203.98
CCC buy RECOVERY_ENTRY 170.19
BBB sell RANGE_REVERSION_MID 211.92
BBB buy RANGE_REVERSION_ENTRY 206.91
BBB sell RANGE_REVERSION_STOP 203.97
BBB buy RANGE_REVERSION_ENTRY 206.61
BBB sell RANGE_REVERSION_MID 214.65
BBB buy RANGE_REVERSION_ENTRY 209.65
```

The run exercises all three strategies (trend pullback entry, range entry and
midpoint exit, recovery entry) plus all three exit reasons that matter here
(ATR stop, range stop, midpoint) and a strategy exit inside CRASH.

### 5.4 Assertions in the golden test

- at least one buy, one sell, a `strategy.skipped` cycle and a `BLOCKED` token
  phase;
- every `order.intent` has a preceding `risk.checked` for the same token and side
  whose `decision.action` equals the side, whose check list is exactly the 12 buy
  checks or the 2 sell checks, and where **every check passed**;
- sells are structurally exempt from daily-loss, drawdown and cooldown checks;
- every event carrying a `decision` has a non-empty `reasonCode` and at least one
  alternative;
- the first classification of every token is ILLIQUID /
  `REGIME_INSUFFICIENT_HISTORY`;
- CRASH is adopted for AAA and CCC on the first raw CRASH bar (dwell bypassed);
- every non-CRASH/ILLIQUID regime change had at least `regimeDwellBars` (3)
  confirmations;
- every RECOVERY change follows a CRASH or TREND_DOWN;
- the AAA trend position is stopped out on the exact bar where AAA is classified
  CRASH (hostile-regime exit with the original strategy);
- deterministic money formats, no duplicate token intents, live state returned for
  the next cycle, no look-ahead;
- no buy candidate is risk-vetoed in the replay (`risk.checked` with
  `decision.action: block` count is `0`), so every sized candidate becomes an intent;
- two full replays produce the same intents and hash; the hash, event count and
  intent list are pinned.

### 5.5 Sample event lines (golden replay, `recordedAt` is excluded from the hash)

First `decision.cycle` (bar 0):

```json
{
  "runId": "golden-run-7",
  "clockTime": "2026-01-01T01:00:00.000Z",
  "module": "run",
  "eventType": "decision.cycle",
  "severity": "info",
  "inputs": {
    "tokenIds": ["AAA", "BBB", "CCC"],
    "evaluatedTokenIds": ["AAA", "BBB", "CCC"],
    "settingsVersion": "cc3d30cf416f7fac9a96b96d40868050cce7e68cb300f47d17fc92b789f1a26c",
    "equityUsd": "1000.00",
    "cashUsd": "1000.00",
    "openPositions": []
  },
  "dataSnapshotId": "6bcc8b50894a6be2918a4b8cfbe556102353bcfc5ea04800be323c1eeef54330",
  "configVersion": "golden-config-v1",
  "seed": 7,
  "reasonCode": "DECISION_CYCLE",
  "reasonText": "Decision cycle started for 3 evaluated token(s)",
  "tokenId": null,
  "strategyId": null,
  "regime": null,
  "stateBefore": null,
  "stateAfter": null,
  "timing": null,
  "decision": null,
  "alternatives": [],
  "riskChecks": [],
  "correlationId": null,
  "seq": 0,
  "recordedAt": "2026-11-24T00:09:57.479Z",
  "prevHash": "0000000000000000000000000000000000000000000000000000000000000000",
  "hash": "87e11a50a74d06b0d71c959ae050229d0ae159a4193c604db56691db49671ad4"
}
```

First `regime.changed` (AAA, bar 0, insufficient history):

```json
{
  "runId": "golden-run-7",
  "clockTime": "2026-01-01T01:00:00.000Z",
  "module": "regime",
  "eventType": "regime.changed",
  "severity": "info",
  "tokenId": "AAA",
  "regime": "ILLIQUID",
  "stateBefore": null,
  "stateAfter": {
    "regime": "ILLIQUID",
    "reasonCode": "REGIME_INSUFFICIENT_HISTORY",
    "candidate": null,
    "candidateBars": 0,
    "since": "2026-01-01T01:00:00.000Z"
  },
  "inputs": {
    "features": {
      "bars": 1,
      "lastClose": "100.00",
      "fastSma": null,
      "slowSma": null,
      "longSma": null,
      "atrPct": null,
      "recentHigh": null,
      "recentLow": null,
      "avgVolumeUsd": null,
      "drawdownPct": null,
      "staleBars": 0
    },
    "rawRegime": "ILLIQUID",
    "candidate": null,
    "candidateBars": 0,
    "rulesVersion": "regime-rules-v1"
  },
  "dataSnapshotId": "6bcc8b50894a6be2918a4b8cfbe556102353bcfc5ea04800be323c1eeef54330",
  "configVersion": "golden-config-v1",
  "seed": 7,
  "reasonCode": "REGIME_CHANGED",
  "reasonText": "Regime for AAA changed from none to ILLIQUID",
  "strategyId": null,
  "timing": null,
  "decision": null,
  "alternatives": [],
  "riskChecks": [],
  "correlationId": null,
  "seq": 2,
  "recordedAt": "2026-11-24T00:09:57.486Z",
  "prevHash": "a0df51c4e852f1c744735f8ab0970826c7d910ee70bcd9cd90143d020a538454",
  "hash": "c74aed8c0781cc3e1a250492521828e5478afca57810dde157f17a00a57024e4"
}
```

The `risk.checked` that authorised the first AAA buy (seq 1483), full 12-check list:

```json
{
  "runId": "golden-run-7",
  "clockTime": "2026-01-08T12:00:00.000Z",
  "module": "risk",
  "eventType": "risk.checked",
  "severity": "decision",
  "tokenId": "AAA",
  "strategyId": "trend_pullback",
  "inputs": { "kind": "buy", "stopLossPct": "1.28", "riskWeight": 1 },
  "decision": {
    "action": "buy",
    "sizeUsd": "200.00",
    "reasonCode": "RISK_PASSED",
    "reasonText": "All 12 buy risk checks passed for AAA"
  },
  "alternatives": [
    {
      "action": "hold",
      "reasonCode": "RISK_HOLD",
      "whyNot": "All limits passed; holding is a valid alternative that takes no new risk"
    }
  ],
  "riskChecks": [
    { "name": "max_positions", "value": "0", "limit": "5", "passed": true },
    { "name": "max_token_exposure", "value": "20.00", "limit": "20.00", "passed": true },
    { "name": "max_strategy_exposure", "value": "20.00", "limit": "40.00", "passed": true },
    { "name": "cash_buffer", "value": "800.00", "limit": "100.00", "passed": true },
    { "name": "daily_loss_limit", "value": "0.00", "limit": "2.00", "passed": true },
    { "name": "max_drawdown", "value": "0.00", "limit": "15.00", "passed": true },
    { "name": "per_trade_risk", "value": "2.56", "limit": "10.00", "passed": true },
    { "name": "liquidity", "value": "200.00", "limit": "1000.00", "passed": true },
    { "name": "data_stale", "value": "0", "limit": "0", "passed": true },
    { "name": "cooldown", "value": "none", "limit": "2026-01-08T12:00:00.000Z", "passed": true },
    { "name": "token_blocked", "value": "SLEEPING", "limit": "not_blocked", "passed": true },
    { "name": "size_too_small", "value": "200.00", "limit": "10.00", "passed": true }
  ],
  "dataSnapshotId": "6bcc8b50894a6be2918a4b8cfbe556102353bcfc5ea04800be323c1eeef54330",
  "configVersion": "golden-config-v1",
  "seed": 7,
  "reasonCode": "RISK_PASSED",
  "reasonText": "All 12 buy risk checks passed for AAA",
  "regime": null,
  "stateBefore": null,
  "stateAfter": null,
  "timing": null,
  "correlationId": null,
  "seq": 1483,
  "recordedAt": "2026-11-24T00:09:57.986Z",
  "prevHash": "e31a72a3335dcbafe46c861b6e002fc13ef25c4e0f901d4d0e8c9827b73968c0",
  "hash": "d58d2185b6d9e7dc21266325abee015d55cafb863af90cdeebcaf4051420ed6e"
}
```

The corresponding `order.intent` (seq 1484):

```json
{
  "runId": "golden-run-7",
  "clockTime": "2026-01-08T12:00:00.000Z",
  "module": "portfolio",
  "eventType": "order.intent",
  "severity": "decision",
  "tokenId": "AAA",
  "strategyId": "trend_pullback",
  "inputs": {
    "intentId": "golden-run-7:AAA:buy:2026-01-08T12:00:00.000Z:trend_pullback",
    "amount": null,
    "stopLossPct": "1.28",
    "takeProfitPct": null,
    "decisionPriceUsd": "115.11902781",
    "bindingConstraint": "ALLOC_TOKEN_CAP"
  },
  "decision": {
    "action": "buy",
    "sizeUsd": "200.00",
    "reasonCode": "TREND_PULLBACK_ENTRY",
    "reasonText": "Trend pullback entry: close 115.12 is at or below 115.32 while fast SMA 117.68 leads slow SMA 110.07"
  },
  "alternatives": [
    {
      "action": "hold",
      "reasonCode": "INTENT_NO_ALTERNATIVE",
      "whyNot": "Holding instead of sending the buy intent is always possible"
    }
  ],
  "dataSnapshotId": "6bcc8b50894a6be2918a4b8cfbe556102353bcfc5ea04800be323c1eeef54330",
  "configVersion": "golden-config-v1",
  "seed": 7,
  "reasonCode": "TREND_PULLBACK_ENTRY",
  "reasonText": "Trend pullback entry: close 115.12 is at or below 115.32 while fast SMA 117.68 leads slow SMA 110.07",
  "regime": null,
  "stateBefore": null,
  "stateAfter": null,
  "timing": null,
  "riskChecks": [],
  "correlationId": null,
  "seq": 1484,
  "recordedAt": "2026-11-24T00:09:57.989Z",
  "prevHash": "d58d2185b6d9e7dc21266325abee015d55cafb863af90cdeebcaf4051420ed6e",
  "hash": "c5d560b814129121fcdd4987012aa55f577e9af994754a7f770212dbe416dfa8"
}
```

Last `decision.completed` (seq 3955, final hash above):

```json
{
  "runId": "golden-run-7",
  "clockTime": "2026-01-17T16:00:00.000Z",
  "module": "run",
  "eventType": "decision.completed",
  "severity": "debug",
  "inputs": { "intents": 0, "buys": 0, "sells": 0, "dropped": 0, "tokens": 3 },
  "dataSnapshotId": "6bcc8b50894a6be2918a4b8cfbe556102353bcfc5ea04800be323c1eeef54330",
  "configVersion": "golden-config-v1",
  "seed": 7,
  "reasonCode": "DECISION_CYCLE_COMPLETED",
  "reasonText": "Decision cycle completed with 0 intent(s)",
  "tokenId": null,
  "strategyId": null,
  "regime": null,
  "stateBefore": null,
  "stateAfter": null,
  "timing": null,
  "decision": null,
  "alternatives": [],
  "riskChecks": [],
  "correlationId": null,
  "seq": 3935,
  "recordedAt": "2026-11-24T00:30:01.072Z",
  "prevHash": "c4f4bf3600c270d64ee89d75841b2cfb3e541fb76adca55858b188f2ba6ab45c",
  "hash": "b260f984250cf2cca57610a3fe47c85d91d5f93c26472818f2e21f564226847a"
}
```

## 6. Checklist

Each item is a claim to verify, not an assertion to trust.

1. **Regime priority and hysteresis.** `regime-classifier.ts` adopts CRASH and
   ILLIQUID immediately, requires `regimeDwellBars` (3) confirmations for every
   other change, and keeps `since`/`candidate`/`candidateBars` stable while a
   change is pending. Tests: "adopts CRASH immediately on the first crash bar
   despite dwell", "flags illiquid volume and adopts it immediately", "holds
   TREND_UP for two range-like bars and adopts RANGE on the third", "clears a
   candidate when the raw regime returns to the held regime", "replaces a
   different pending candidate with count 1", "adopts a non-crash change
   immediately when dwell is one bar", "measures crash drawdown over
   max(slowHours, rangeWindowHours)". Golden: CRASH adopted for AAA and CCC on the
   first raw CRASH bar; no premature non-crash adoption across 400 bars.
2. **Recovery confirmation.** RECOVERY requires a prior CRASH or TREND_DOWN, a
   close above the fast SMA and `recoveryConfirmBars` (3) strictly rising fast-SMA
   transitions; the classifier then still needs dwell. The recovery strategy buys
   only after 3 consecutive closes above the fast SMA. Tests: "needs recovery
   confirmation and dwell before leaving CRASH", "requires a prior CRASH or
   TREND_DOWN regime for RECOVERY"; `recovery.test.ts` "needs three consecutive
   closes above the fast SMA before buying", "resets the counter below the fast
   SMA", "resets confirmation memory when the regime is not RECOVERY". Golden:
   every RECOVERY change follows CRASH/TREND_DOWN; AAA and CCC produce
   `RECOVERY_ENTRY` buys.
3. **Strategy exits in hostile regimes.** An open position is always evaluated with
   its original strategy, in every regime. Tests: `decision-engine.test.ts` "keeps
   the original strategy in CRASH and emits a sell intent", "blocks a cooled-down
   buy but still allows a sell", "evaluates a position token outside the universe",
   "evaluates only the position when tokenIds is empty"; strategy tests for stop,
   trend break and trailing exits. Golden: the AAA trend position is stopped out
   on the same bar that AAA is classified CRASH (asserted by matching the
   `order.intent` and `regime.evaluated` clock times).
4. **No adds.** The engine rejects a buy signal while a position exists (logged as
   `strategy.rejected`, reason `STRATEGY_BUY_WITH_POSITION`) and the allocator
   drops tokens that already hold a position (`ALLOC_EXISTING_POSITION`). Tests:
   "logs a defensive buy-with-position rejection through the logger", "never
   returns duplicate (tokenId, side) intents in one cycle", "allocates a duplicate
   token only once and adds it to the held set", "drops a candidate whose token
   already has a position"; strategy tests "never emits buy while a position
   exists", "holds inside the range and never buys with a position", "holds in
   position and never buys". Golden: the host throws on a buy with an open
   position and on a duplicate token intent, so the pinned run proves neither
   happened.
5. **Ranking determinism.** Score is
   `confidence * 1/(atrPct+1) * liquidityFactor`; ties break by score, confidence,
   token id and strategy key in UTF-16 code-unit order; drops sort by token/strategy.
   No `localeCompare`. Tests: "computes confidence * (1 / (atrPct + 1)) *
   liquidityFactor", "breaks a full tie by tokenId in code-unit order", "breaks a
   token tie by strategyKey in code-unit order", "orders drops deterministically by
   tokenId then strategyKey", "does not depend on the input order". Golden: two
   replays (and, in `decision-engine.test.ts`, reversed `tokenIds`) produce the
   same intents and hash.
6. **Allocation and risk limits.** Allocation honours existing positions, max
   positions, token exposure, strategy exposure, cash buffer, per-trade risk,
   liquidity cap and the minimum order, in a fixed precedence, with
   `decimal.js` only. Risk re-checks a concrete size and can only veto; all twelve
   checks are always logged. Tests: `portfolio-allocator.test.ts` (each cap,
   sequential cash reduction, duplicate token, rank order, no snapshot mutation,
   float-drift-free money); `risk-manager.test.ts` "returns all twelve checks in
   contract order and passes", one test per cap, "keeps all twelve checks when an
   early check fails", "reports the first failing check in table order"; golden:
   every intent has a passing complete `risk.checked` immediately before it, and
   the run contains no risk veto at all. The allocator/risk rounding defect found
   in review (F1) is fixed: sizes are truncated to cents, the minimum-order check
   and the allocator's own accounting use the emitted size, and the cap-binding
   case is covered by `portfolio-allocator.test.ts` and `decimal.test.ts`.
7. **Sell exemption from loss limits.** `checkSellRisk` returns exactly
   `data_stale` and `liquidity`; daily loss, drawdown, cooldown, blocked phase,
   exposure and minimum order never gate a sell. Tests: "returns exactly the stale
   and liquidity checks and passes", "never blocks a sell on daily loss, drawdown,
   cooldown or a blocked phase", "never blocks a sell on a portfolio exactly at
   each loss limit", "still checks stale data on a sell", "still checks liquidity
   on a sell"; `decision-engine.test.ts` "blocks a cooled-down buy but still allows
   a sell". Golden: every sell `risk.checked` has exactly the two sell checks and
   passes.
8. **Token states.** Precedence is position → active cooldown → blocked market
   (ILLIQUID/UNKNOWN/stale) → buy intent (ARMED) → SLEEPING; the first phase is a
   change, every transition is logged. Tests: `token-state.test.ts` (precedence,
   cooldown boundary at `now`, every transition, no mutation); golden: BLOCKED
   phases appear during warmup and are logged.
9. **Decision reason and alternatives.** The event schema requires a non-empty
   `reasonCode` for decision-like families (`regime`, `strategy`, `risk`,
   `opportunity`, `portfolio`, `token`, `decision`, `signal`, `order`, `position`)
   and at least one alternative whenever a `decision` object is present. Tests:
   `event-log.test.ts` "requires a reasonCode for decision-like events",
   "rejects a decision event without alternatives"; golden: every event with a
   `decision` has both.
10. **Risk check completeness.** Buy checks are logged in contract order
    (`max_positions`, `max_token_exposure`, `max_strategy_exposure`, `cash_buffer`,
    `daily_loss_limit`, `max_drawdown`, `per_trade_risk`, `liquidity`,
    `data_stale`, `cooldown`, `token_blocked`, `size_too_small`) with decimal
    `value`/`limit`, even when an earlier check fails; sells log two. Golden:
    the exact name arrays are asserted for all 33 intents.
11. **Deterministic golden hash.** Two `replay()` calls in one test produce
    identical intents and the same final hash; the hash, event count and intent
    list are literals. `eventHash` excludes `recordedAt`/`timing`, so wall-clock
    time cannot leak. Tests: golden file; `event-log.test.ts` "is deterministic
    regardless of recordedAt"; `decision-engine.test.ts` "produces the same hash
    and intents twice and when tokenIds are reversed".
12. **No look-ahead.** The engine reads candles only through `MarketView`; the
    golden host asserts at every bar that exactly `barIndex + 1` candles are
    visible per token and that the latest close is the current bar. Tests:
    `market-view.test.ts` boundary tests; `decision-engine.test.ts` "ignores
    candles that close after clockTime"; classifier stale/future-candle tests
    ("treats a candle that closes after now as stale look-ahead data").
13. **No old imports.** `grep -rn "@nexter/\|apps/\|ai-trading\|trading-bots"
packages/sandbox-core/src --include=*.ts` returns 0 matches. Runtime deps are
    `decimal.js` and `zod` only.
14. **No `any`.** `grep -rn ": any\|<any>\|as any\|any\[\]"
packages/sandbox-core/src --include=*.ts` returns 0 matches; public types are
    explicit (`DecisionInput`, `DecisionResult`, `OrderIntent`,
    `SandboxRiskCheck`, strategy/ranking/allocation inputs and outputs).
15. **Decimal money.** Every money value is a string and every money computation
    runs through `decimal.js` (`decimal.ts`, allocator, risk manager); native
    numbers are limited to indicators, regime features, ranking scores and
    strategy rule comparisons, as the design permits. Tests: `decimal.test.ts`
    (parsing/rejection, half-up formatting, no float drift), allocator "keeps
    decimal money free of float drift", risk "formats money and percentage values
    as two-decimal strings"; golden: all sizes match `^\d+\.\d{2}$` and amounts
    `^\d+\.\d{8}$`.

## 7. Findings

### F1 — Major (fixed): allocator half-up rounding could exceed the risk caps it was sized against

**Root cause.** `allocateOpportunities` rounded the chosen size with `money()` →
`Decimal.toFixed(2)` (half-up). `checkBuyRisk` then re-derived the limit from the
exact equity and compared the **rounded** size with `lessThanOrEqualTo`. When the
binding cap had more than two decimals and the third decimal was 5–9, the rounded
size was strictly above the cap and the risk manager vetoed the very allocation the
allocator produced. The check logged `value: "20.00"`, `limit: "20.00"`,
`passed: false`, which was very hard to diagnose. The allocator had also updated
its own token/strategy/cash accounting with the unrounded size, so its state did
not match the emitted order.

Reproduction before the fix (default settings, equity 992.14, cash 992.14, no
positions, one `trend_pullback` candidate with stop 1.28%):

```
allocateOpportunities -> sizeUsd "198.43"   (exact token cap 992.14 * 20% = 198.428)
checkBuyRisk          -> passed false, failedCode RISK_TOKEN_EXPOSURE
                         max_token_exposure value "20.00" limit "20.00" passed false
```

The same seam hit the per-trade risk cap: in the pre-fix golden replay AAA was
vetoed twice with size `168.33`, `per_trade_risk value "5.05" limit "5.05"
passed false`. In that run **24 of 42 sized buy attempts were vetoed**, 22 by
`max_token_exposure` (BBB 18, CCC 4) and 2 by `per_trade_risk` (AAA 2). It did not
break money safety (nothing unsafe was emitted), but it silently dropped valid
entries and made entry availability depend on cent parity.

**Fix (this commit; no risk formula or cap percentage changed).**

- `decision/decimal.ts` adds `moneyDown(value)` → `toFixed(2, ROUND_DOWN)`.
  `money()` stays half-up for display and risk values.
- `portfolio-allocator.ts` now emits `moneyDown(size)`; runs the `minOrderUsd`
  check against the floored size; and updates `openPositions`, `tokenValues`,
  `strategyValues` and `cashAvailable` with the floored emitted size, so the
  allocator's accounting matches the order exactly. `bindingConstraint` still
  comes from the exact minimum.
- Regression tests: `decimal.test.ts` (`moneyDown` truncates `1.239 → 1.23`,
  `1.999 → 1.99`, `198.428 → 198.42`, `money` stays half-up);
  `portfolio-allocator.test.ts` (equity 992.14 / 20% cap → `198.42`, allocation
  accepted, and a following `checkBuyRisk` passes all twelve checks; equity
  100.04 / 10% cap → exact `10.004`, floored `10.00` below `minOrderUsd 10.004`
  → `ALLOC_SIZE_TOO_SMALL`; two 20% caps on equity 1000.03 emit `200.00` each and
  account with the floored value).
- The golden replay now pins zero risk vetoes (`risk.checked` with
  `decision.action: block`), which fails if this seam regresses.

**Deliberate contract change.** Fixing the seam changes decisions, so the golden
pin was re-pinned in the same commit (section F1.1). This is the deliberate contract
change the plan requires; nothing was silently re-pinned.

### F1.1 Golden re-pin after the fix (deliberate)

| Pin               | Before F1 fix                                                      | After F1 fix                                                       |
| ----------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| final `eventHash` | `b12d5c283de46ab4b51b3b09b62034f5d734f28b1850ad6b6097239c0b2946c0` | `b260f984250cf2cca57610a3fe47c85d91d5f93c26472818f2e21f564226847a` |
| total events      | `3956`                                                             | `3936`                                                             |
| intents           | `33` (18 buys / 15 sells)                                          | `45` (24 buys / 21 sells)                                          |
| final host equity | `1054.23` USD                                                      | `1047.32` USD                                                      |
| risk-vetoed buys  | `24` of 42 sized                                                   | `0`                                                                |
| open positions    | `AAA`, `BBB`, `CCC`                                                | `AAA`, `BBB`, `CCC`                                                |

The first four sample events in section 5.5 are byte-identical before and after
(same `seq`/hash): they precede the first decision that the fix changes. Only the
last `decision.completed` sample and the later events differ.

### F2 — Minor/deferred: entry during the first bars of a crash while the old trend regime is held

The classifier needs `regimeDwellBars` for TREND_DOWN and only switches to CRASH
at a 12% drawdown. `CCC` therefore shows a `TREND_PULLBACK_ENTRY` on the second
bar of its 40-bar crash (the price is already ~2% below the fast SMA while
`TREND_UP` is still held) and is stopped ~3% later (`TREND_PULLBACK_STOP`). The
stop caps the loss and the event log explains it, but the entry is economically a
falling-knife entry. Options for the design owner: gate entries on the raw regime,
require the drawdown to be below a crash-warning threshold, or accept it as the
cost of hysteresis. No change in this task.

### F3 — Informational: fixture deviation for the range token

`BBB` uses a 24-bar sine period (not 48) so the fast/slow SMA spread stays inside
`rangeSpreadPct`; see section 5.1. This is a test-fixture decision only.

### F4 — Informational: the golden host is not Stage 1C

The host marks positions, computes equity and fills at the decision price with no
fees. It exists only to exercise `decide`; it is not a ledger, has no cost-basis
policy beyond the decision price, and force-closes nothing at the end (three
positions remain open). Stage 1C owns fills, fees, the ledger and equity.

## 8. Stage 1A debt closure (Task 1, commit `ec31b56`)

| Stage 1A deferred item                                | Closure                                                                                                                                                                                  | Tests                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Non-positive prices accepted                          | `assertPrice` rejects `<= 0` for open/high/low/close and negative zero; `assertVolume` rejects negative volume, accepts `0`                                                              | `candles.test.ts` "rejects zero and negative prices in every OHLC field", "rejects a negative zero price", "accepts a zero volume but rejects a negative volume"                                                                                                           |
| Source/close-time failures reported as handler errors | `DataSourceError` + `DATA_SOURCE_ERROR` classification, original error rethrown                                                                                                          | `replay-runner.test.ts` "classifies a failing candle source as DATA_SOURCE_ERROR and rethrows the original", "classifies an unresolvable candle close time as DATA_SOURCE_ERROR"                                                                                           |
| `data.out_of_order` payload incomplete                | Adds `candleOpenTime`, `candleCloseTime`, `timeframe`, `clockTime`                                                                                                                       | "includes candleCloseTime and timeframe in the data.out_of_order payload"                                                                                                                                                                                                  |
| CLI did not close the log on failure                  | `try/finally` around the runner in `runReplayFromFile`                                                                                                                                   | `replay.test.ts` "closes the event log when the replay fails"                                                                                                                                                                                                              |
| Mixed timeframes silently accepted                    | Rejected with `Mixed timeframes are not supported: …`; run uses the first candle timeframe                                                                                               | "rejects mixed timeframes in one file", "uses the first candle timeframe for the run config"                                                                                                                                                                               |
| CLI flag parsing unvalidated                          | Pure `parseReplayArgs`: `--` skipped, missing/flag-as-value rejected, safe-integer seed                                                                                                  | "parses every flag", "defaults the seed and the output path from the run id", "rejects a missing file flag", "rejects a flag used as a value", "rejects a non-integer or non-numeric seed", "accepts negative and zero safe integer seeds", "rejects a missing seed value" |
| Non-JSON event payloads could reach the hash          | `assertJsonValue` validates `inputs`/`stateBefore`/`stateAfter`/`timing` before hashing (rejects functions, symbols, bigints, non-finite numbers, Date/Map/Set, class instances, cycles) | `json-value.test.ts` (all cases) plus the event-log wiring/equivalence tests                                                                                                                                                                                               |
| Decision-like events could omit `reasonCode`          | Schema regex extended to `regime                                                                                                                                                         | opportunity                                                                                                                                                                                                                                                                | portfolio | token | decision` | `event-log.test.ts` "requires a reasonCode for decision-like events", "accepts decision-like events that carry a reasonCode" |

Stage 1A golden values (`configVersion`, `dataSnapshotId`, `eventHash 1e762672…`)
are unchanged; the CLI smoke in section 4.6 still returns 3 candles / 8 events.

## 9. Deferred items

| #   | Item                                                                                                            | Severity |
| --- | --------------------------------------------------------------------------------------------------------------- | -------- |
| F2  | Falling-knife entry during the first bars of a crash while the old trend regime is still held                   | Minor    |
| D1  | `regimeDwellBars` is global; per-regime dwell tuning is not implemented                                         | Minor    |
| D2  | Cooldowns are host-provided: the engine derives `COOLDOWN` from `cooldownUntil` but never sets one              | Minor    |
| D3  | The golden test's fill host is intentionally naive (no fees, no slippage, no partial fills); Stage 1C owns them | Minor    |
| D4  | Take-profit is always `null` in Stage 1B; exits are strategy-driven only                                        | Minor    |
| D5  | `Money`/percent formatting is two-decimal display formatting; higher-precision ledger values belong to Stage 1C | Minor    |

F1 is fixed and no longer deferred. Nothing open is deferred that could move money,
read live data, or write outside the package.

## 10. Gate

**Stage 1C must not start until this review is signed off.**

- The reviewer does not edit code; findings are returned to the implementer.
- F1 is already fixed with regression tests, a full gate re-run and a deliberate
  golden re-pin; verify the fix and the re-pin.
- Any further critical/major finding must be fixed and the full gate (tests,
  typecheck, build, lint, format) re-run before Stage 1C.
- Minor findings may be deferred only if recorded in the review outcome.
- Stage 1B acceptance means this packet is signed off with no open
  critical/major findings, and only then may Stage 1C (intent consumption,
  execution, ledger, reporting) begin.

Review outcome template:

```
Reviewer:
Date:
Commit reviewed: b407592 + the review-request commit + the F1 fix commit
Verdict: approved | approved with findings | changes required

Critical findings (block Stage 1B):
- ...

Major findings (fix before Stage 1C):
- ...

Minor findings (may be deferred):
- ...

Spec coverage: pass | fail (notes)
Quality: pass | fail (notes)
```
