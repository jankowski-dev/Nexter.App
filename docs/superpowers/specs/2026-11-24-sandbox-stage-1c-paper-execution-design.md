# Sandbox Stage 1C — paper execution, ledger and report design

Date: 2026-11-24
Status: **approved in principle under owner pre-approval; Stage 1B signed off and deployed**
Scope: Stage 1C only. No live data, UI, HTTP, DB/schema, wallets, real money or real execution. Stage 2 stays blocked until Stage 1C is signed off.

Base: Stage 1B design `docs/superpowers/specs/2026-11-24-sandbox-stage-1b-decision-engine-design.md` (signed off; merged as `ef2f342`).

## 1. Intent

Turn the Stage 1B decision stream into a complete paper-trading run:

```
closed candles -> DecisionEngine (Stage 1B) -> OrderIntent
              -> paper fill model (next open, fees, slippage, liquidity)
              -> append-only ledger -> portfolio projection
              -> equity curve + trade journal + metrics
              -> report JSON/Markdown + hindsight counterfactuals
```

Stage 1C is still headless and deterministic. It consumes historical candles, executes intents on paper, maintains an honest ledger, and produces evidence the owner can review. It never touches the real ledger, swaps, wallets or signing.

The owner still supplies the starting parameters: $1,000 paper capital, max 5 positions, 20% per token, 40% per strategy, 10% cash buffer, 2% daily loss, 15% max drawdown, 1% per-trade risk. Fees, slippage, liquidity and cooldown are execution parameters (see §3).

## 2. Goals and non-goals

### Goals

1. A deterministic next-bar-open paper fill model with fees, slippage, liquidity caps, partial fills and explicit IOC outcomes.
2. An append-only paper ledger with average-cost positions, realized/unrealized P&L, fees and trade journal.
3. A host loop that groups candles into bars, marks the portfolio, calls the Stage 1B engine once per bar, fills on the next bar open, and persists state across bars.
4. A post-stop cooldown that prevents immediate falling-knife re-entry, closing Stage 1B finding F2 by policy.
5. An equity curve, drawdown, exposure and per-strategy/per-token metrics.
6. A deterministic JSON report with a report hash, plus a human-readable Markdown report.
7. A post-run hindsight counterfactual report, clearly labeled and never fed back into decisions.
8. Reconciliation tests proving cash, positions, fees, realized and unrealized P&L agree.
9. A 180-day paper run on deterministic data with no invariant breach.
10. Independent Stage 1C review gate.

### Non-goals

- No live data, scheduling, real-time loop or exchange connection.
- No UI, HTTP API, Postgres schema, migration or Railway wiring.
- No real money, wallets, keys, signing or swaps.
- No old AI/legacy imports.
- No taxes, leverage, shorting, derivatives or multi-asset classes.
- No order-book simulation, partial-fill retry, latency model, maker/taker fee tiers or borrow.
- No strategy parameter fitting or optimization.
- No counterfactual analysis used for decisions; it is a separate hindsight artifact.

## 3. Defaults

| Setting                        |                          Default |
| ------------------------------ | -------------------------------: |
| Initial paper capital          |                           $1,000 |
| Decision timeframe             |                               1h |
| Fee                            |                  25 bps per side |
| Slippage                       |                  10 bps per side |
| Liquidity cap                  | 1% of the fill bar's `volumeUsd` |
| Max pending bars for an intent |                          1 (IOC) |
| Cooldown after a stop fill     |                              24h |
| Counterfactual horizon         |                              24h |
| Report formats                 |                  JSON + Markdown |
| Stage 1B decision settings     | `DEFAULT_SETTINGS` from Stage 1B |

All values are configuration, not hard-coded behavior. Money stays decimal strings; `decimal.js` is used for every money computation. Native numbers are allowed only for counts, percentages used in metrics, and sorting.

## 4. Architecture

