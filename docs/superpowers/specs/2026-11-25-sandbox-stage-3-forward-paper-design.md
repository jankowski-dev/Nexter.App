# Sandbox Stage 3 — 8-week forward paper validation design

Date: 2026-11-25
Status: **active** (owner-approved; 2026-11-25 through 2027-01-20)
Scope: Stage 3 only. Paper only: no real money, wallets, keys, signing, swaps or exchange execution. Stage 4 is a separate decision.

Base: Stage 2.1 deployed (`c3e74da`, deployment `642c0841-fbdf-4daf-b695-df779ba7aa3f`, migration `0053` applied). See ADR 0086.

## 1. Intent

Validate the autonomous sandbox in forward time over 8 weeks: data continuity,
runner reliability, risk adherence, reconciliation, reports and owner controls,
and compare the forward behavior with historical replay. This is not a
performance-optimization exercise and not a real-money rollout.

## 2. Baseline

| Run            | Token key                                        | Capital | Started (UTC)       | Run ID                                 |
| -------------- | ------------------------------------------------ | ------: | ------------------- | -------------------------------------- |
| Stage 3 — CAKE | `bsc:0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82` |  $1,000 | 2026-11-25 06:35:25 | `ab8e3adf-7ce7-429b-ab84-739f411a50c3` |
| Stage 3 — BTCB | `bsc:0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c` |  $1,000 | 2026-11-25 06:47:49 | `d0b24abd-b4bf-4134-9ee4-5d8fa8071b95` |
| Stage 3 — ETH  | `bsc:0x2170ed0880ac9a755fd29b2688956bd959f933f8` |  $1,000 | 2026-11-25 06:50:13 | `1b5f2983-28b4-4c3d-ae15-7cb418077e3f` |
| Stage 3 — LINK | `bsc:0xf8a0bf9cf54bb92f17374d9e9a321e6a111a51bd` |  $1,000 | 2026-11-25 06:55:07 | `179f0ee7-025c-41b8-88e9-75e8d4808807` |
| Stage 3 — WBNB | `bsc:0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c` |  $1,000 | 2026-11-25 06:58:27 | `6e7fcda0-6dd8-4cc7-a14c-8ded1a7d7d9e` |

The owner's separate `Quack AI` run is not part of Stage 3. The four old
`binance:*` tokens were disabled after Binance returned HTTP 451 in production.

Defaults: Stage 1B/1C defaults (5 positions, 20% token, 40% strategy, 10% cash
buffer, 2% daily loss, 15% max DD, 1% risk, 25/10 bps fee/slippage, 1% liquidity,
IOC, 24h stop cooldown).

## 3. Period and cadence

- Start: 2026-11-25 (runs started 06:35–06:58 UTC).
- End: 2027-01-20 (8 weeks).
- Weekly checkpoints: 2026-12-02, 12-09, 12-16, 12-23, 12-30, 2027-01-06,
  01-13, 01-20. Final stop/report on 2027-01-20.
- Daily automated health check (owner or agent): `/health`, `/ready`, run
  status, last tick/bar, error, coverage/staleness, reconciliation.
- Weekly owner review: metrics, incidents, interventions, deviations from
  replay; decision continue/adjust/stop.

## 4. Data

- `sandbox_candles` BSC 1h GeckoTerminal for all five tokens.
- 180-day warmup; expected 4,320 closed bars per token.
- CAKE/BTCB/ETH/WBNB started `ok` 4320/4320. LINK started `partial` because the
  provider returned 4,320 bars with 18 extra pre-window hours (no missing bar in
  the evaluation tail); the partial start was explicitly accepted and recorded.
- GeckoTerminal 429 retries are expected; a failed refresh must be retried, not
  hidden. No fabricated candles.
- The API does not use Binance in production (HTTP 451 from the Railway region).

## 5. Runner and controls

- The existing 60-second runner ticks each running run on a new closed 1h bar.
- Owner controls: pause/resume/stop/archive, close one trade. No manual
  buy/add/override.
- Manual close is allowed; it is queued and fills at the next fresh quote. Every
  manual close is recorded as an intervention with time, token, reason and
  result.
- A run failure (data/engine/reconciliation) is an incident; do not silently
  restart it. Decide explicitly whether to leave it failed, resume after a
  fix, or create a replacement baseline.

## 6. Change control

- Code changes are allowed through PR → review → CI → merge/deploy.
- Bugfixes may be deployed during the run; record the change, deployment and
  impact in the incident log.
- Strategy/risk-parameter changes are not applied to in-flight Stage 3 runs.
  They require a new baseline and owner approval; the affected runs are
  restarted or replaced, and the change is recorded.
- Never weaken the paper-only, owner-only, no-DELETE or audit gates.

## 7. Evidence

- Daily: run status/equity, last tick/bar, error, coverage, reconciliation.
- Weekly: equity, P&L, drawdown, cash, exposure, trades, win rate, fees,
  intents/rejections, interventions, incidents, comparison with replay.
- Final: Stage 3 report with evidence and go/no-go for Stage 4.
- Event chain, audit and reports remain in production; no real money.

## 8. Historical replay comparison

At the end, run historical replays for the same tokens and current settings over
the closest available 90-day window (the replay tool supports 30/90/180-day
presets) and compare direction, drawdown, trade frequency and failure modes.
Exact 8-week arbitrary-date replay is a future enhancement; note the limitation.

## 9. Success criteria

1. Five Stage 3 runs remain operational for 8 weeks or have explicitly
   documented incidents/replacements.
2. Every tick reconciles; no silent state/ledger/event-chain corruption.
3. Coverage/staleness is visible and handled; no fabricated data.
4. Risk limits are respected; manual interventions are logged and explained.
5. Weekly reviews and final report exist; owner accepts Stage 3.
6. No real money/wallet/key/signing path.

## 10. Non-goals

- Real money, exchange execution, wallets, keys, signing, swaps.
- Parameter search/optimization or changing rules mid-run.
- Old AI/legacy integration; Stage 3 uses only `sandbox_*`.
- Promising returns; this is an operational/evidence validation.
