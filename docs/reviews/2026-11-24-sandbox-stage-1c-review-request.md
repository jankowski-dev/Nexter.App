# Stage 1C review request — `@nexter/sandbox-core` paper execution, ledger and report

- Date: 2026-11-24
- Branch: `feat/sandbox-stage-1c`
- Base: `ef2f342` (Stage 1B merged and signed off)
- Code head at request: `f802f93` (chore: ignore local sdd scratch in prettier)
- Review-request commit: the commit with subject `test(sandbox): add 180-day golden run and stage 1c review packet` — it adds the golden test, this packet and the design/plan status only, and changes no source file
- Package: `packages/sandbox-core`
- Reviewer: independent (agent and/or owner). The reviewer does not edit code.
- Design: `docs/superpowers/specs/2026-11-24-sandbox-stage-1c-paper-execution-design.md`
- Plan: `docs/superpowers/plans/2026-11-24-sandbox-stage-1c.md`
- Stage 1B review (signed off): `docs/reviews/2026-11-24-sandbox-stage-1b-review-request.md`

Stage 1C is **implemented**. The full gate is green and the 180-day golden run is
deterministic and reconciled. **Stage 1C is not signed off until the independent
review closes and the owner accepts the Stage 1 report.** Stage 2 must not start.

## 1. Scope

In scope — paper execution inside `packages/sandbox-core`:

- an isolated `src/paper/` module: paper types/defaults, the pure next-open fill
  model, the append-only ledger, the host loop (`PaperRunner` + `PaperLogger`),
  equity/metrics, hindsight counterfactuals, the JSON/Markdown report and artifact
  writer;
- the CLI plumbing in `src/cli/paper.ts` / `paper-main.ts` (JSONL in, artifacts
  out) and the `paper` package script;
- the Stage 1C opening debt from Stage 1B design §12 (sparse arrays, strategy
  finite guards, cooldown/blocked candidate filtering, single strategy-key source,
  CLI output hygiene) and the paper/execution event families;
- the 180-day golden run, determinism hashes and this review packet.

Explicitly **out of scope** (must not be present, is not reviewed here):

- live market data, scheduling, a real-time loop, exchange connections;
- UI, HTTP API, Postgres schema/migration, Railway wiring, workers;
- wallets, keys, signing, swaps, the real ledger, real money;
- the old AI module (`@nexter/ai-trading`, `trading-bots`, search, legacy/Notion
  code) and `apps/*`: no import from any of them exists;
- strategy fitting/optimization;
- Stage 2 (persistence, UI, live paper loop).

Stage 1C consumes historical candles, executes intents on paper, keeps an honest
ledger and produces report artifacts. Nothing is persisted outside the run
artifacts; no money is real.

## 2. Commits (base `ef2f342` .. code head `f802f93`)

```
f802f93 chore(sandbox): ignore local sdd scratch in prettier
48a87d6 fix(sandbox): canonicalise paper config and tighten report CLI
9ec29a9 feat(sandbox): add paper report and CLI
004e9d0 fix(sandbox): keep exact prices in counterfactual sizing
2a32262 feat(sandbox): add hindsight counterfactual analysis
2ff9f5f fix(sandbox): normalise signed zero in paper metrics
09d33f2 feat(sandbox): add paper metrics and equity curve
fc09305 docs(sandbox): align paper cooldown and run-completion wording
8e66f4c fix(sandbox): harden paper observability and config validation
ad3cb66 feat(sandbox): add paper runner and host loop
c0916e9 fix(sandbox): reject dust sells and harden ledger reconciliation
3a7147b feat(sandbox): add paper ledger and reconciliation
e8a4632 docs(sandbox): book rounded paper fill values
6c3893a fix(sandbox): book rounded paper fill values
90b0102 feat(sandbox): add paper fill model
7925b8f docs(sandbox): keep the sell fill input minimal
2225e18 fix(sandbox): close stage 1b debt before paper execution
2b1c88d docs(sandbox): add stage 1c design and plan
```

The review-request commit adds only:

```
A packages/sandbox-core/src/paper/paper-runner.golden.test.ts
A docs/reviews/2026-11-24-sandbox-stage-1c-review-request.md
M docs/superpowers/specs/2026-11-24-sandbox-stage-1c-paper-execution-design.md
M docs/superpowers/plans/2026-11-24-sandbox-stage-1c.md
```

