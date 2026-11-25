# Sandbox Stage 2.1 — historical replay owner report

Date: 2026-11-25
Status: **Stage 2.1 independently signed off, accepted by the owner, and deployed to production on 2026-11-25**
Branch: `feat/sandbox-replay` (draft PR #325, base `main`)
Code/test head: `92338d1` (CI green)
Final docs head: the commit that adds this report (docs-only; code/test tree identical to `92338d1`)
Review packet: `docs/reviews/2026-11-25-sandbox-historical-replay-review-request.md`
Design: `docs/superpowers/specs/2026-11-25-sandbox-historical-replay-design.md`
ADR: `docs/adr/0085-sandbox-historical-replay.md`

## What Stage 2.1 adds

A new `Прогон` tab in `Песочница` for owner-facing **historical replay** over
`sandbox_candles`. It wraps the already-accepted Stage 1C engine; it does not
change the live runner, Stage 1B/1C rules or the old AI/legacy systems.

- Choose 1–3 sandbox tokens, a 30/90/180-day evaluation window, initial capital
  and the same Stage 1B/1C settings.
- The evaluation window starts at the first candle **open** (`from_time`);
  earlier candles are lookback prefix only and are never evaluated or traded.
  30/90/180 days evaluate exactly 720/2160/4320 hourly bars; the 180-day run
  has no prefix because the store is 180 days.
- Decisions use only closed candles; a decision at bar `i` fills at the next
  bar open. There is no next-candle access.
- A 60-second advisory-locked worker claims queued replays and runs the
  CPU-heavy engine in a Node worker thread (the API and live runner stay
  responsive). The exact gzipped prefix + evaluation candle snapshot and its
  SHA-256 are persisted before the run, so the report is re-derivable after
  candle refreshes.
- Reports are stored as the Stage 1C `RunReport` and served as
  `historical-paper` JSON/Markdown with metrics, equity, trades, intent journal
  and counterfactuals. No report is re-run on GET.
- History, status/progress, cancel (queued only), archive (terminal only),
  owner isolation, exact `sandbox.replay_*` audits, no DELETE, no manual buy/add
  and no real money/wallet/key/signing path.

## Evidence

| Check                     | Result                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------- |
| Core tests                | 560 passed; Stage 1B/1C goldens unchanged                                          |
| Contracts                 | 60 passed                                                                          |
| API                       | 550 passed / 159 Postgres-gated skipped                                            |
| Web                       | 315 passed                                                                         |
| DB                        | 1 passed                                                                           |
| Replay-specific API tests | 63 passed (coverage 9, service 21, executor 11 incl. timeout, worker 14, report 8) |
| Security/flag/isolation   | 19 passed                                                                          |
| Total local gate          | 1,486 passed; typecheck, build, lint, `format:check` green                         |

CI on PR #325 (Postgres 17, full `pnpm test`): `92338d1` run
[45543116107](https://github.com/jankowski-dev/Nexter.App/actions/runs/45543116107)
**success**; an earlier `ad46db4` run
[45537895046](https://github.com/jankowski-dev/Nexter.App/actions/runs/45537895046)
failed the foreign Markdown report 404 test (500); fixed in `fcd2f77`, whose run
[45540307264](https://github.com/jankowski-dev/Nexter.App/actions/runs/45540307264)
passed. The final docs commit is docs-only.

The DB-gated replay e2e proves: preflight/create/worker/report, snapshot
re-derivation to the exact report/event hashes, 48 hostile candles after
`to_time` cannot change an earlier replay, queued cancel/terminal archive,
lock-gated restart/replay-once, owner 404s and exact audit rows. The whole
branch is paper-only and has no old AI/`market_candles`/`ai_*` access.

## Independent review

The independent whole-branch Stage 2.1 review **signed off** with no Critical or
High findings. It noted 10 Minor/robustness items, none blocking acceptance:

- worker coverage revalidation is weaker than the design wording (the create
  gate enforces full window coverage; a row loss between create and claim could
  shorten the evaluated window while the report still shows actual bars);
- the UI form uses the API default `seed = 7`; the packet/design said the form
  exposes a seed (API supports it; a UI seed field is deferred);
- the former packet head statement is corrected to “last behavioral change
  `fcd2f77`; code/test head `92338d1` (dead-code removal + timeout test)”;
- the `claimQueuedReplay` row-lock comment overstates its guarantee (the
  advisory lock and conditional update are the real serialization);
- status updates and audit inserts are separate statements (a crash window can
  leave a mutation without its audit row);
- API-only whitespace names/disabled tokens are accepted; the UI prevents them;
- the report GET does not validate `report.period` against the stored window;
- report notes are English in a Russian UI (matches the existing live report
  convention);
- DB e2e isolation relies on serialized files/truncation and a singleton-index
  drop/restore;
- one doc sentence about `PAPER_EVALUATE_FROM_OUT_OF_RANGE` is imprecise.

Deferred (non-blocking): connection-loss split-brain without a claim stamp, no
attempt bound/backoff, one claim per 60s pass, event-loop gzip staging (~60 ms),
report body re-hash, persisted prefix-length column, running replay cancel,
arbitrary dates, 50-row UI history cap, preflight→create race recovery, stale
preflight on a long-lived form, unused download helper, create-disabled form
validation, per-token window-derived staleness, English report notes, full
event-chain persistence (report + snapshot is the v1 record), and measurable
3×180-day row size.

## Production rollout (applied 2026-11-25)

The owner accepted Stage 2.1 and approved the rollout. The pre-migration
encrypted backup was taken and restore-checked:

- dump 34,250,321 bytes, SHA-256
  `c1679b9d9e3111ef27a4cd15b2e77defbcefccd8fdb42e8510d05543720d23b3`;
- restore into a disposable database `restore_ok=1`; counts matched (users 1,
  trade_groups 436, transactions 871, audit_log 6033, market_quotes 59,
  bot_backtest_runs 70, sandbox_runs 1, sandbox_events 34);
- encrypted backup `nexter-2026-11-25-pre-stage21.dump.enc` SHA-256
  `74bb8e4c6c052187ea1807a16b5cf4e1c04855c92fd4d215ab60bd395695d0dc`;
  the Railway `BACKUP_ENCRYPTION_KEY` key was used, and decryption was verified.

Migration `0053` was applied as the owner role. Production now has 12
`sandbox_*` tables; `sandbox_replays` is empty at apply time and the app role
has SELECT/INSERT/UPDATE with no DELETE. `sandbox_events` remains SELECT/INSERT
only. The migration count is 54.

PR #325 was squash-merged as `c3e74da`. Railway deployment
`642c0841-fbdf-4daf-b695-df779ba7aa3f` is live; bundle
`assets/index-XeLpGvUf.js`; `/health` and `/ready` 200; unauthenticated
`GET /api/v1/sandbox/replays` returns 401; main CI passed
([run 45551913273](https://github.com/jankowski-dev/Nexter.App/actions/runs/45551913273)).

The owner had already exercised the new tab after the rollout: two real
180-day Q replays completed with reports and audit rows. The latest report:
final equity 1085.46 USD, +8.55%, max drawdown 9.92%, reconciliation true,
4320 evaluated bars; six `sandbox.replay_*` audit rows exist. The running Q
live run is the owner's, not a rollout artifact. No extra production replay was
created by the rollout agent.

Rollback: set `SANDBOX_ENABLED=false`, stop the worker/replays, revert the
image; `sandbox_replays` is additive and inert; no restore is required for the
migration itself.

## Owner decision (2026-11-25)

1. **Stage 2.1 report accepted and Stage 2.1 signed off.**
2. **Production rollout approved and applied** (backup + restore check,
   migration `0053`, app-role verification, deploy, health/ready and real
   replay verification).
3. Stage 3 (4–8 week forward paper) remains a separate plan and does not start
   until its own acceptance. Real money remains a separate Stage 4 decision.

## Gate

Production migration `0053`/deploy only after the independent review and this
owner approval. Stage 3 remains blocked until Stage 2 and Stage 2.1 are accepted.
No real money, wallets, keys, signing or exchange execution is enabled anywhere
in this branch.
