# Sandbox core + historical replay — design (Stage 1)

Date: 2026-11-23
Status: **approved; Stage 1A implemented; final review gate**
Section name: **Песочница**
Scope: Stage 1 only — headless decision core + historical replay. No UI, no live data, no real money.

---

## 1. Intent

Build the decision core of an autonomous trading sandbox on real market data, and validate it with an event-driven historical replay that behaves like the future live system.

The owner wants:

- a new independent system, not tied to the old AI search or legacy bots;
- real market data, paper trades only;
- autonomous operation inside pre-approved limits;
- the owner can only pause, stop the whole run, or close an individual trade;
- strategy switching by market rules, not online learning;
- hours horizon: decisions on 1h candles, risk checks as often as data allows;
- maximum logging: every step, every rejection, every alternative must be explainable during debugging;
- independent review after every stage; no stage is accepted on the author's word alone.

The first goal is not profit. The first goal is a **trustworthy engine**: no look-ahead, correct accounting, deterministic replay, complete decision journal. Profitability is evaluated only after the engine passes those gates.

---

## 2. Goals

1. One core, two clocks: the same decision code runs on historical data now and on live data later.
2. Event-driven replay: time moves forward; the engine sees only data that existed at that moment.
3. Multi-token portfolio: tokens can sleep, wait, trade, cooldown, or be blocked.
4. Rule-based regime detection and strategy switching.
5. Paper execution with fees, slippage, next-candle fills, liquidity limits.
6. Risk limits: max positions, per-token exposure, cash buffer, daily loss, max drawdown, cooldowns.
7. Maximum logging: every decision, rejection, alternative, risk check, fill, and state change.
8. Post-run counterfactual analysis: what would have happened if a rejected signal or skipped strategy had been taken. Clearly labeled as hindsight; never used for live decisions.
9. Independent review gates after each stage.
10. Reproducibility: same data + same config + same seed = same event log hash and same report.

## 3. Non-goals (Stage 1)

- No new UI section yet; no charts, buttons, or run management UI.
- No live data feed; no real-time loop.
- No real money, wallet, private keys, CEX API keys, or signing.
- No online learning, RL, or self-modifying parameters. Rules only.
- No shorting, leverage, derivatives, or market making.
- No dependency on old AI search, legacy strategies, old bot runner, or old holdout gates.
- No changes to existing production systems.

## 4. Constraints

- Long-only spot, paper.
- Horizon: 1h decisions; risk checks once per candle in Stage 1. If 5m/15m data is available later, risk checks can be more frequent without changing the core.
- Data: existing historical candles/quotes; real data, not synthetic, for the first validation. Synthetic/stress fixtures are allowed only for engine tests.
- No look-ahead: the data source must refuse any read beyond the replay clock.
- No gate loosening: the sandbox has its own risk rules, but they must be explicit, fixed at run start, and reviewed.
- Max logging must not change decisions; logging is append-only and side-effect free.
- The engine must be deterministic for a given run.
- The new system must be separable from old code; if old systems are deleted later, the sandbox core remains.

---

## 5. Approaches considered

### A. Build the full app first (UI + live + core)

Rejected. It would freeze UX decisions around unproven rules, slow down iteration, and make it harder to distinguish engine bugs from UI bugs.

### B. Build a throwaway simulator first, then rewrite for live

Rejected. If the simulator has different code paths, its results do not transfer. A profitable simulator with a separate live engine is a false signal.

### C. Build a headless core + replay first, then wrap it with live data and UI

Recommended. The core is the future live engine. The replay is a data player around it. The UI is a shell around the same core. Fast iteration now; no rewrite later.

### D. Use an existing trading framework

Rejected for Stage 1. The product needs custom accounting, custom risk rules, and independence from old systems. Existing frameworks can be studied, but not adopted as the core.

---