## 3. Changed files (`ef2f342..f802f93`, 48 files, +11,078 / −21)

```
M  .gitignore                                   (+/out/ for CLI smoke artifacts)
M  .prettierignore                              (+.superpowers scratch)
A  docs/superpowers/plans/2026-11-24-sandbox-stage-1c.md
A  docs/superpowers/specs/2026-11-24-sandbox-stage-1c-paper-execution-design.md
M  packages/sandbox-core/package.json           (+ "paper" script)
A  packages/sandbox-core/src/cli/paper.ts
A  packages/sandbox-core/src/cli/paper-main.ts
A  packages/sandbox-core/src/cli/paper.test.ts
M  packages/sandbox-core/src/cli/replay.ts      (out/ default, empty flag rejection)
M  packages/sandbox-core/src/cli/replay.test.ts
M  packages/sandbox-core/src/decision/decimal.ts
M  packages/sandbox-core/src/decision/decision-engine.ts
M  packages/sandbox-core/src/decision/decision-engine.test.ts
M  packages/sandbox-core/src/decision/decision-logger.ts
M  packages/sandbox-core/src/decision/reason-codes.ts
M  packages/sandbox-core/src/decision/reason-codes.test.ts
M  packages/sandbox-core/src/decision/strategies/index.ts
M  packages/sandbox-core/src/decision/strategies/index.test.ts
M  packages/sandbox-core/src/decision/strategies/trend-pullback.ts
M  packages/sandbox-core/src/decision/strategies/trend-pullback.test.ts
M  packages/sandbox-core/src/decision/strategies/range-reversion.ts
M  packages/sandbox-core/src/decision/strategies/range-reversion.test.ts
M  packages/sandbox-core/src/decision/strategies/recovery.ts
M  packages/sandbox-core/src/decision/strategies/recovery.test.ts
M  packages/sandbox-core/src/events/event-schema.ts
M  packages/sandbox-core/src/events/event-log.test.ts
M  packages/sandbox-core/src/index.ts           (+ export * from './paper')
A  packages/sandbox-core/src/paper/types.ts
A  packages/sandbox-core/src/paper/defaults.ts
A  packages/sandbox-core/src/paper/defaults.test.ts
A  packages/sandbox-core/src/paper/execution.ts
A  packages/sandbox-core/src/paper/execution.test.ts
A  packages/sandbox-core/src/paper/ledger.ts
A  packages/sandbox-core/src/paper/ledger.test.ts
A  packages/sandbox-core/src/paper/metrics.ts
A  packages/sandbox-core/src/paper/metrics.test.ts
A  packages/sandbox-core/src/paper/counterfactual.ts
A  packages/sandbox-core/src/paper/counterfactual.test.ts
A  packages/sandbox-core/src/paper/report.ts
A  packages/sandbox-core/src/paper/report.test.ts
A  packages/sandbox-core/src/paper/paper-logger.ts
A  packages/sandbox-core/src/paper/paper-logger.test.ts
A  packages/sandbox-core/src/paper/paper-runner.ts
A  packages/sandbox-core/src/paper/paper-runner.test.ts
A  packages/sandbox-core/src/paper/fixtures.test-helpers.ts
A  packages/sandbox-core/src/paper/index.ts
M  packages/sandbox-core/src/util/json-value.ts
M  packages/sandbox-core/src/util/json-value.test.ts
```

No `apps/*`, no database/migration, no old AI/legacy file is touched. The only
Stage 1B source changes are the §12 debt closures; `pnpm-lock.yaml` is unchanged
(no new dependency; `decimal.js` and `zod` remain the only runtime deps).

## 4. Commands and observed results

All from the repo root with `npx pnpm@10.20.0`.

### 4.1 Package tests

```bash
npx pnpm@10.20.0 --filter @nexter/sandbox-core test
```

```
 Test Files  37 passed (37)
      Tests  533 passed (533)
   Duration  75.09s (tests 90%, import 8%, transform 1%)
```

The goldens are included: the Stage 1B `decision-engine.golden.test.ts` (pinned
`b260f984…`, unchanged) and the Stage 1C `paper-runner.golden.test.ts`. The
Stage 1A suite is unchanged and green.

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

