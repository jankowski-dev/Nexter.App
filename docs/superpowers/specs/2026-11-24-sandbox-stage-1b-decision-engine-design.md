# Sandbox Stage 1B — decision engine (regime, strategies, portfolio, risk) design

Date: 2026-11-24
Status: **approved in principle under owner pre-approval; Stage 1A signed off**
Scope: Stage 1B only. No fills, ledger, P&L report, UI, live data, real money or execution. Stage 1C stays blocked until Stage 1B is signed off.

Base: Stage 1A design `docs/superpowers/specs/2026-11-23-sandbox-core-replay-design.md` (signed off; merged as `28176d1`).

## 1. Intent

Build the deterministic decision layer of the sandbox:

```
regime -> eligible strategy -> signal -> opportunity ranking -> allocation -> risk veto -> order intent + event log
```

Stage 1B is a pure per-bar decision engine. It receives closed candles, a portfolio snapshot and runtime state; it returns proposed `OrderIntent`s and structured log events. It does **not** fill orders, hold the ledger or compute equity. Stage 1C will consume the intents, fill them, maintain the ledger and produce reports.

The owner wants:

- a rule-based adaptive system, not online learning;
- long-only spot decisions;
- hours horizon (1h decisions, days of context);
- some tokens sleep while others work;
- no forced trading; cash is a valid state;
- maximum logging: every regime, signal, ranking, veto and intent explainable;
- the same deterministic input must produce the same decisions and log hash.

## 2. Goals and non-goals

### Goals

1. Deterministic, versioned regime classifier with hysteresis.
2. Three independent strategy families: trend pullback, range reversion, recovery.
3. Regime-based eligibility; open positions keep their original strategy for exits even if the regime changes.
4. Opportunity ranking across tokens.
5. Portfolio allocator with explicit risk limits and cash buffer.
6. Hard risk veto with one log record per check.
7. Token state view (`SLEEPING`, `ARMED`, `IN_POSITION`, `COOLDOWN`, `BLOCKED`).
8. Decision engine that emits `OrderIntent`s and a complete event log; no execution.
9. Unit/property tests for rules, limits, determinism and logging.
10. Independent Stage 1B review gate.

### Non-goals

- No fills, fees, slippage, ledger, equity, P&L or report (`Stage 1C`).
- No UI/HTTP/DB/persistence.
- No live data, real money, wallets or signing.
- No ML/online learning/parameter fitting.
- No shorting, leverage, derivatives or market making.
- No old AI/legacy imports.
- No changes to Stage 1A data/log contracts except the Stage 1B debt listed in §10.

## 3. Defaults and constraints

The owner approved the earlier defaults. They are configuration, not hard-coded behavior.

| Setting                   |                  Default |
| ------------------------- | -----------------------: |
| Initial paper capital     |                   $1,000 |
| Timeframe                 |                       1h |
| Max open positions        |                        5 |
| Max exposure per token    |            20% of equity |
| Max exposure per strategy |            40% of equity |
| Cash buffer               |            10% of equity |
| Daily loss limit          |                       2% |
| Max drawdown              |                      15% |
| Per-trade risk            |             1% of equity |
| Minimum order             |                      $10 |
| Liquidity cap             | 1% of 24h average volume |
| Decision frequency        |    each closed 1h candle |
| Long-only                 |                      yes |

All monetary values remain decimal strings; no JS float for money. Indicators may use native numbers for ranking/classification only; order sizes and risk values are decimal strings.

## 4. Architecture

```
DecisionContext (now, dataSnapshotId, candles, portfolio, state, settings)
        │
        ▼
RegimeClassifier (per token, stateful hysteresis)
        │
        ▼
StrategySet (eligible by regime; open positions use their original strategy)
        │
        ▼
OpportunityRanker (buy candidates only)
        │
        ▼
PortfolioAllocator (cash, exposure, position count, risk-based size)
        │
        ▼
RiskManager (hard veto; one check per limit)
        │
        ▼
DecisionResult (intents, states, regimes, signals, checks) + EventLog
```

Stage 1B is a new module inside `packages/sandbox-core`:

