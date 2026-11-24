# ADR 0084 — Sandbox Stage 2: owner-facing Песочница, live paper loop and sandbox schema

Status: accepted, 2026-11-24.

## Context

Stage 1A (replay core), Stage 1B (decision engine) and Stage 1C (paper execution, ledger, report) are merged, signed off and deployed. The owner accepted the Stage 1 report on 2026-11-24 and launched Stage 2.

The sandbox is a new autonomous system, independent of the old AI/`ai-trading`/`trading_bots` modules. The old AI remains recommendation-only and separate. The owner wants the sandbox visible in the app, running live paper on real market data, with persistent runs, owner controls and evidence, before deciding whether the old systems can be removed.

Stage 1C proved the core on a 180-day deterministic historical run: report `cabf8c7d…`, event `a8fcf7cf…`, 49,379 events, 454 intents, 227 trades, +37.85% synthetic, 2.68% max drawdown, reconciliation true. That is an execution/accounting proof, not a performance claim.

## Decision

1. **Add an independent `Песочница` section** in the app (owner-only): a top-level nav entry and a page with `Обзор`, `Запуски`, `Журнал`, `Отчёты`.
2. **Add a new `sandbox_*` schema** in the existing Postgres database, separate from old AI tables:
   - `sandbox_tokens`, `sandbox_candles`;
   - `sandbox_runs`, `sandbox_run_tokens`;
   - `sandbox_events` (append-only hash chain);
   - `sandbox_positions`, `sandbox_trades`, `sandbox_ledger_entries`, `sandbox_equity_points`, `sandbox_intents`;
   - optional `sandbox_reports`.
     Migration `0052_sandbox_stage2.sql` is additive; the API role gets SELECT/INSERT/UPDATE on the mutable tables and SELECT/INSERT only on `sandbox_events`; no DELETE.
3. **Add a new `apps/api` `sandbox` module** that imports `@nexter/sandbox-core` (workspace) and the existing market-data HTTP clients. It does not import the old AI, trading-bot, search or legacy modules and does not read `market_candles`/`ai_*` tables.
4. **Add a live paper runner**: a 60-second interval under an advisory lock; at each new closed 1h bar it fetches/upserts candles, fills pending intents at the first quote after the close (Stage 1C fees/slippage/liquidity), calls the Stage 1B engine, persists state/events/projections and reconciles. No real execution.
5. **Owner controls:** create draft, start, pause, resume, stop, archive, close one trade. No manual buy/add/override. Settings are editable only in draft; the run config is frozen on start.
6. **Feature flag and rollback:** `SANDBOX_ENABLED` hides the nav/API/runner when off. Stop runners, disable the flag; additive tables can remain inert.
7. **Review gate:** Stage 2 is independently reviewed; Stage 3 (4–8 week forward paper) starts only after sign-off and owner acceptance of the Stage 2 report.

## Why a separate schema and data store

Reusing `market_candles` or `ai_*` would couple the new sandbox to the system it is meant to replace and make removal/reversibility harder. The sandbox needs its own candle retention, event chain and run state. The existing Postgres service and Drizzle tooling are shared infrastructure, not old AI logic.

## Consequences

- Positive: the owner can run and inspect the sandbox without touching the old AI; the old systems remain untouched.
- Positive: persistent event/ledger state survives restarts and supports an auditable report.
- Positive: the additive schema and feature flag allow a clean rollback.
- Negative: a new schedule/runner, data ingestion and UI add operational surface; a 51MB/run event journal needs retention/streaming in Stage 3.
- Negative: live paper fills are approximations at the first quote after the close, not exchange fills; the report labels this.
- Negative: data coverage depends on third-party providers; tokens without 180-day 1h history start with a warning and reduced confidence.
- Rollback: set `SANDBOX_ENABLED=0`, stop the runner, revert the API/UI/package changes; the `sandbox_*` tables are inert and can be dropped later with a separate approved migration.

## Migration and safety

Before the production migration: encrypted backup, restore check, SHA-256, documented rollback. The migration is additive and creates no rows. The API uses the `nexter_app` role; migration uses `MIGRATION_DATABASE_URL`. No real money, keys, wallets or signing are introduced.

## Stage 3

After Stage 2 sign-off and owner acceptance: run live paper for 4–8 weeks, keep an incident log, compare with the historical replay, and decide whether to proceed. Real money remains a separate Stage 4 product/security/legal decision.