`.superpowers/**` (local, gitignored workflow scratch) is ignored by
`.prettierignore`, so the root check no longer reports scratch files.

### 4.6 Stage 1A replay CLI smoke (debt regression check)

```bash
npx pnpm@10.20.0 --filter @nexter/sandbox-core replay -- \
  --file src/fixtures/candles-1h.jsonl --out out/stage1c-replay-smoke.jsonl \
  --run-id stage1c-replay-smoke --seed 7
```

```
{
  "candles": 3,
  "firstTime": 1767225600000,
  "lastTime": 1767232800000,
  "gaps": 0,
  "eventCount": 8,
  "eventHash": "066b38bc6e98e97de9756f21aa23fc53617bf071e497edc6a98dfc737ea481d5",
  "outputPath": "out/stage1c-replay-smoke.jsonl",
  "configVersion": "6082bbcf4407b31bb56c54ef65672dd1a87e624e8b58f90c8ac217dad8c50dcd",
  "dataSnapshotId": "4d62f7195b100cd88d33896545038526decac00c03208447a155d212996c1a99"
}
```

3 candles, 8 events, 64-hex hash. `configVersion` and `dataSnapshotId` match the
Stage 1A/1B smoke; the hash differs only by the run id. The artifact and the
`out/` directory were deleted; `out/` is gitignored.

### 4.7 Paper CLI smoke (fixed run id)

A 236-bar single-token deterministic JSONL (200 up bars, one −4.5% pullback, one
−1.5% bar, 34 drift bars) generated outside the repository:

```bash
npx pnpm@10.20.0 --filter @nexter/sandbox-core paper -- \
  --file <tmp>/smoke-candles.jsonl --out out/stage1c-paper-smoke \
  --run-id stage1c-paper-smoke --seed 7
```

```
Paper run stage1c-paper-smoke -> out/stage1c-paper-smoke
Final equity: 991.86 USD
Return: -0.81%
Max drawdown: 0.81%
Closed trades: 2
Report hash: a168230b49fd747d999e533f95ee9969bc2d2da83416c020fb7786bed58a237c
```

The `out/` directory and the temporary candle file were deleted.

## 5. Golden 180-day run

File: `packages/sandbox-core/src/paper/paper-runner.golden.test.ts`.

### 5.1 Scenario

Deterministic 1h candles, 4,320 bars per token (180 days from
`2026-01-01T00:00Z`; the first bar closes `2026-01-01T01:00Z`, the last
`2026-06-30T00:00Z`). Prices are built by repeated multiplication and a fixed
24-sample sine table, so no `Math.sin`/`Math.pow`, no clock, no random source and
no locale formatting enters the run.

