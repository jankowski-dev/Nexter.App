# Sandbox Stage 2 — owner report

Date: 2026-11-25
Status: **Stage 2 independently signed off, accepted by the owner, and deployed to production on 2026-11-25**
Branch: `feat/sandbox-stage-2`
Code/test head: `2e631c4` (CI green)
Final docs head: `2d100b0` (CI green)
Review packet: `docs/reviews/2026-11-24-sandbox-stage-2-review-request.md`
Design: `docs/superpowers/specs/2026-11-24-sandbox-stage-2-ui-live-design.md`
ADR: `docs/adr/0084-sandbox-stage-2-ui-live.md`

## What Stage 2 is

`Песочница` is the independent autonomous paper-trading sandbox intended to
replace the old AI/legacy trading stack. It runs on real 1h market data with
virtual money only. It is owner-only and has no wallet, key, signing, swap,
exchange order or real-ledger path.

The owner can create a draft run, choose the token universe, capital and
Stage 1B/1C limits, then start, pause, resume, stop, archive and close one
trade. There is no manual buy, add, override or real execution.

## Evidence

- New additive `sandbox_*` schema (11 tables, migration `0052`); no DELETE
  grants, `sandbox_events` is SELECT/INSERT only (UPDATE and DELETE revoked);
  no old AI/`market_candles`/`ai_*` coupling.
- 180-day 1h data with GeckoTerminal/Binance and a labelled CoinGecko synthetic
  fallback; synthetic rows cannot overwrite real OHLCV.
- 60-second live paper runner under an advisory lock; one decision per closed 1h
  bar; fills at the first quote after the decision, never the historical close;
  Stage 1C fees/slippage/liquidity/IOC; stop cooldown; manual close.
- Persistent engine/ledger state, append-only hash-chained events, projections,
  equity points, reconciliation and deterministic JSON/Markdown reports.
- `Обзор`, `Запуски`, `Журнал`, `Отчёты`, token universe, run setup and controls;
  close-trade ConfirmDialog; polling only while running; no manual buy/add.
- Feature flag `SANDBOX_ENABLED` (`true|false|1|0`), owner-only auth/2FA/CSRF,
  audit on every mutation, runbook and rollback.

Local gate and CI (frozen heads `2e631c4`/`2d100b0`):

| Check                                    | Result                                                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| API tests                                | 624 passed / 4 skipped (DB suites with Postgres in CI)                                                       |
| Core / contracts / web / db              | 552 / 55 / 258 / 1 passed                                                                                    |
| Typecheck (including `apps/api/test/**`) | pass                                                                                                         |
| Build / lint / format                    | pass                                                                                                         |
| Fake-clock e2e                           | green in CI (create → start → ticks → restart → chain → controls → close → report → archive)                 |
| App-role grant/precision suite           | executed in CI after `nexter_app` provisioning                                                               |
| Live provider smoke (CAKE/GeckoTerminal) | 4320/4320 `ok`, gaps 0, not stale/synthetic; real 17:00→18:00 UTC bars, sell filled, 17 events, report, stop |
| Binance leg                              | local 4320/4320 strict; GitHub US runners get HTTP 451, so the CI smoke skips only BTC and warns             |

CI: `2e631c4` [run 45486431945](https://github.com/jankowski-dev/Nexter.App/actions/runs/45486431945),
`2d100b0` [run 45488819468](https://github.com/jankowski-dev/Nexter.App/actions/runs/45488819468) — both success.

## Independent review

The independent whole-branch Stage 2 review found no Critical issues. Two
Important items were fixed before sign-off:

1. Transient DB/pool errors no longer permanently fail a run: terminal
   persistence/chain/state/reconciliation/clock and deterministic core errors
   mark `failed` and expire intents; infrastructure errors log, refresh the
   tick and retry on the next pass.
2. The runtime `nexter_app` grant/precision suite now actually runs in CI
   (`nexter_app` is provisioned before tests), instead of silently skipping.

The review also led to atomic stop/archive + pending-intent expiry, typed
`409 SANDBOX_REPORT_NOT_READY` for persistence-report failures, coverage copy
alignment, and the deterministic core fail-closed classification. The final
scoped re-review **signed off Stage 2**.

## Production rollout (applied 2026-11-25)

Migration `0052` was applied to production after an encrypted backup and a
verified restore check:

- dump 34,045,066 bytes, SHA-256
  `da87a9b12e9d4443479d26efec6efbbd8a9b3661d118892f17c534ecf7a14495`;
- restore into a disposable database `restore_ok=1`; counts matched (users
  1/1, trade_groups 436/436, transactions 871/871, audit_log 6019/6019,
  market_quotes 59/59, bot_backtest_runs 70/70);
- encrypted backup `nexter-2026-11-25-pre-stage2.dump.enc` SHA-256
  `7e48304c8d71a1c724f827c86f0d71ed7bb331fd24b299308773f77aad0b35a3`;
  key stored in Railway `BACKUP_ENCRYPTION_KEY` on the API service, decrypt
  verified.

Migration `0052` applied as the owner role; 11 `sandbox_*` tables exist, 0 rows,
`sandbox_events` has SELECT/INSERT only (UPDATE/DELETE false), mutable tables
have SELECT/INSERT/UPDATE and no DELETE. Railway deployment
`ad0b0b73-2df2-46bd-a403-f83074c598c5` on commit `3a6f94a` is live; bundle
`assets/index-DuCU31qc.js`; `/health` and `/ready` 200; sandbox routes return
401 without auth. No production run was started.

Rollback: set `SANDBOX_ENABLED=false` (or `0`), stop running runs, revert the
API/UI image. The additive tables stay inert; no data restore is required for
the migration itself.

## Deferred (non-blocking, for Stage 3/ops)

Report single-snapshot reads; live-tick hard-fill assertion; O(n²) full-chain
replay / 51 MB journals; JSONB canonicalization/hash; synchronous 180-day start
warmup; run-list pagination; stacked-drawer Escape; equity chart 2000-point
window; client-side journal filters; on-demand reports/counterfactuals; report
token-symbol fallback. None blocks Stage 2 sign-off.

## Owner decision (2026-11-25)

1. **Stage 2 report accepted and Stage 2 signed off.**
2. **Merge PR #324 and the production rollout approved and applied** (backup +
   restore check, migration `0052`, app-role verification, deploy, health/ready
   verification).
3. **Stage 3** (4–8 week forward paper) remains a separate plan and does not
   start until its own acceptance. Real money remains a separate Stage 4
   decision.

The owner also approved a Stage 2.1 historical replay UI: design
`docs/superpowers/specs/2026-11-25-sandbox-historical-replay-design.md`, ADR
0085, migration `0053` (not yet applied).

## Stage 3 gate

Stage 3 must not start until Stage 2 is signed off and the owner accepts this
report. The sandbox remains paper-only; no real money, wallets, keys, signing or
exchange execution is enabled anywhere in this branch.