```
src/paper/
  types.ts                 PaperRunConfig, Fill, LedgerEntry, PaperPosition, PaperTrade,
                           EquityPoint, IntentRecord, Counterfactual, RunReport
  defaults.ts              DEFAULT_PAPER_SETTINGS, PAPER_RUN_VERSION
  reason-codes.ts          paper/execution reason codes (or extend decision reason codes)
  execution.ts             PendingIntent, planFill/fillPendingIntent (pure)
  ledger.ts                applyFill, markPortfolio, reconcileLedger (pure)
  metrics.ts               computeMetrics, buildEquityCurve, trade metrics
  counterfactual.ts        analyzeRejectedIntents (post-run, hindsight)
  report.ts                buildReport, reportHash, renderMarkdown, writeArtifacts
  paper-runner.ts          PaperRunner: bar loop, engine call, fill queue, cooldowns
  paper-logger.ts          paper/execution/ledger events on the shared EventLog
  fixtures.test-helpers.ts deterministic paper fixtures
  *.test.ts
src/cli/
  paper.ts                 import-safe parsePaperArgs/runPaperFromFiles
  paper-main.ts            CLI entrypoint
```

`src/index.ts` appends the paper export. The paper module imports only the Stage 1A/1B package core; no `apps/*`, old AI, HTTP or DB.

## 5. Fill model

### 5.1 Timing

- The engine decides at bar close `T` using candles closed at or before `T`.
- The resulting intents are queued and filled at the **next bar open**, which is the next candle's `open` at time `T`. The fill never uses the decision close as an execution price; this avoids optimistic same-close fills.
- If the token has no bar at the next grid time, the intent stays pending for at most `maxPendingBars` bars (default 1) and then expires.
- The first bar only decides; the last bar's intents expire because there is no next open.

### 5.2 Fill price and fees

For a buy:

```
fillPrice = bar.open * (1 + slippageBps / 10000)
notional  = sizeUsd                    (the Stage 1B intent size, capped by liquidity)
fee       = notional * feeBps / 10000
cashOut   = notional + fee
amount    = notional / fillPrice
```

For a sell:

```
fillPrice = bar.open * (1 - slippageBps / 10000)
amount    = intent.amount              (capped by liquidity and the open position)
notional  = amount * fillPrice
fee       = notional * feeBps / 10000
proceeds  = notional - fee
```

Prices are formatted to 8 decimals, amounts to 8 decimals, USD to 2 decimals for ledger/report fields; the internal Decimal is exact until formatting. Buy fees are included in the position cost basis. Sell fees reduce proceeds and realized P&L.

**Booked values are the source of truth.** The buy fill is floored to cents **before** the cash-floor check, the fee is computed on the booked fill, and the position amount is derived from the booked fill; otherwise a half-up cent could pass the exact check and then breach the floor once the ledger books the rounded strings. For a sell, the booked notional is rounded to cents, the fee is computed on the booked notional, and `proceeds = booked notional - booked fee` by construction, so the three emitted USD strings always agree.

### 5.3 Liquidity and partial fills

- `liquidityCapUsd = bar.volumeUsd * liquidityCapPct / 100`.
- A buy fills at most `min(sizeUsd, liquidityCapUsd)`. A sell fills at most `min(amount, liquidityCapUsd / fillPrice, position.amount)`.
- If the fill is smaller than requested, it is an IOC partial fill: the filled part is booked, the remainder is **not retried** and is logged as unfilled. For a sell, the remaining position stays open; a later decision may emit another sell.
- Partial fills are expected in thin bars; the Stage 1B allocator already uses average volume, so the per-bar cap is a second, execution-time guard.

### 5.4 Outcomes and rejection reasons

Every pending intent ends as exactly one of:

- `filled` — full requested size;
- `partial` — filled > 0 and < requested, remainder unfilled;
- `rejected` — no fill (`FILL_INSUFFICIENT_CASH`, `FILL_POSITION_EXISTS`, `FILL_NO_POSITION`, `FILL_NO_DATA`, `FILL_DUPLICATE`);
- `expired` — no next bar within `maxPendingBars` (`FILL_EXPIRED`).

A buy is rejected if paying notional + fee would take cash below the Stage 1B cash-buffer floor. A sell is rejected if the position is missing. A duplicate pending `(tokenId, side)` intent is rejected. Rejections are logged with the intended and filled amounts.