## 6. Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        Песочница core                        │
│                                                              │
│  HistoricalClock / LiveClock                                 │
│          │                                                   │
│          ▼                                                   │
│  DataSource (history now, live later)                        │
│          │                                                   │
│          ▼                                                   │
│  MarketState / RegimeRules                                   │
│          │                                                   │
│          ▼                                                   │
│  StrategySet (trend / range / recovery)                      │
│          │                                                   │
│          ▼                                                   │
│  OpportunityRanker                                           │
│          │                                                   │
│          ▼                                                   │
│  PortfolioAllocator                                          │
│          │                                                   │
│          ▼                                                   │
│  RiskManager (hard veto)                                     │
│          │                                                   │
│          ▼                                                   │
│  PaperExecution (fills, fees, slippage)                      │
│          │                                                   │
│          ▼                                                   │
│  Ledger + EventLog + Report                                  │
└──────────────────────────────────────────────────────────────┘
```

### 6.1 Clock and data source

- `Clock` exposes `now()` and `advanceTo(timestamp)`.
- `HistoricalDataSource` streams candles/quotes in chronological order, only up to `clock.now()`.
- `LiveDataSource` (Stage 2) implements the same interface with real-time updates.
- A look-ahead guard records every data access; any access to a timestamp after `clock.now()` throws and fails the run.
- Data snapshots are immutable and identified by `dataSnapshotId`; every decision log references the snapshot.

### 6.2 Market state and regime rules

Stage 1 uses deterministic rules, not ML. Proposed regimes:

| Regime       | Rule sketch                                                         |
| ------------ | ------------------------------------------------------------------- |
| `TREND_UP`   | fast trend above slow, price above slow, volatility not extreme     |
| `TREND_DOWN` | fast trend below slow, price below slow                             |
| `RANGE`      | fast/slow close, price oscillates around mean, volatility moderate  |
| `CRASH`      | sharp drawdown or volatility spike                                  |
| `RECOVERY`   | after crash/downtrend, price reclaims fast, trend not yet confirmed |
| `ILLIQUID`   | liquidity/spread/data quality below threshold                       |

Rules are versioned (`regimeRulesVersion`) and fixed at run start. Hysteresis/confirmation is required to avoid regime flapping.

### 6.3 Strategy set (MVP proposal)

Stage 1 starts with three families, each with explicit entry/exit/risk:

1. **Trend / pullback** — buy a pullback in a confirmed uptrend; exit on trend break, ATR stop, crash, or trailing.
2. **Range / mean reversion** — in a range, buy near the lower band/support and sell near the middle/upper band; small size, hard stop.
3. **Recovery** — after a crash/downtrend, small-size entry when price stabilizes and reclaims the fast average; tight stop; exit if recovery fails.

The exact rules are part of the implementation plan, not this design. The design fixes the interfaces and the requirement that each strategy is independently testable and explainable.

### 6.4 Opportunity ranking and portfolio allocation

- Every cycle, the engine ranks all eligible opportunities across tokens.
- Rank inputs: signal confidence, expected move, volatility, liquidity, correlation, current exposure, cash.
- The allocator chooses which opportunities receive capital; others remain `SLEEPING`.
- No forced trading: if no opportunity passes, the run stays in cash.
- Strategy switching is rule-based: the regime matrix decides which strategy families are eligible. A strategy switch is logged with `from`, `to`, `reasonCode`, and the features that triggered it.
- Hysteresis/minimum dwell time prevents strategy flapping.

### 6.5 Risk manager

Hard veto, deterministic, evaluated before every order:

- max open positions;
- max exposure per token;
- max exposure per strategy family;
- cash buffer;
- daily loss limit;
- max drawdown;
- per-trade risk;
- liquidity/spread/price-impact limit;
- data staleness/gap check;
- cooldown/blocked token state.

Risk checks are logged individually: name, value, limit, passed/failed. A failed check blocks the order and records the reason.

### 6.6 Paper execution

- Decision at candle close; fill at next candle open by default.
- Fees and slippage are configurable and fixed at run start.
- Liquidity cap: order size cannot exceed a configurable fraction of candle volume.
- No fills at a price that did not exist in the data.
- Stops/trailing are evaluated on the same clock; intrabar behavior is explicit (no magic fills).
- Every order/fill/rejection is logged with the data snapshot and the simulated market state.

### 6.7 Ledger

- Cash, positions, lots, realized/unrealized P&L, fees, slippage.
- Invariants: cash >= 0; equity = cash + positions; every trade has a fill; fees/slippage accounted; no duplicate fills.
- Reconciliation test after every run.
- Append-only trade/position events; corrections are new events, not edits.

---

## 7. Maximum logging (first-class requirement)

Logging is part of the product, not a debug afterthought. The run must be reconstructable from the log + data snapshot.

### 7.1 Event schema

Every event is a structured record:

```json
{
  "runId": "uuid",
  "seq": 12345,
  "clockTime": "2026-05-01T12:00:00Z",
  "module": "regime|strategy|portfolio|risk|execution|ledger|manual",
  "eventType": "signal.rejected",
  "severity": "decision|info|warn|error",
  "tokenId": "uuid|null",
  "strategyId": "trend_pullback|range|recovery|null",
  "regime": "TREND_UP|RANGE|...",
  "stateBefore": {},
  "stateAfter": {},
  "inputs": {},
  "decision": {
    "action": "buy|sell|hold|block",
    "sizeUsd": "0",
    "reasonCode": "NO_PULLBACK",
    "reasonText": "price is 0.8% above fast SMA; pullback threshold is 2.0%"
  },
  "alternatives": [
    {
      "action": "buy",
      "reasonCode": "WOULD_BUY",
      "whyNot": "risk.max_token_exposure would be exceeded"
    }
  ],
  "riskChecks": [
    { "name": "max_token_exposure", "value": "12.0", "limit": "10.0", "passed": false }
  ],
  "dataSnapshotId": "uuid",
  "configVersion": "sha256:...",
  "seed": 7,
  "correlationId": "cycle-123"
}
```

### 7.2 Required event types

- Run: `run.started`, `run.paused`, `run.resumed`, `run.stopped`, `run.finished`, `run.failed`.
- Data: `data.tick`, `data.gap`, `data.stale`, `data.outlier`, `data.source_disagreement`.
- Regime: `regime.changed`, `regime.hold`.
- Token: `token.state_changed` (SLEEPING/ARMED/IN_POSITION/COOLDOWN/BLOCKED).
- Strategy: `strategy.eligible`, `strategy.selected`, `strategy.switched`, `strategy.skipped`.
- Signal: `signal.generated`, `signal.rejected`, `signal.expired`.
- Opportunity: `opportunity.ranked`, `opportunity.dropped`.
- Portfolio: `portfolio.allocated`, `portfolio.rebalanced`.
- Risk: `risk.check` (passed/failed).
- Execution: `order.proposed`, `order.simulated`, `order.filled`, `order.rejected`.
- Position: `position.opened`, `position.updated`, `position.closed`, `position.stop_updated`.
- Cooldown: `cooldown.started`, `cooldown.ended`.
- Manual: `manual.pause`, `manual.stop`, `manual.close_trade`.
- Error: `error`.

### 7.3 Reason codes

Every rejection/block has a stable code, for example:

`REGIME_DOWN`, `REGIME_RANGE`, `FAST_BELOW_SLOW`, `SLOW_BELOW_LONG`, `PRICE_BELOW_SLOW`, `NO_PULLBACK`, `COOLDOWN`, `MAX_POSITIONS`, `MAX_TOKEN_EXPOSURE`, `MAX_STRATEGY_EXPOSURE`, `CASH_BUFFER`, `DAILY_LOSS_LIMIT`, `MAX_DRAWDOWN`, `LIQUIDITY`, `SPREAD_TOO_WIDE`, `DATA_STALE`, `DATA_GAP`, `SIZE_TOO_SMALL`, `STRATEGY_NOT_ELIGIBLE`, `MIN_DWELL_TIME`, `MANUAL_BLOCK`.

Reason codes are versioned and documented; no free-text-only rejections.

### 7.4 "Why not" and alternatives

For every decision, log the alternatives the engine considered:

- other tokens that were eligible but lost the ranking;
- other strategies that were eligible but not selected;
- the same token if it was blocked by a risk check;
- the "do nothing" alternative.

This is the core debugging feature: the owner can see not only what happened, but what the system considered and why it chose otherwise.

### 7.5 Counterfactual analysis (post-run only)

After a run, for each rejected signal or skipped strategy, the engine can compute what would have happened if it had been taken, using subsequent historical data.

- Clearly labeled `hindsight`, `not used for decisions`.
- Produces a "missed opportunities" report and a "bad saves" report (rejections that avoided losses).
- Helps reconfiguration: e.g., "82% of no-entry bars were `PRICE_BELOW_SLOW`; loosening only that rule would have added 14 trades, +3.2% return, +1.8% DD."
- Never feeds back into the live decision log; it is a separate analysis artifact.

### 7.6 Log storage and volume

- Append-only JSONL per run for full detail.
- Summary events and metrics in Postgres for querying.
- Event log hash for determinism.
- Decision events are never sampled. Raw tick/trace events can be sampled or compressed.
- Retention policy per run; the owner can archive.
- Logs must not contain secrets, keys, or real wallet data.

### 7.7 Debug view (later UI)

Stage 1 produces a text/HTML report and JSONL. Stage 2 UI will show:

- timeline of decisions;
- per-token state history;
- reason-code histogram;
- "why not" cards;
- counterfactual report;
- strategy switch history;
- risk-check failures;
- data quality incidents.

---

## 8. Report

Every run produces:

### 8.1 Financial

- starting/ending equity;
- net return after fees/slippage;
- max drawdown;
- daily loss worst day;
- exposure/time in market;
- cash buffer;
- per-token P&L;
- per-strategy P&L;
- per-regime P&L;
- buy-and-hold comparison.

### 8.2 Behavior

- number of trades;
- win rate, profit factor;
- average holding time;
- number of strategy switches;
- number of stops/trailing exits/crash exits;
- number of blocked signals by reason;
- number of cooldown periods;
- tokens that slept the whole run;
- max single-trade loss;
- turnover and fees.

### 8.3 Debug

- reason-code histogram;
- top missed opportunities (hindsight);
- top bad saves (hindsight);
- strategy switch timeline;
- risk-check failure timeline;
- data quality incidents;
- event log hash;
- config/seed/data snapshot IDs.

---

## 9. Testing and validation

### 9.1 Engine correctness

- Unit tests for regime rules, strategy signals, risk checks, portfolio math.
- Property-based tests for invariants (cash >= 0, equity identity, no duplicate fills, sizes within limits).
- Golden tests on a small fixture with hand-computed expected results.
- Determinism test: same input/config/seed -> same event log hash.
- Look-ahead test: a data source wrapper records every read; any future read fails the test.
- Fuzz tests with gaps, duplicates, stale data, extreme prices, zero volume.
- Reconciliation test after every run.

### 9.2 Logging completeness

- Every decision/rejection has a reason code. An event that carries a `decision` object also logs at least one alternative; decision-like notifications without a `decision` object require only a `reasonCode`.
- Every risk check is logged.
- Every strategy switch has `from`, `to`, reason, and triggering features.
- No silent drops: a test scans the log for decisions without reason codes.
- The event log can reconstruct the run: replay from log + data snapshot produces the same result.

### 9.3 Historical validation

- 180-day windows, at least 3 different windows per token.
- 5–10 liquid tokens, different regimes.
- Stress fixtures: crash, sideways, high volatility, data gaps.
- Metrics: median and worst result, not only the best.
- Acceptance: engine correctness first; then robustness. A profitable but fragile run is not accepted.

### 9.4 Performance

- 180 days × 10 tokens × 1h should complete in a practical time (target: minutes, not hours).
- Logging must not dominate runtime; measure event throughput.
- Memory bounded for long runs.

---

## 10. Independent review gates

No stage is accepted without an independent read-only review. The reviewer does not edit code.

### Stage 1A — clock, data, look-ahead

Review:

- data source and clock design;
- no future data access;
- timestamp/timezone/gap handling;
- data snapshot reproducibility;
- tests for look-ahead and gaps.

Gate: no critical/major findings open.

### Stage 1B — regime, strategies, portfolio, risk

Review:

- rule clarity and versioning;
- strategy interfaces and independence;
- portfolio/risk invariants;
- strategy switch rules and hysteresis;
- logging of every decision/alternative;
- unit/property tests.

Gate: no critical/major findings open.

### Stage 1C — replay, execution, ledger, report

Review:

- fill model, fees, slippage, liquidity;
- accounting reconciliation;
- determinism/replay from log;
- report correctness;
- counterfactual analysis labeling (hindsight only);
- performance.

Gate: no critical/major findings open; owner accepts Stage 1 report.

### Stage 2 — infrastructure/UI/live data

Separate design and review: security, controls, live data, run management, monitoring, audit.

### Stage 3 — live paper

Separate review: 4–8 weeks forward, incident log, comparison with historical replay.

### Stage 4 — real money

Separate product/security/legal decision. Not part of this design.

Review artifacts live in `docs/reviews/` with severity, evidence, and sign-off. A stage cannot start until the previous stage's gate is closed.

---

## 11. Stage plan

### Stage 1 — core + replay (this design)

- headless TypeScript module/package;
- historical data player;
- regime rules;
- 3 strategy families;
- portfolio/risk;
- paper execution;
- ledger;
- maximum logging;
- report + counterfactual analysis;
- tests and independent reviews 1A/1B/1C.

### Stage 2 — Песочница section

- new app section, independent from old systems;
- run setup: token list, capital, limits, horizon;
- start/pause/stop/close-trade controls;
- live data source (same core);
- dashboard, journal, reports;
- security/ops review.

### Stage 3 — live paper

- real-time paper run for 4–8 weeks;
- compare with historical replay;
- incident review;
- decide whether to proceed.

### Stage 4 — real money (separate)

- only after Stage 3 success;
- separate security/legal/risk design;
- small capital, strict limits, kill switch;
- old systems removal only after this decision.

---

## 12. Success criteria for Stage 1

Stage 1 is successful when:

1. The engine is deterministic and replayable from the log.
2. No look-ahead is possible; tests prove it.
3. Accounting reconciles exactly.
4. Every decision/rejection has a reason code; an event carrying a `decision` object also logs at least one alternative, while decision-like notifications without a `decision` object need only a `reasonCode`.
5. The historical replay runs on 5–10 tokens × 3 windows × 180 days.
6. Results are explainable from the journal, not just numerically plausible.
7. Independent reviews 1A/1B/1C are closed.
8. The owner can read the report and understand why the system traded or did not trade.

Profitability is evaluated after these gates. A profitable run with incomplete logging or unresolved review findings is not accepted.

---

## 13. Open questions for the owner

1. First token list and liquidity filter: which 5–10 tokens?
2. Starting paper capital and risk limits: max positions, per-token %, daily loss, max drawdown.
3. Which 3 strategy families are mandatory for MVP: trend, range, recovery — or a different set?
4. Risk-check frequency in Stage 1: once per 1h candle, or do we need 5m/15m data for intrabar stops?
5. Log storage: JSONL + Postgres summary, or only Postgres?
6. Counterfactual analysis: include in Stage 1 or defer to Stage 2?
7. Reviewer: independent agent, human, or both?
8. Historical windows: which 3 windows per token? Same calendar windows for all tokens or token-specific?
9. Is a minimal CLI enough for Stage 1, or do you want a simple local HTML report?
10. What counts as "robust enough" to proceed to Stage 2: positive median across windows, max drawdown, minimum trades, etc.?

---

## 14. What is left to the builder

- exact strategy rules and parameter ranges;
- exact regime thresholds and hysteresis;
- exact fill/slippage/liquidity model;
- event schema implementation details;
- report layout;
- test fixtures;
- performance tuning;
- review checklists per gate.

These are implementation-plan decisions, not product decisions. They must be documented and reviewed before Stage 1A/1B/1C sign-off.
