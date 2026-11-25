# ADR 0086 — Sandbox Stage 3: 8-week forward paper validation

Status: accepted, 2026-11-25.

## Context

Stage 2 (live paper loop, controls, dashboard/journal/reports) and Stage 2.1
(owner-facing historical replay) are independently reviewed, accepted by the
owner and deployed. The sandbox remains paper-only. The next gate is a forward
validation on live market data: does the autonomous runner keep working for
weeks, does it reconcile, does it follow the risk limits, and how do forward
results compare with the historical replay?

The owner approved Stage 3 parameters on 2026-11-25: **8 weeks**, a different
token set, current $1,000 capital and Stage 1B/1C defaults, separate clean runs
per token, manual close allowed with logging, and code changes allowed through
review/CI.

## Decision

1. Run **five separate clean paper runs**, one token each:
   - CAKE (`bsc:0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82`)
   - BTCB (`bsc:0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c`)
   - ETH (`bsc:0x2170ed0880ac9a755fd29b2688956bd959f933f8`)
   - LINK (`bsc:0xf8a0bf9cf54bb92f17374d9e9a321e6a111a51bd`)
   - WBNB (`bsc:0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c`)
2. Each run has **$1,000 virtual capital** and the **current Stage 1B/1C
   defaults**; the runs are created as drafts, started clean, and never
   edited after start.
3. **Period:** 2026-11-25 through 2027-01-20 (8 weeks). Weekly owner
   checkpoints on Wednesdays; final stop/report at the end.
4. **Manual close** is allowed, but every use is recorded as an owner
   intervention in the Stage 3 incident log and weekly report; no manual
   buy/add exists.
5. **Code changes are allowed** only through the normal PR/review/CI path and
   must be recorded in the incident log. Strategy or risk-parameter changes
   require a new baseline and explicit owner approval; they do not silently
   alter an in-flight Stage 3 run.
6. **Evidence:** daily health, weekly metrics/reports, event/audit log,
   reconciliation, coverage/staleness, and a final Stage 3 report comparing
   forward results with historical replays.
7. **Paper only:** no real money, wallets, keys, signing, swaps or exchange
   execution. Stage 4 (real money) remains a separate product/security/legal
   decision.

## Why these tokens

Binance is HTTP 451 from the production Railway region, so `binance:*` live
ticks cannot be sustained. The selected tokens use GeckoTerminal BSC pools with
180-day 1h history and are production-compatible. CAKE/BTCB/ETH/LINK/WBNB cover
a DEX token and major-asset proxies without reusing the owner's Q/IRYS live
run.

## Consequences

- Positive: a real forward validation of the runner, data path, risk limits and
  reports over 8 weeks; comparison with Stage 2.1 replay.
- Positive: separate runs make per-token behavior and failures attributable.
- Negative: GeckoTerminal rate limits/outages can affect data; the LINK series
  started with a partial-coverage warning (extra pre-window bars), recorded.
- Negative: no exact arbitrary-date replay preset for the 8-week window; the
  final comparison uses the closest 90-day replay and overlapping behavior.
- Rollback: stop the Stage 3 runs, set `SANDBOX_ENABLED=false` and revert the
  image if a code change is at fault; data remains inert.

## Gate

Stage 3 does not start Stage 4. It ends with an owner-reviewed Stage 3 report
and a go/no-go decision. Real money remains a separate Stage 4 decision.
