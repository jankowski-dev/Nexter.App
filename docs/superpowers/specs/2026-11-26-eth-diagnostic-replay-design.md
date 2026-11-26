# ETH diagnostic replay for missed moves — design

Status: approved direction 2026-11-26. Research only; no Stage 3 or default changes.

## Intent

The owner wants a strategy that reacts to more market moves and accepts a larger drawdown
(roughly 30–40%) in exchange for capturing more opportunities. Before adding rules or a new
strategy, we need evidence about **why the current engine does not enter or exit at the points the
owner considers obvious**.

A chart alone is not enough. The deliverable is a diagnostic pack that joins manual marks to the
engine's per-bar state and shows which gate blocked each decision.

## Data and scope

- ETH/BSC, 1h candles, 180 days, frozen GeckoTerminal snapshot (same data path as sandbox replay).
- Fixed strategy configuration and seed; no Stage 3 runs, reports or defaults are touched.
- One baseline replay plus optional variants for the rule changes identified by the diagnosis.
- Research artifact only: no new production endpoint, no real money, no signing.

## Deliverables

1. `diagnostics.json` and `diagnostics.csv` with one row per bar:
   timestamp/bar index, OHLCV, regime, trend score, EMA fast/slow, RSI, ATR, volume z-score,
   breakout/pullback state, liquidity/spread, position state, decision, reason codes and the gates
   that blocked an entry or exit.
2. A high-resolution PDF/JPG chart:
   - 15-day segments with readable daily grid and bar indices;
   - price, EMAs, entries/exits, stop/take levels;
   - regime background, volume and RSI panels;
   - 7-day zoom pages for periods the owner marks.
3. Annotation template `annotations.csv`:
   `timestamp,expected_action,reason_code,note`, where `expected_action` is
   `entry | exit | hold | no-trade` and `reason_code` is a short controlled list
   (missed-breakout, premature-exit, wrong-regime, stop-too-tight, fees, liquidity, no-signal,
   other).
4. A join report:
   - for every mark, the nearest bar and the engine state at that bar;
   - which gate or condition blocked the action;
   - aggregate top blockers by count and estimated P/L impact;
   - counterfactual replays for the top 2–3 blockers (remove/relax one gate at a time).

## How it is built

- Reuse the existing `@nexter/sandbox-core` replay engine and frozen candle snapshot.
- Add a research-only CLI/script outside the production request path. It reads the snapshot plus a
  fixed config, writes the diagnostics and chart, then joins `annotations.csv` when present.
- Reuse the existing replay chart/report code where practical; do not change the live runner,
  decision rules or report hashes.
- Keep the exporter deterministic and file-based so the same snapshot always produces the same
  diagnostics.

## Success criteria for this phase

- The owner can mark at least 20 missed entries/exits on the ETH chart.
- The join report explains the dominant blockers and quantifies the effect of removing them.
- At least three concrete rule changes are proposed with measured impact on ETH and the five Stage 3
  tokens, using walk-forward/out-of-sample checks.
- No change is promoted to defaults in this phase.

## Non-goals

- No new strategy is implemented before the diagnosis.
- No change to Stage 3, existing replay hashes, risk rules or production defaults.
- No claim of profitability from a single in-sample run.

## Decisions taken

- Priority: capture more moves over lower drawdown. The owner explicitly accepts a 30–40% drawdown
  range; the research ceiling is 40%.
- Data source: ETH/BSC token, comparable to Stage 3. Ethereum mainnet is out of scope for this pack.
- Minimum activity: at least 20 annotated missed moves and at least 20 trades in the candidate
  replay. If the chart produces fewer usable marks, we extend the window rather than lower the bar.