```
src/decision/
  types.ts
  defaults.ts
  reason-codes.ts
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
  decision-engine.ts
  decision-logger.ts
```

No persistence; all state is passed in and returned. The host (Stage 1C) owns persistence and fills.

## 5. Regime classifier

### 5.1 Indicators

From closed candles only (the current candle is included only after its close):

- fast SMA (`fastHours`, default 24);
- slow SMA (`slowHours`, default 168);
- long SMA (`longHours`, default 720; optional if history is shorter);
- ATR(14) as a percentage of price;
- recent high/low over `rangeWindowHours` (default 72);
- average `volumeUsd` over `liquidityWindowHours` (default 24);
- drawdown from the recent high over `max(slowHours, rangeWindowHours)`.

All indicator periods are configurable so tests can use small fixtures. `regimeRulesVersion` is fixed per run.

### 5.2 Regimes and priority

| Regime       | Rule sketch                                                                                           |
| ------------ | ----------------------------------------------------------------------------------------------------- |
| `ILLIQUID`   | insufficient history, missing/stale candles, or average volume below `minLiquidityUsd`                |
| `CRASH`      | drawdown from recent high ≥ `crashDrawdownPct` or ATR% ≥ `crashAtrPct`                                |
| `RECOVERY`   | prior regime was `CRASH`/`TREND_DOWN`, price reclaimed fast, fast is rising for `recoveryConfirmBars` |
| `TREND_UP`   | fast > slow by `trendSpreadPct`, price > slow, ATR% ≤ `trendMaxAtrPct`                                |
| `TREND_DOWN` | fast < slow by `trendSpreadPct`, price < slow                                                         |
| `RANGE`      | fast/slow within `rangeSpreadPct`, ATR% ≤ `rangeMaxAtrPct`, price inside recent range                 |
| `UNKNOWN`    | none of the above                                                                                     |

Priority is `ILLIQUID > CRASH > RECOVERY > TREND_UP/TREND_DOWN > RANGE > UNKNOWN`.
`CRASH` and `ILLIQUID` switch immediately; other regimes require `regimeDwellBars` consecutive confirmations (hysteresis).

Defaults: `trendSpreadPct=0.5`, `trendMaxAtrPct=8`, `rangeSpreadPct=0.75`, `rangeMaxAtrPct=3.5`, `crashDrawdownPct=12`, `crashAtrPct=10`, `recoveryConfirmBars=3`, `regimeDwellBars=3`, `minLiquidityUsd=50000`.

`RegimeState` stores current regime, candidate, consecutive count, since, features and version. The classifier returns a new state and a log payload.

## 6. Strategy families

### 6.1 Interface

```ts
export interface StrategyContext {
  now: Timestamp;
  tokenId: string;
  timeframe: string;
  regime: Regime;
  candles: readonly Candle[];
  position: PortfolioPosition | null;
  state: Readonly<Record<string, unknown>>;
}

export interface StrategySignal {
  action: 'buy' | 'sell' | 'hold';
  reasonCode: string;
  reasonText: string;
  confidence: number; // 0..1
  riskWeight: number; // 0..1, e.g. recovery 0.5
  stopLossPct: string | null;
  takeProfitPct: string | null;
  nextState: Readonly<Record<string, unknown>>;
}

export interface StrategyDefinition<P extends object> {
  key: StrategyKey;
  version: number;
  eligibleRegimes: readonly Regime[];
  defaultParams: P;
  evaluate(ctx: StrategyContext, params: P): StrategySignal;
}

export interface StrategyRuntime {
  key: StrategyKey;
  version: number;
  eligibleRegimes: readonly Regime[];
  evaluate(ctx: StrategyContext): StrategySignal;
}
```

`createStrategySet(settings)` closes each typed definition over its params and returns a uniform runtime record, so the engine never needs `any`. The concrete Stage 1B interfaces, defaults and event catalog are pinned in `docs/superpowers/plans/2026-11-24-sandbox-stage-1b.md`.

### 6.2 Eligibility and open positions

