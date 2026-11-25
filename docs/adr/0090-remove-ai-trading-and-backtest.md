# ADR 0090 — Remove AI trading and bot backtest modules

Status: accepted, 2026-11-25.

## Context

The owner has accepted the independent sandbox as the long-term paper-trading
replacement. The old `ИИ-торговля` module and the robot backtest drawer are no
longer used; keeping them leaves dead routes, contracts, UI tabs, background
work and a second strategy-search stack in the application.

## Decision

1. Remove the AI-trading API module, its contracts, web feature, Crypto `ai`
   tab, owner API client calls, AI-cycle/search workers and AI-specific error
   messages. Keep the general DeepSeek/AI settings used by notes and audio.
2. Remove the bot backtest API/UI, robot `Тестировать` buttons/drawers,
   `BotBacktest*` contracts and backtest default settings from the public
   settings contract/UI. Keep the manual paper-bot runner and strategy registry.
3. Move the read-only strategy guide to `Настройки → Стратегии`; remove the
   Crypto `strategies` tab.
4. Do **not** drop `ai_*`, `bot_backtest_runs` or their columns in this batch.
   They remain inert until a separate approved destructive migration with a
   fresh backup. No production data is deleted.
5. No change to sandbox rules, Stage 3 runs or report hashes.

## Consequences

- Positive: smaller API surface, fewer background jobs and a clear
  sandbox-first navigation; no accidental AI draft creation.
- Negative: old AI recommendations/history are no longer reachable through the
  UI (tables remain); old backtest runs are no longer listed.
- Rollback: deploy the previous image; the dormant tables/columns are intact.