| Token | Shape                                                                                                                                                                                                                                                                                        |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AAA` | The Stage 1B trend/crash shape (175 up, 6 down, 80 up, one −13% crash, 138 recovery bars) followed by repeated 120-bar rises and 4-bar ≈−4.8% pullbacks. Volume 100,000 USD.                                                                                                                 |
| `BBB` | A 24-bar sine around 50, ±3%, 180 cycles (fast SMA 24 equals slow SMA 168, so the regime stays RANGE). Every other bar carries 15,000 USD volume, so the 1% bar cap is 150 USD and ~200 USD orders partially fill; the 24-bar average 57,500 USD stays above the 50,000 USD liquidity floor. |
| `CCC` | Repeated cycles of 180 up, 40 down ≈25% (CRASH), 180 up (RECOVERY). Volume 100,000 USD.                                                                                                                                                                                                      |

The scenario is driven through the full orchestration
`runPaperFromFiles` (JSONL load → `snapshotCandles` → `paperConfigVersion` →
`PaperRunner` → final marks → `computeMetrics` → `collectRejectedBuys` +
`analyzeRejectedBuys` → `buildReport` → `writePaperArtifacts`) with fixed
`runId: 'stage1c-golden-180d'`, `seed: 7`, `$1,000` capital and the Stage 1B
`DEFAULT_SETTINGS` plus `DEFAULT_PAPER_SETTINGS`.

### 5.2 Pinned outcome

Two identical replays and one replay with the three input files in **reverse
order** produce identical intents, ledger and equity curve, and the same report
and event hashes. Pinned literals:

| Pin                                 | Value                                                              |
| ----------------------------------- | ------------------------------------------------------------------ |
| `reportHash`                        | `ac2a0059068d3bb7bad49baeda1c563438f4217f650e0c1a89a548be6a4226f5` |
| `eventHash`                         | `ef7da740575b165d1d712a76a17b894fdd2e9dc91cd848a52edf22df407cd8da` |
| events                              | `49379`                                                            |
| intents                             | `454` (281 filled / 173 partial / 0 rejected / 0 expired)          |
| closed trades                       | `227`                                                              |
| ledger entries                      | `454`                                                              |
| final equity                        | `1378.52` USD                                                      |
| total return                        | `37.85` %                                                          |
| max drawdown                        | `2.68` %                                                           |
| `paper.cooldown_set` events         | `130`                                                              |
| counterfactual records              | `944`                                                              |
| positions open at the end           | `0`                                                                |
| `dataSnapshotId`                    | `3a4f68c5d927f8b5e45eeb96a8efe8538c1eabf2bf77d374f94cc88020ee8518` |
| `configVersion`                     | `a8de9c5c875dad8ce46ffbffeeee5dd9ea7da91dd65d86aa70bcde3f6bd31513` |
| `settingsVersion(DEFAULT_SETTINGS)` | `cc3d30cf416f7fac9a96b96d40868050cce7e68cb300f47d17fc92b789f1a26c` |

The pins were established from the first deterministic run and are verified by two
further replays inside the same test on every run. A pin change is a contract
change, not a test fix; nothing was re-pinned silently (there was no earlier
Stage 1C pin).

### 5.3 Summary metrics

| Metric                | Value        |
| --------------------- | ------------ |
| Initial capital       | 1000.00      |
| Final equity          | 1378.52      |
| Total return          | 37.85 %      |
| Max drawdown          | 2.68 %       |
| Peak equity           | 1390.12      |
| Final cash            | 1378.52      |
| Final positions value | 0.00         |
| Realized P&L          | 378.52       |
| Unrealized P&L        | 0.00         |
| Fees paid             | 194.50       |
| Closed trades         | 227          |
| Wins / losses         | 97 / 130     |
| Win rate              | 42.73 %      |
| Profit factor         | 1.84         |
| Average win / loss    | 8.53 / −3.45 |
| Time in market        | 65.32 %      |
| Average exposure      | 13.90 %      |
| Reconciliation        | ok           |

Per strategy (closed trades only):

| Strategy          | Trades | W / L   | Realized | Win rate |
| ----------------- | ------ | ------- | -------- | -------- |
| `range_reversion` | 173    | 86 / 87 | 117.68   | 49.71 %  |
| `recovery`        | 11     | 11 / 0  | 472.94   | 100.00 % |
| `trend_pullback`  | 43     | 0 / 43  | −212.10  | 0.00 %   |

Per token:

| Token | Trades | W / L   | Realized | Win rate |
| ----- | ------ | ------- | -------- | -------- |
| `AAA` | 33     | 1 / 32  | −122.55  | 3.03 %   |
| `BBB` | 173    | 86 / 87 | 117.68   | 49.71 %  |
| `CCC` | 21     | 10 / 11 | 383.39   | 47.62 %  |

The `trend_pullback` result is a property of this synthetic fixture (repeated
pullback entries followed by ATR stops), not a performance claim.

### 5.4 Sample trade (BBB, range reversion, partial entry)

```json
{
  "tradeId": "stage1c-golden-180d:BBB:buy:2026-01-08T15:00:00.000Z:range_reversion:trade",
  "tokenId": "BBB",
  "strategyKey": "range_reversion",
  "strategyVersion": 1,
  "entryAt": 1767884400000,
  "entryPriceUsd": "49.29925000",
  "entryAmount": "3.04264264",
  "entryNotionalUsd": "150.00",
  "entryFeeUsd": "0.38",
  "entryIntentId": "stage1c-golden-180d:BBB:buy:2026-01-08T15:00:00.000Z:range_reversion",
  "exitAt": 1767891600000,
  "exitPriceUsd": "48.65226093",
  "exitAmount": "3.04264264",
  "exitNotionalUsd": "148.03",
  "exitFeeUsd": "0.37",
  "exitReasonCode": "RANGE_REVERSION_STOP",
  "exitIntentId": "stage1c-golden-180d:BBB:sell:2026-01-08T17:00:00.000Z:range_reversion",
  "realizedPnlUsd": "-2.72",
  "status": "closed"
}
```

### 5.5 Sample intent (partial buy from a thin bar)

```json
{
  "intentId": "stage1c-golden-180d:BBB:buy:2026-01-08T15:00:00.000Z:range_reversion",
  "tokenId": "BBB",
  "side": "buy",
  "strategyKey": "range_reversion",
  "strategyVersion": 1,
  "status": "partial",
  "requestedUsd": "199.62",
  "requestedAmount": null,
  "filledUsd": "150.00",
  "filledAmount": "3.04264264",
  "priceUsd": "49.29925000",
  "feeUsd": "0.38",
  "reasonCode": "FILL_PARTIAL",
  "strategyReasonCode": "RANGE_REVERSION_ENTRY",
  "reasonText": "Partially bought 150.00 of 199.62 USD of BBB at 49.29925000 USD on the next bar open; the remainder is not retried",
  "decisionTime": 1767884400000,
  "fillTime": 1767884400000
}
```

The matching `execution.partial` event carries
`liquidityCapUsd: "150.00"`, `unfilledUsd: "49.62"`, `cashAfterUsd: "649.12"` and a
`buy` decision with a `hold` alternative.

### 5.6 Sample counterfactual (hindsight only)

```json
{
  "tokenId": "AAA",
  "decisionTime": 1769115600000,
  "reasonCode": "RANK_COOLDOWN",
  "entryAt": 1769115600000,
  "entryPriceUsd": "129.85821395",
  "exitAt": 1769202000000,
  "exitPriceUsd": "132.11008031",
  "returnPct": "1.23",
  "outcome": "missed_opportunity",
  "hindsight": true,
  "usedForDecisions": false
}
```

Outcome histogram: 721 `bad_save`, 217 `missed_opportunity`, 6
`insufficient_data` (decisions too close to the end of the data).

### 5.7 Assertions in the golden test

- 4,320 bars, tokens `AAA`, `BBB`, `CCC`; two replays and the reversed-file
  replay agree on intents, ledger, equity curve, `reportHash` and `eventHash`;
- pinned report/event hash, event count, intent count and status split, trade
  count, ledger entry count, final equity, return, max drawdown, open positions,
  counterfactual count and cooldown count;
- at least one buy, one sell, one partial fill, one cooldown and one
  counterfactual; every intent id is unique and every intent ends
  filled/partial/rejected/expired;
- every filled/partial intent has exactly one ledger entry with the same token,
  side, intent id, fill time, amount, notional, fee and price; rejected/expired
  intents have none; ledger entries equal filled + partial;
- every intent has exactly one `execution.*` outcome event of the matching type;
- `reconciliationOk`; every one of the 4,320 equity points satisfies
  `equity = cash + positions value` within a cent; the last point equals the
  metric; `equity − initial = realized + unrealized` within a cent;
- every fill price equals the **next bar open** at the fill time times
  `1 + 10 bps` (buy) or `1 − 10 bps` (sell), and `fillTime === decisionTime`
  (the next bar opens at the decision close);
- every fee equals `feeBps` of the booked notional rounded once to cents;
- every stop sell (`TREND_PULLBACK_STOP`/`RANGE_REVERSION_STOP`/`RECOVERY_STOP`)
  has a matching `paper.cooldown_set` at the fill time, and no buy intent for that
  token exists inside the 24h cooldown window (F2 closed by policy);
- every decision-carrying event has a non-empty reason code and at least one
  alternative; every `order.intent` is immediately preceded (`seq − 1`, same
  clock, same token and side) by a `risk.checked` with `RISK_PASSED` and every
  check passing;
- the event journal starts with `paper.run_started`, ends with
  `paper.run_completed`, its length equals `report.eventCount`, the last hash
  equals `report.eventHash`, and its `ledger.entry` ids match the ledger in order;
  the completed event reports the same bars, equity, intents, trades and entries;
- every counterfactual is `hindsight: true` / `usedForDecisions: false`, has a
  valid outcome, a two-decimal return unless `insufficient_data`, and is sorted by
  decision time/token/reason;
- metric formulas: total return = final/initial − 1, realized = Σ closed-trade
  P&L, fees = Σ ledger fees, peak ≥ final, drawdown ≥ 0, time in market > 0;
- the artifacts round-trip: `report.json` parses back to the report object and
  `report.md` quotes both hashes, `Reconciliation ok | true` and the hindsight
  label;
- every `events.jsonl` line for the first replay is canonical
  (`stableStringify(parse(line)) === line`).

### 5.8 Performance

Observed on the development machine (Windows, Node 22.17.0):

| Measure                                   | Value        |
| ----------------------------------------- | ------------ |
| One 180-day run (`runPaperFromFiles`)     | ≈ 22.6 s     |
| Golden file, three runs incl. event parse | 69.6 s       |
| Events (one run)                          | 49,379       |
| Ledger entries                            | 454          |
| `events.jsonl`                            | 51,161,642 B |
| `report.json`                             | 1,579,043 B  |
| `report.md`                               | 169,590 B    |

The golden test uses a 180 s timeout with no hard CI performance bound (the plan
allows a generous smoke bound; none is asserted to avoid flaky CI machines). The
three-run cost is deliberate: determinism and the reversed-order check are the
point. Memory is bounded by one event journal per run (~50 MB of JSON) and the
report (~1.6 MB); no artifact is committed.

## 6. Checklist

Each item is a claim to verify, not an assertion to trust.

1. **Next-open fill timing.** `planBuyFill`/`planSellFill` price the candle passed
   by the host; the host passes the candle whose `openTime` equals the decision
   bar close (`candleByOpen.get(tokenId|openTime)`), so a decision at close `T`
   fills at the bar that opens at `T`. Tests: `execution.test.ts` "fills at the
   next bar open with slippage and an exact fee", "uses the candle open, never the
   decision close or decision price"; `paper-runner.test.ts` "fills a decided buy
   at the next bar open…", "looks ahead only one bar…", "fills before the next
   decision so the engine sees the new position and cash"; golden: every one of
   the 454 fill prices is recomputed from the next-bar open and `fillTime ===