- New entries: only the strategies eligible for the current regime.
  - `TREND_UP` → `trend_pullback`
  - `RANGE` → `range_reversion`
  - `RECOVERY` → `recovery`
  - `CRASH`, `TREND_DOWN`, `ILLIQUID`, `UNKNOWN` → no new entries.
- An open position always evaluates its **original** strategy for exits, regardless of the current regime. A regime switch never strands a position.
- Strategy switches are logged; they affect new entries only.

### 6.3 Trend pullback

- Params: `fastPeriod=24`, `slowPeriod=168`, `pullbackPct=2`, `atrStopMult=2.5`, `trailPct=5`.
- Entry (`TREND_UP`, no position): fast > slow, price > slow, price ≤ fast × (1 − pullbackPct/100).
- In position:
  - ATR hard stop: price ≤ avgCost × (1 − atrStopMult × ATR%/100);
  - trend break: fast < slow;
  - trailing: after +5% or existing trail, exit at HWM × (1 − trailPct/100).
- State: `hwm`, `trail`.
- No adds in Stage 1B; additions are a later policy decision.

### 6.4 Range reversion

- Params: `lookback=72`, `bandAtrMult=1.5`, `stopAtrMult=2`.
- Entry (`RANGE`, no position): price ≤ rangeMid − bandAtrMult × ATR.
- In position: exit at rangeMid, or hard stop at avgCost − stopAtrMult × ATR.
- No state.
- Long-only: it buys weakness inside a range, never shorts.

### 6.5 Recovery

- Params: `fastPeriod=24`, `confirmBars=3`, `stopPct=3`, `riskWeight=0.5`.
- Entry (`RECOVERY`, no position): price > fast for `confirmBars` consecutive closed candles (state counter).
- In position: exit if price < fast or stopPct is hit.
- Smaller `riskWeight` until Stage 1C/forward validation proves the mode.

## 7. Opportunity ranking and portfolio allocation

### 7.1 Ranking

Only buy signals become opportunities. Score:

```
score = confidence × (1 / (atrPct + 1)) × liquidityFactor
```

`liquidityFactor` is 1 when average volume ≥ 2 × minLiquidityUsd, 0.5 at the minimum, linear between; below minimum the signal is `ILLIQUID`.
Tie-break: score desc, then confidence desc, then tokenId code-unit asc, then strategyKey code-unit asc. Deterministic.

### 7.2 Allocation

For each ranked opportunity, in order:

1. If the token already has a position → skip (no adds in Stage 1B).
2. If `openPositions >= maxPositions` → stop (remaining dropped with `MAX_POSITIONS`).
3. `tokenCap = equity × maxTokenExposurePct/100 − currentTokenValue`.
4. `strategyCap = equity × maxStrategyExposurePct/100 − currentStrategyValue`.
5. `cashAvailable = cash − equity × cashBufferPct/100`.
6. `riskUsd = equity × perTradeRiskPct/100 × riskWeight`.
7. `stopDistancePct = stopLossPct ?? defaultStopPct` (default 3%).
8. `sizeByRisk = riskUsd / (stopDistancePct/100)`.
9. `liquidityCap = averageVolumeUsd × liquidityCapPct/100`.
10. `size = min(tokenCap, strategyCap, cashAvailable, sizeByRisk, liquidityCap)`.
11. If `size < minOrderUsd` → drop with `SIZE_TOO_SMALL`.
12. Emit `OrderIntent` with size and stop/take.

Sells are not ranked and do not consume buy capacity. For an open position, the strategy's sell signal emits a full-close intent (`amount = position.amount`, `sizeUsd = position.marketValueUsd`); risk still checks data/liquidity, but a sell is allowed to reduce risk even when daily/drawdown limits are hit.

`OrderIntent` IDs are deterministic: `runId:tokenId:side:clockTime:strategyKey`.

## 8. Risk manager

Every buy intent is checked individually; each check is logged with value/limit/passed:

- `max_positions`
- `max_token_exposure`
- `max_strategy_exposure`
- `cash_buffer`
- `daily_loss_limit`
- `max_drawdown`
- `per_trade_risk`
- `liquidity`
- `data_stale`
- `cooldown`
- `token_blocked`
- `size_too_small`