### 5.5 Cooldown after a stop

When a sell fill's intent reason is a hard-stop reason (`TREND_PULLBACK_STOP`, `RANGE_REVERSION_STOP`, `RECOVERY_STOP`), the host sets:

```
cooldownUntil = fill time (bar open) + cooldownHoursAfterStop * 3600_000
```

in the token's `EngineState`. The Stage 1B engine will see a `COOLDOWN` phase. This is the design-owner decision for Stage 1B finding F2: the sandbox may buy a pullback before a crash is confirmed, but after a stop it must wait 24h before re-entering the same token. The cooldown is an execution policy, not a strategy change; the strategy/regime behavior is unchanged.

The Stage 1C opening engine change also filters `COOLDOWN`/`BLOCKED` candidates **before** ranking/allocation, so a cooled-down signal cannot consume an allocation slot and cannot produce a misleading `ALLOC_MAX_POSITIONS` drop.

## 6. Ledger and accounting

### 6.1 State

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

export interface LedgerEntry {
  readonly entryId: string; // runId:ledger:<sequence>
  readonly sequence: number;
  readonly clockTime: Timestamp;
  readonly tokenId: string;
  readonly side: 'buy' | 'sell';
  readonly intentId: string;
  readonly amount: string;
  readonly priceUsd: string;
  readonly notionalUsd: string;
  readonly feeUsd: string;
  readonly cashAfterUsd: string;
  readonly positionAmountAfter: string;
  readonly positionAvgCostAfter: string | null;
  readonly realizedPnlUsd: string | null;
  readonly reasonCode: ReasonCode;
}