decisionTime`.
2. **Fees, slippage and liquidity.** Buy fee on the booked (floored) fill, sell
   fee on the booked notional, proceeds = notional − fee by construction; the
   liquidity cap is `volumeUsd * liquidityCapPct / 100` and is checked after
   slippage; the cash-buffer floor uses the booked cents. Tests:
   `execution.test.ts` (buy/sell math, "keeps notional - fee = proceeds on the
   emitted cents", "floors the booked fill to cents…", "caps the fill at the
   liquidity percentage…", "applies the cash check after the liquidity cap",
   "rejects when the booked (rounded) cost breaks the cash floor", "fills when the
   booked cost exactly equals the available cash"); golden: every fee recomputes
   from `feeBps`, and the thin-bar partials prove the cap binds.
3. **Partials and IOC outcomes.** A partial is booked once and never retried; the
   unfilled remainder is logged; a partial sell leaves the position open. Tests:
   `execution.test.ts` "compares partial fills on the displayed 8-decimal
   amounts", "caps a sell at the bar liquidity and reports the unfilled amount";
   `paper-runner.test.ts` "books a liquidity-capped partial buy once and never
   retries the remainder"; golden: 173 partial intents, each with one ledger entry
   and one `execution.partial` event.
4. **Terminal status and expiry.** Every intent ends filled/partial/rejected/
   expired; a missing next bar expires after `maxPendingBars`; a duplicate pending
   `(token, side)` is rejected. Tests: `paper-runner.test.ts` "expires an intent
   after maxPendingBars when the next bar has no candle", "rejects a second
   pending intent for the same token and side", "keeps a dust position open when
   the sell would book zero cents"; golden: unique intent ids, status split
   pinned, one execution event per intent.
5. **Ledger identities and reconciliation.** Cash = initial − buys + sell
   proceeds; position amounts = buys − sells; realized = Σ sell entries; fees =
   Σ entry fees; trade aggregates match entries; equity = cash + positions value;
   `equity − initial = realized + unrealized` within a cent; no negative cash or
   amount; the entry cash trail and `positionAmountAfter` are replayed. Tests:
   `ledger.test.ts` (buy/sell booking, partial sell, `markPortfolio`,
   `reconcileLedger` clean/tampered cases, sequence and clock monotonicity,
   duplicate ids); golden: `reconciliationOk`, per-point equity identity, the
   metrics identity, and the entry/event/ledger id equality.
6. **Cooldown and Stage 1B F2.** After a stop sell fill (`TREND_PULLBACK_STOP`,
   `RANGE_REVERSION_STOP`, `RECOVERY_STOP`) the host sets
   `cooldownUntil = fill bar open + 24h`, logs `paper.cooldown_set`, overlays the
   state and expires the deadline; the engine drops `COOLDOWN` candidates before
   ranking (`RANK_COOLDOWN`) so they cannot consume a slot. Tests:
   `paper-runner.test.ts` "sets a 24h cooldown after a stop fill, blocks re-entry,
   then allows a new buy", "clears an expired host cooldown from the final state",
   "marks positions, resets dayStart at UTC midnight and keeps the peak
   drawdown"; `decision-engine.test.ts` cooldown-drop tests; golden: 130 cooldowns,
   each matched to a stop sell, and zero buy intents inside a cooldown window.
7. **Marks, dayStart and peak.** Positions are marked at the bar close; `dayStart`
   resets on a UTC date change; `peak = max(peak, equity)`; a missing mark is a
   typed `PAPER_NO_MARK` failure, never a silent zero. Tests:
   `paper-runner.test.ts` day-reset/peak test, "marks an open position at the bar
   close…", "throws a typed error when a position has no mark"; golden: every
   equity point satisfies the identity.
8. **Metrics formulas.** Return, peak, drawdown (including a final-equity
   observation), exposure, time in market, win rate, profit factor, averages and
   per-strategy/per-token buckets; undefined ratios are `null`, never
   `Infinity`/`NaN`; `-0.00` is normalised. Tests: `metrics.test.ts` (hand-computed
   curve, win/loss/PF/averages, break-even, empty cases, signed zero, no
   mutation); golden: the pinned summary and the formula assertions in section
   5.7.
9. **Counterfactual labelling and isolation.** Rejections are entry-priced at the
   first bar opening at/after the decision time, exited at the first close at/after
   the 24h horizon, sized at a normalized $100 with the same fee/slippage, and
   every record is `hindsight: true` / `usedForDecisions: false`. The analyzer
   never calls the engine, the ledger or the log; it reads candles after the run.
   Tests: `counterfactual.test.ts` (positive/negative/neutral, low-price slippage,
   entry/exit timing, dedupe/sort, labels, insufficient data, input validation,
   mixed timeframes); golden: the label assertions and the outcome histogram.
10. **Report hash and artifact contract.** `reportHash =
sha256Hex(stableStringify(report without reportHash))`; the report contains no
    wall clock; `buildReport` rejects a journal whose count/hash disagrees with the
    run; `writePaperArtifacts` writes canonical JSONL and refuses a non-empty
    directory. Tests: `report.test.ts` ("keeps the hash stable across two builds
    and key-order perturbations", "changes the report hash when a metric changes",
    "rejects a journal that disagrees with the run audit", Markdown sections);
    `cli/paper.test.ts` (artifact round-trip, canonical lines, fresh-directory
    refusal, `1000` vs `1000.00` hash equality, non-1h rejection); golden:
    artifacts round-trip and every JSONL line is canonical.
11. **Determinism.** Two replays and a reversed-file replay produce identical
    intents, ledger, equity curve and the same hashes; no `Date.now`,
    `Math.random` or `localeCompare` in the paper module, the runner or the report
    (the only `Date.now` calls are the documented non-reproducible _default_ CLI
    run ids, bypassed by the fixed `--run-id`). Tests: golden file;
    `paper-runner.test.ts` "is deterministic across two identical runs"; the CLI
    hash-equality test.
12. **180-day report.** 4,320 bars over 180 days, final equity 1378.52, 227
    trades, 944 counterfactuals, a readable `report.md` (169 KB) and a JSON report
    (1.58 MB) with every section.
13. **No old imports, no schema, no real money.** `grep` for `@nexter/`, `apps/`,
    `ai-trading`, `trading-bots` in `packages/sandbox-core/src` returns 0 matches;
    no `any` in the package; no database, migration, HTTP, UI, wallet, key,
    signing or swap code is touched; dependencies are unchanged.
14. **Stage 1B golden unchanged.** `decision-engine.golden.test.ts` still pins
    `b260f984250cf2cca57610a3fe47c85d91d5f93c26472818f2e21f564226847a` with
    3,936 events and passes without modification (verified by the full suite and
    a targeted run of that file plus `cli/replay.test.ts`: 16 tests).
15. **Stage 1A CLI unchanged.** The replay smoke still returns 3 candles / 8
    events with the same `configVersion` and `dataSnapshotId`.

## 7. Stage 1B debt closure (design §12, commit `2225e18`)

| Stage 1B deferred item                      | Closure                                                                                                                                                               | Evidence                                                                              |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Sparse arrays could reach the canonical log | `assertJsonValue` walks arrays by index and rejects holes with a path                                                                                                 | `util/json-value.test.ts` (sparse array in `inputs`, nested)                          |
| Strategy `avgCost`/SMA could produce NaN    | `trend_pullback`, `range_reversion`, `recovery` return `hold` + `STRATEGY_NO_DATA` on a non-finite/non-positive cost or SMA; recovery also requires a finite fast SMA | each strategy test ("guards a non-finite average cost", long-decimal/Infinity cases)  |
| Cooled-down/blocked signals consumed slots  | The engine drops `COOLDOWN`/`BLOCKED` buy candidates before ranking (`RANK_COOLDOWN`/`RANK_BLOCKED`) and logs `opportunity.dropped`                                   | `decision-engine.test.ts` cooldown/blocked-drop tests; Stage 1B golden hash unchanged |
| Hardcoded strategy key list                 | `STRATEGY_KEYS` is exported from the strategy registry and used by the engine                                                                                         | `strategies/index.test.ts` sync test                                                  |
| CLI output hygiene                          | Replay defaults to package-relative `out/`; empty `--out`/`--run-id` rejected; `/out/` gitignored                                                                     | `cli/replay.test.ts` defaults/empty-value tests                                       |
| Process-global `Decimal.set`                | Documented in `decision/decimal.ts` with the module-local clone plan                                                                                                  | source comment; no behavior change                                                    |
| `ALLOC_NO_ALTERNATIVE` label                | Kept as adopted; a note marks it for a future logger touch instead of re-pinning the 1B golden                                                                        | `decision-logger.ts` comment                                                          |

## 8. Deferred items

| #   | Item                                                                                                                               | Severity |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | -------- |
| C1  | Counterfactuals are a fixed 24h horizon, not the strategy's own exit; the report says so                                           | Minor    |
| C2  | The CLI default run id is `paper-<timestamp>` (non-reproducible by design); reproducibility needs `--run-id`                       | Minor    |
| C3  | Stage 1C paper runs accept `1h` only; other timeframes are rejected with a clear message                                           | Minor    |
| C4  | A 180-day run holds ~50 MB of event JSON and a 1.6 MB report in memory; no streaming/persistence in Stage 1C                       | Minor    |
| C5  | Partial fills are IOC and never retried; a thin market simply gets smaller fills                                                   | Minor    |
| C6  | `Decimal.set` is process-global; a module-local clone is deferred until an API imports the package                                 | Minor    |
| C7  | Stage 1B D4 remains: take-profit stays `null`; exits are strategy-driven                                                           | Minor    |
| C8  | Strategy/regime parameter fitting is out of scope; the synthetic 180-day result is evidence of invariants, not a performance claim | Info     |

Nothing open can move real money, read live data, write outside the package or
start Stage 2.

## 9. Gate

**Stage 2 must not start until this review is signed off and the owner accepts the
Stage 1 report.**

- The reviewer does not edit code; findings are returned to the implementer.
- Any critical/major finding must be fixed and the full gate (tests, typecheck,
  build, lint, format) re-run before Stage 2.
- Minor findings may be deferred only if recorded in the review outcome.
- The owner must read `report.md` from a Stage 1C run (or reproduce the golden
  run) and explicitly accept the Stage 1 report before Stage 2 begins.

Review outcome template:

```
Reviewer:
Date:
Commit reviewed: f802f93 + the review-request commit
Verdict: approved | approved with findings | changes required

Critical findings (block Stage 1C):
- ...

Major findings (fix before Stage 2):
- ...

Minor findings (may be deferred):
- ...

Spec coverage: pass | fail (notes)
Quality: pass | fail (notes)
Owner acceptance of the Stage 1 report: yes | no
```