A failed check drops the intent with its reason code and at least one alternative (e.g., another ranked token or “do nothing”). Sells only check `data_stale` and `liquidity` (can't price a stale/illiquid exit); a sell is never blocked by daily loss or drawdown.

## 9. Token state view

The engine returns a view, not a persisted state machine:

- `IN_POSITION` if the portfolio has a position for the token;
- `COOLDOWN` if `cooldownUntil > now` (provided by the host);
- `BLOCKED` if regime is `ILLIQUID`/`UNKNOWN` or data is stale;
- `ARMED` if a buy signal survives ranking/risk and becomes an intent;
- `SLEEPING` otherwise.

State changes are logged as `token.state_changed` with `from`/`to` and reason. Stage 1C owns persistence and fills.

## 10. Stage 1B debt from Stage 1A

Close the final-review first-1B items in the first Stage 1B task:

- `DATA_SOURCE_ERROR` (and a source-throws test) instead of labeling source failures `HANDLER_ERROR`;
- include `candleCloseTime`/`timeframe` in `data.out_of_order`;
- `try/finally` close in the CLI;
- non-negative prices and non-negative volume validation;
- explicit mixed-timeframe rejection in the CLI;
- CLI `--seed` integer validation, flag-value guard and output hygiene;
- JSON-value guard for event `inputs`/state (`Date`/Map/function/symbol cannot silently degrade);
- event-family/reason-code rule for the Stage 1B vocabulary (at least for decisions produced by this engine).

Accepted/deferred: atomic log open (single-writer documented), `.strict()` schema, frozen event types, async live source and duplicate-source contract (Stage 2).

## 11. Logging

Use the Stage 1A `EventLog`. Add a `DecisionLogger` with base fields (`runId`, `seed`, `configVersion`, `dataSnapshotId`, `clockTime`) and methods for:

- regime change/hold;
- strategy evaluated/selected/switched;
- signal generated/rejected;
- opportunity ranked/dropped;
- risk check;
- order intent;
- token state change.

Every decision with a `decision` object carries a stable `reasonCode` and at least one alternative (R9). Alternatives include other tokens/strategies and “do nothing”. No free-text-only decisions.

## 12. Testing

- Regime classifier: one fixture per regime, hysteresis, insufficient history, ILLIQUID, CRASH priority, RECOVERY confirmation.
- Strategies: entry/exit, state transitions, no entries outside eligible regimes, open-position exits in hostile regimes, no adds.
- Ranking/allocator: deterministic order, max positions, token/strategy/cash/liquidity limits, `SIZE_TOO_SMALL`, no forced trades.
- Risk: every check passes/fails; buys blocked by daily/drawdown; sells allowed to reduce risk.
- Token state: all five states and transitions.
- Decision engine: multi-token bar, every decision logged with reason + alternative, no duplicate intents, deterministic hash across two runs, no execution.
- Stage 1A debt tests.

## 13. Review gate

Independent read-only review after each task and one Stage 1B whole-branch review. Gate:

- rules/versioning and hysteresis are clear;
- strategies independent and exit-safe;
- allocation/risk invariants;
- every decision has reason + alternative;
- no look-ahead, no execution, no old imports;
- deterministic tests/log hash;
- Stage 1A debt closed.

Stage 1C must not start until Stage 1B is signed off.

## 14. Success criteria

1. Deterministic regime/strategy/ranking/allocation/risk decisions from the same inputs.
2. No buy intent violates a risk limit; no sell is blocked by loss/drawdown.
3. Open positions are never stranded by a regime switch.
4. Every decision has a reason code and at least one alternative.
5. Tests cover regimes, strategies, limits, states and logging.
6. Independent Stage 1B review clean.
7. Stage 1C can consume `OrderIntent`s without changing the decision contracts.

## 15. Open assumptions

- The Stage 1B host (Stage 1C) supplies a portfolio snapshot, cooldowns and strategy state.
- Real candle data will be 1h UTC; tests use small configurable windows.
- The owner-approved defaults in §3 are starting parameters, not optimized values.
- No Stage 1B decision is a live trade; Stage 1C performs paper fills only after its own gate.
