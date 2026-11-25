# ADR 0085 — Sandbox historical replay in the UI

Status: accepted, 2026-11-25; implemented, awaiting the independent whole-branch
review. Not deployed; migration `0053` is not applied.

## Context

Stage 1C built a deterministic, look-ahead-safe historical paper replay
(`PaperRunner`, `ClockedMarketView`, 180-day golden, CLI). Stage 2 added the
owner-facing live `Песочница`, which runs forward on real 1h data. The owner
needs to run the historical engine from the app to test how the system behaves
without seeing the next candle, and to compare those results with later Stage 3
forward runs. Today only the CLI exposes that engine; the UI has no historical
replay.

The Stage 2 design/ADR 0084 deliberately kept the live UI forward-only. This ADR
adds a separate owner-facing historical replay without changing the live runner,
the Stage 1B/1C rules or the old AI/legacy systems.

## Decision

1. **Add a `Прогон` tab to `Песочница`** for owner-facing historical replays,
   independent of `Запуски` (live runs). It supports 1–3 sandbox tokens,
   30/90/180-day evaluation windows, initial capital, seed and the same Stage
   1B/1C settings, coverage preflight, history, progress, result
   equity/trades/intents/counterfactuals and JSON/Markdown report downloads.
2. **Add an additive `sandbox_replays` table** and migration `0053`:
   queued/running/completed/failed/cancelled status, frozen token/config,
   evaluation window, report JSONB, report/event hashes, and the exact gzipped
   candle snapshot with its SHA-256. Owner-scoped, SELECT/INSERT/UPDATE only,
   no DELETE; archive is a soft `archived_at`.
3. **Use the existing Stage 1C engine.** Add an optional `evaluateFrom` to
   `PaperRunner` and a reusable `runPaperFromCandles` extracted from the CLI;
   the market view receives the prefix candles for lookback, while the loop,
   equity and report start at the evaluation window. Stage 1B/1C goldens and
   behavior stay unchanged when `evaluateFrom` is absent.
4. **Run asynchronously in a worker thread.** A 60-second worker under a
   Postgres advisory lock claims queued replays; the CPU-heavy run runs in a
   Node worker thread so the API and live runner keep their event loop. The
   same lock gates stale-running recovery, so a rolling deploy cannot requeue a
   replay that another instance is executing.
5. **Data from `sandbox_candles` only.** No provider call in the replay path.
   Coverage is computed for the evaluation window plus the available prefix;
   missing data blocks, a partial window requires explicit owner acceptance
   and records the actual window. The owner can refresh tokens from the
   existing token universe UI.
6. **Persist the exact input.** The gzipped prefix + evaluation candle snapshot
   and its hash are stored with the report. `sandbox_candles` is upserted and
   rolls, so this is what makes the report re-derivable after a refresh; the
   full event chain is not persisted, but `eventCount`/`eventHash` and the
   snapshot + frozen config reproduce it.
7. **Owner-only and audited.** Reuse auth/2FA/CSRF, the `SANDBOX_ENABLED` flag,
   owner-scoped queries, `sandbox.replay_*` audit rows, no DELETE, no manual
   buy/add, no real money/wallet/signing, and no old AI/`market_candles`/`ai_*`
   coupling.
8. **Review/rollout gate.** Independent per-task and whole-branch reviews;
   production migration/deploy only after owner approval with an encrypted
   backup, restore check, SHA-256 and documented rollback. Stage 3 remains
   blocked until Stage 2 is accepted and a Stage 2.1 report is accepted.

## Why a separate tab/table instead of reusing live runs

Live runs are forward-only, have a `last_bar_close`, a 60-second runner and a
`live-paper` report. Historical replays are finite, run asynchronously, start
from a frozen window and carry a `historical-paper` label. Reusing
`sandbox_runs` would mix statuses, runner queries and evidence semantics. A
separate table and tab keep the live system untouched and make archive/history
clear.

## Consequences

- Positive: the owner can test the no-look-ahead behavior from the app and
  compare saved replays with Stage 3.
- Positive: the exact input snapshot makes the report reproducible after candle
  refreshes; no event-chain bloat.
- Positive: worker thread + lock keep the API/live runner responsive; restart
  and rolling deploy are safe.
- Negative: a new table/migration, worker thread, API and UI surface; replays
  consume CPU and a few MB of report/snapshot storage.
- Negative: only 1–3 tokens and 180 days in v1; no parameter optimization,
  arbitrary dates, running cancel or event-row persistence.
- Rollback: set `SANDBOX_ENABLED=false`, stop the replay worker, revert the
  image; `sandbox_replays` stays inert and can be dropped later with a separate
  approved destructive migration.

## Migration and safety

`0053_sandbox_replays.sql` is additive, creates no rows, and grants
`nexter_app` SELECT/INSERT/UPDATE (DELETE revoked). Before production: encrypted
backup + restore check + SHA-256, migration as the owner role, app-role
verification, deploy with the flag on, `/health`/`/ready` and a short real
replay. Rollback as above.

## Stage 3

Historical replay is a comparison/evidence tool, not the forward run. Stage 3
(4–8 week forward paper) still requires Stage 2 acceptance and its own
planning; real money remains a separate Stage 4 product/security/legal decision.
