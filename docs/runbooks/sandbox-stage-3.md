# Sandbox Stage 3 runbook — 8-week forward paper

Paper only. No real money, wallets, keys, signing, swaps or exchange execution.

- Design: `docs/superpowers/specs/2026-11-25-sandbox-stage-3-forward-paper-design.md`
- ADR: `docs/adr/0086-sandbox-stage-3-forward-paper.md`
- Baseline: `docs/sandbox/stage-3-baseline.md`
- Incidents: `docs/sandbox/stage-3-incidents.md`
- Weekly: `docs/sandbox/stage-3-weekly.md`
- Parent runbook: `docs/runbooks/sandbox.md`

## Baseline

Five separate runs, $1,000 each, current Stage 1B/1C defaults:

- CAKE, BTCB, ETH, LINK, WBNB (BSC, GeckoTerminal 1h).
- Window 2026-11-25 → 2027-01-20.
- Owner's `Quack AI` run is not Stage 3.
- Binance `binance:*` tokens are disabled in production (HTTP 451).

## Daily check

1. `GET /health`, `GET /ready` — 200.
2. `GET /api/v1/sandbox/overview` — active runs, last tick, stale tokens.
3. For each Stage 3 run: status, lastBarClose/lastTickAt, error, equity.
4. `GET /runs/:id/positions`, `/equity`, `/report.json` (if stopped) — no
   reconciliation error; no unexpected pending/manual-close state.
5. Check notifications/audit for new failures.
6. Record any incident/intervention in `docs/sandbox/stage-3-incidents.md`.

## Weekly check

Use `docs/sandbox/stage-3-weekly.md`:

- Equity/return/drawdown/cash/positions/exposure, trades/win rate/fees,
  intents/risk checks.
- Coverage/staleness/gaps/synthetic; GeckoTerminal 429 incidents.
- Reconciliation/event chain, failed/paused runs.
- Owner interventions and code changes.
- Decision: continue / adjust / stop.

## Owner controls

- Pause/resume/stop/archive; close one trade.
- Manual close is allowed but recorded as an intervention (time, token, reason,
  result). No manual buy/add.
- Do not edit a running run; settings are frozen at start.

## Change control

- Code changes go through PR → review → CI → merge/deploy; record commit,
  deployment and impact in the incident log.
- Bugfixes may be deployed during the run.
- Strategy/risk-parameter changes require a new baseline and owner approval;
  do not apply them to in-flight Stage 3 runs.

## Incident handling

- Data failure: retry refresh; if still missing/stale, leave the run running if
  the runner can skip safely, or stop it explicitly; record.
- Runner failure: inspect error/reconciliation; do not silently restart. Decide
  leave failed, fix and resume, or replace the baseline.
- Risk breach: pause/stop the affected run; record; owner decision.
- Never fabricate candles or edit the ledger/event chain.

## Final stop/report (2027-01-20)

1. Stop the five Stage 3 runs.
2. Download final JSON/Markdown reports and record report/event hashes.
3. Summarize equity, return, drawdown, trades, fees, interventions, incidents,
   coverage.
4. Run historical replays for the same tokens/settings over the closest
   90-day window; compare direction/drawdown/trade frequency/failure modes and
   state the 8-week exact-window limitation.
5. Write the Stage 3 report; owner accepts or rejects. Stage 4 (real money) is a
   separate product/security/legal decision.

## Rollback

- Stop the Stage 3 runs; set `SANDBOX_ENABLED=false` and redeploy if a code
  change is at fault; revert the image.
- `sandbox_*` tables are additive/inert; no production data restore is required
  for a Stage 3 rollback.