export interface PaperLedgerState {
  readonly cashUsd: string;
  readonly initialCapitalUsd: string;
  readonly positions: Readonly<Record<string, PaperPosition>>;
  readonly entries: readonly LedgerEntry[];
  readonly realizedPnlUsd: string;
  readonly feesPaidUsd: string;
  readonly closedTrades: readonly PaperTrade[];
  readonly openTrades: Readonly<Record<string, PaperTrade>>;
}
```

### 6.2 Rules

- **Buy** (no adds allowed): reject if a position exists. `newAmount = old + fillAmount`; `newCost = oldAmount*oldAvgCost + notional + fee`; `newAvgCost = newCost / newAmount`; `cash -= notional + fee`. A new trade opens with the entry intent id, entry time/price/amount/fee.
- **Sell** (full position from the engine, possibly partial due to liquidity): `costBasis = fillAmount * avgCost`; `realized = proceeds - costBasis`; `cash += proceeds`; reduce the position amount; if the amount reaches zero, remove the position and close the trade. `feesPaid += fee`; `realizedPnl += realized`. Update the open trade's exit aggregate and P&L; close it when the position is zero.
- **No negative cash or amount.** Amounts are positive decimal strings; zero positions are removed.
- **No market-price writes into the ledger.** The ledger records fills; mark-to-market lives only in the portfolio projection/equity curve.
- **Audit:** every fill has one ledger entry; every ledger entry references a fill and intent. The event log gets a `ledger.entry` event with the entry fields.

### 6.3 Reconciliation

`reconcileLedger(state, marks)` must verify:

1. `cash = initial - sum(buy notional + fee) + sum(sell notional - fee)`.
2. For every token, `position.amount = sum(buy amounts) - sum(sell amounts)`.
3. `sum(closed trade realized P&L) + open trade realized P&L = state.realizedPnlUsd`.
4. `equity = cash + sum(position.amount * markPrice)`; `equity - initial = realizedPnl + unrealizedPnl` within $0.01 rounding.
5. No negative cash/amount; no entry without a fill; no fill without an entry.

The run fails if reconciliation returns discrepancies; tests assert a clean ledger.

## 7. Host loop

`PaperRunner.run()`:

1. Load a validated snapshot of candles and a `ClockedMarketView`; build the sorted set of bar close times from all candles (`openTime + TIMEFRAME_MS`).
2. Initialize the ledger (cash $1,000), `EngineState` empty, portfolio `dayStart = peak = $1,000`.
3. Log `paper.run_started` at the first bar.
4. For each bar close `T` in order:
   a. **Fill at open:** the bar's open time is `T - timeframeMs`. For each pending intent, attempt a fill using the token's candle at that open (if present), the fill model and the ledger. Log fills/rejections/expiries; apply cooldowns after stop fills (state overlay). Expire intents older than `maxPendingBars`.
   b. Advance the simulation clock to `T`; mark every position at the current close of its token (latest visible close); compute equity, reset `dayStart` on a UTC date change, update `peak`.
   c. Build the `PortfolioSnapshot` (positions with current marks) and call `DecisionEngine.decide` once with all token ids, the state, the portfolio, settings and `clockTime = T`.
   d. Queue `result.intents` for the next bar open; keep `result.state` (with host cooldown overlays).
   e. Append the decision engine's events; record the equity point.
5. After the last bar: expire pending intents; mark the final portfolio; log `paper.run_completed` with final equity, fills and trades. The result and report carry the whole-log event count and hash; the event cannot contain its own hash.
6. Build the report and write `events.jsonl`, `report.json`, `report.md`; return the result.

The loop is deterministic: bar times come from candles, no wall clock, no random, token ids sorted by code unit in the engine.

### 7.1 Portfolio projection

`PortfolioSnapshot` for the engine:

- `equityUsd = cash + sum(position.amount * markPrice)`.
- `cashUsd` from the ledger.
- `dayStartEquityUsd` reset when the UTC date of `T` changes; otherwise carried.
- `peakEquityUsd = max(peak, equity)`.
- Each position maps to `PortfolioPosition` with `marketPriceUsd = markPrice`, `marketValueUsd = amount * markPrice`, plus the strategy key/version, amount, avg cost, openedAt and stop/take.

Marks use the latest candle close at or before `T` for that token. A token with no mark is a data error (a position cannot exist without a fill, and a fill requires a candle); the runner fails with `PAPER_NO_MARK`.

### 7.2 Cooldowns and state

The host owns `EngineState` and overlays `cooldownUntil` after a stop fill (§5.5). It does not mutate the engine's input objects; it constructs a new state record with the updated token. The engine returns the next state; the host persists it in memory for the next bar. The state includes regime hysteresis, phases, cooldowns and strategy state; Stage 1C does not persist it to disk beyond the run.

### 7.3 Event log

The runner uses a `MemoryEventLog` and writes the canonical JSONL once at the end (the 180-day run can produce ~100k events; per-event file opens would dominate the run time). The same canonical line format as the Stage 1A JSONL log is used, and the final `eventHash` is recorded in the report. The memory log retains every event for the audit and report.

Host event types and modules:

| eventType             | module    | reason                                 | when         |
| --------------------- | --------- | -------------------------------------- | ------------ |
| `paper.run_started`   | run       | `PAPER_RUN_STARTED`                    | first bar    |
| `execution.filled`    | execution | strategy intent reason / `FILL_FILLED` | full fill    |
| `execution.partial`   | execution | `FILL_PARTIAL`                         | partial fill |
| `execution.rejected`  | execution | `FILL_*`                               | rejection    |
| `execution.expired`   | execution | `FILL_EXPIRED`                         | expiry       |
| `ledger.entry`        | ledger    | `LEDGER_BUY` / `LEDGER_SELL`           | every fill   |
| `paper.cooldown_set`  | run       | `COOLDOWN_AFTER_STOP`                  | stop fill    |
| `paper.run_completed` | run       | `PAPER_RUN_COMPLETED`                  | end          |

Every fill/rejection event carries the intent id, token, side, requested/filled amounts, price, fee, liquidity cap and cash after. Fill events with a `decision` object carry a stable reason and at least one alternative (`hold`); rejection/expiry events use `block`/`noop` with an alternative. The Stage 1A reason-family rule is extended to `execution|ledger|paper`.

## 8. Metrics, equity curve and trades

- Equity curve at every decision bar: `{clockTime, equityUsd, cashUsd, positionsValueUsd, drawdownPct}`.
- Summary metrics: initial/final equity, total return %, max drawdown %, peak, cash, positions value, realized/unrealized P&L, fees paid, trade count, wins/losses, win rate, profit factor, average win/loss, time in market, average exposure, per-strategy and per-token breakdown.
- Trade journal: one record per position round trip. Entry/exit times, token, strategy, amounts, average prices, fees, realized P&L, return %, entry/exit intent ids, exit reason. Partial exits aggregate into the open trade until the position is zero.
- Intent journal: every intent with `filled|partial|rejected|expired`, filled amount, reason and fill time. Counts by reason.

All money/percent strings are decimal strings; counts are integers. Empty/undefined profit factor is `null`, never `Infinity`.

## 9. Counterfactual analysis (hindsight only)

After the run, collect rejected **buy** attempts (risk veto, max positions, size/liquidity, cooldown, execution rejection/expiry). For each, compute a fixed-horizon hypothetical:

- entry at the next bar open with buy slippage/fee;
- exit at the close of the bar at or after `decisionTime + counterfactualHorizonHours` with sell slippage/fee;
- return % on the hypothetical notional; `outcome` = `missed_opportunity` (positive), `bad_save` (negative), `neutral`, or `insufficient_data`.

Every record is labeled `hindsight: true`, `usedForDecisions: false`. The analyzer never touches the decision engine or the live log; it reads only historical candles after the run. The report summarizes missed opportunities and bad saves by reason code. This is a fixed-horizon diagnostic, not a replay of the strategy's own exit; the limitation is stated in the report.

## 10. Report and artifacts

`report.json` includes:

- run identity: `runId`, `seed`, `configVersion`, `dataSnapshotId`, `settingsVersion`, `paperVersion`;
- period: first/last bar, bar count, token ids;
- configuration: initial capital, fees, slippage, liquidity cap, cooldown, counterfactual horizon, Stage 1B settings hash;
- results: final cash, positions, equity, metrics, equity curve, trades, intent journal, counterfactuals;
- audit: event count, final event hash, ledger entry count, report hash;
- reconciliation: the checks and `ok: true`.

`reportHash = sha256Hex(stableStringify(report without reportHash/generatedAt))`. `generatedAt` may exist as wall-clock metadata but is excluded from the hash. `report.md` renders the same facts as tables and a short narrative; it is a presentation artifact, not a source of truth.

The CLI writes `events.jsonl`, `report.json` and `report.md` into `--out`. It refuses to overwrite a non-empty output file unless the caller chooses a new directory. It prints final equity, return, max drawdown, trade count and report hash.

## 11. CLI and data

`src/cli/paper.ts` (import-safe):

```ts
export interface PaperArgs {
  files: string[];
  outputDir: string;
  runId: string;
  seed: number;
  initialCapitalUsd: string;
  feeBps: number;
  slippageBps: number;
  liquidityCapPct: number;
  cooldownHoursAfterStop: number;
  counterfactualHorizonHours: number;
}
export function parsePaperArgs(argv: readonly string[]): PaperArgs;
export function runPaperFromFiles(args: PaperArgs): Promise<PaperRunResult>;
```

- `--file` may repeat; each file is JSONL candles from Stage 1A. Combined candles must share one timeframe and pass `sortAndValidateCandles`; duplicates/negative prices reject.
- `--out` is required and must be empty/nonexistent; `--run-id` defaults to `paper-<timestamp>` (documented as non-reproducible without an explicit id), `--seed` defaults to 7 and must be a safe integer.
- Unknown flags and flag-shaped values reject with usage.
- The CLI creates the output directory, runs, writes the artifacts and prints the summary. It does not use `import.meta` for its main check; `main.ts` is the entrypoint.
- No `--days` trimming in Stage 1C; the data file defines the period. The report records the period.

## 12. Stage 1C debt from Stage 1B

Close in the first Stage 1C task:

- `assertJsonValue` rejects sparse arrays (holes) instead of passing them to a non-JSON canonical line.
- Strategy `avgCost`/`sma` finite/positive guards return `hold` + `STRATEGY_NO_DATA` instead of a NaN/Infinity stop that silently never fires.
- The engine filters `COOLDOWN`/`BLOCKED` buy candidates before ranking/allocation and logs `RANK_COOLDOWN`/`RANK_BLOCKED` drops, so a cooled-down signal cannot consume a slot or cause a misleading `ALLOC_MAX_POSITIONS`.
- Export a single strategy-key list from the strategy registry and use it in engine validation, with a sync test.
- CLI package-relative `out/` default and empty `--out`/`--run-id` rejection (Stage 1A debt).
- Document the process-global `Decimal.set` and the plan to use a module-local clone if the API ever imports the package.
- Leave the `ALLOC_NO_ALTERNATIVE` label as-is (accepted Minor; changing it would re-pin the Stage 1B golden for a label). Add a note for a future logger touch.

Accepted/deferred: CLI default run id is non-reproducible by design; `Decimal.set` clone; price underflow; hardcoded strategy list is replaced by the registry export; risk cooldown phase/deadline consistency is guaranteed by the host.

## 13. Testing

- Fill model: next-open timing, slippage/fee math, buy/sell notional, partial fills, liquidity cap, cash-buffer rejection, no-add rejection, missing position, duplicate, expiry.
- Ledger: buy cost basis incl. fee, sell realized P&L, partial sells, trade open/close, cash/position reconciliation, no negative values.
- Host loop: bar grouping, fills before decisions, state/cooldown overlay, mark-to-market, dayStart/peak, engine integration.
- Metrics/equity: hand-computed return, drawdown, win rate, profit factor, exposure, trade aggregation.
- Counterfactual: next-open entry, 24h exit, positive/negative/insufficient cases, labels, no decision feedback.
- Report: JSON round-trip, report hash stable, Markdown sections, no wall-clock in the hash.
- Determinism: two runs same data/config/seed = same fills, ledger, report hash, event hash; reversing token ids does not change the report hash.
- Reconciliation: every fill has a ledger entry, cash/amount identities, equity identity within a cent.
- 180-day synthetic run: no invariant breach, all three strategies trade, report generated; performance evidence recorded (no hard CI time bound; a generous smoke bound may be reported).
- Stage 1B golden remains unchanged (the Stage 1C debt does not alter valid no-cooldown behavior).
- No old imports, no `any`, no `Date.now`/`Math.random`/`localeCompare` in execution/ledger/report; no fill/ledger code in Stage 1B decision paths.

## 14. Review gate

Independent read-only review after each task and one Stage 1C whole-branch review. Gate:

- fill model and timing are look-ahead-free;
- fees/slippage/liquidity are correct and bounded;
- ledger identities and reconciliation hold;
- report metrics and counterfactual labeling are correct;
- determinism and replay hash are real;
- no real money, wallet, live data, UI or DB/schema;
- Stage 1B behavior is unchanged for valid no-cooldown inputs; the golden hash still matches.

Stage 2 must not start until Stage 1C is signed off and the owner accepts the Stage 1 report.

## 15. Success criteria

1. A 180-day, 3-token paper run completes deterministically and produces a readable report.
2. Every intent is accounted for (filled/partial/rejected/expired) and every fill has a ledger entry.
3. Cash, positions, fees, realized and unrealized P&L reconcile within a cent.
4. No buy violates a Stage 1B risk limit at execution; no sell is blocked by loss/drawdown.
5. Stop cooldowns prevent immediate re-entry; the engine does not allocate to cooled-down tokens.
6. Two identical runs produce the same report hash and event hash.
7. The report explains performance, trades, rejections and hindsight counterfactuals.
8. Independent Stage 1C review clean.

## 16. Open assumptions

- Data is 1h UTC JSONL candles; the owner supplies the period and tokens. Stage 1C does not build a data pipeline.
- The Stage 1B engine remains the decision authority; Stage 1C never changes an intent after it is emitted, only fills/rejects it.
- Fees/slippage/liquidity/cooldown are starting parameters, not optimized values.
- Counterfactuals are fixed-horizon, hindsight-only diagnostics; a full strategy-exit counterfactual is a later enhancement.
- No persistence beyond the run artifacts; Stage 2 adds DB/UI.
