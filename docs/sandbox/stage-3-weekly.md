# Stage 3 weekly review

Window: 2026-11-25 → 2027-01-20. One section per checkpoint. Record facts, not
promises; link run IDs and incident numbers.

Checkpoints: 2026-12-02, 12-09, 12-16, 12-23, 12-30, 2027-01-06, 01-13, 01-20.

## 2026-12-02 (week 1)

- Run status: CAKE / BTCB / ETH / LINK / WBNB
- Equity / return / drawdown / cash / positions per run
- Trades, intents, risk checks, fees
- Coverage/staleness and data incidents
- Reconciliation/event chain: pass/fail
- Owner interventions: none / list
- Code changes/deployments: none / list
- Decision: continue / adjust / stop

## 2026-12-09 (week 2)

(same fields)

## 2026-12-16 (week 3)

(same fields)

## 2026-12-23 (week 4)

(same fields)

## 2026-12-30 (week 5)

(same fields)

## 2027-01-06 (week 6)

(same fields)

## 2027-01-13 (week 7)

(same fields)

## 2027-01-20 (week 8 / final)

- Final stop of the five runs
- Final reports and event chains
- Comparison with historical replay (closest 90-day window; note the 8-week
  exact-window limitation)
- Incident/intervention summary
- Recommendation: go/no-go for Stage 4 (real money remains a separate decision)

## Metrics to collect

For each run: initial capital, equity, total return %, realized/unrealized P&L,
max drawdown %, cash, positions, exposure %, trades, wins/losses, win rate,
fees, pending/rejected/expired intents, risk-check failures, last bar/tick,
reconciliation. For the group: active/failed/paused runs, stale tokens, data
incidents, owner interventions, code changes.

## Evidence links

- UI: `Песочница → Обзор/Запуски/Журнал/Отчёты`
- Read API: `/api/v1/sandbox/runs/:id`, `/positions`, `/trades`, `/intents`,
  `/events`, `/equity`, `/report.json|md`
- Status: `GET /api/v1/sandbox/overview`
- Baseline: `docs/sandbox/stage-3-baseline.md`
- Incidents: `docs/sandbox/stage-3-incidents.md`
