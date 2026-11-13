# ADR 0039 — Standalone backtest stand and paper UI consolidation

## Status

Accepted for UI-44 on 2026-11-13. No migration.

## Context

The owner liked the historical backtest so much that it became the primary testing tool. Keeping execution inside each strategy card mixed two different jobs: reading what a strategy does and running an experiment. The owner also wants the final navigation shape to converge: paper robots and strategies belong with the portfolio, while Testing should be only the backtest stand.

Growing journals (trades and events in a bot, backtest runs) also made long drawers heavy because they fetched and rendered large histories at once.

## Decision

- **Strategies become documentation.** Strategy cards contain only detailed description, best-use cases, risks, how-it-works guide and default parameters. The backtest panel is removed from the strategy drawer.
- **Standalone backtest stand.** `/testing` contains one stand: a strategy selector, short description, token search, period, run options, chart, stats and report. Changing the strategy swaps the parameter form and guide without leaving the stand.
- **Portfolio consolidation.** `/portfolio` gains `Роботы` and `Стратегии` tabs after `Портфель`/`Сделки`. Robots use the existing paper-bot UI; strategies use the read-only documentation UI. Everything remains paper-only and isolated from the real ledger.
- **Detailed strategy metadata.** Strategy definitions/templates gain `bestFor` and `risks`, shown in the strategy drawer alongside the existing description and guide.
- **Paginated journals.** Bot trades/events load 20 rows per page through new `limit`/`offset` query support; a `Ещё` button appends the next page. The backtest journal starts at 20 and grows by 20 up to 100 with `Ещё`. This keeps long drawers bounded and avoids loading full histories.
- **Shared mode-driven UI.** `TestingPage` takes a `mode` (`stand`/`bots`/`strategies`) so Portfolio tabs reuse the same bot and strategy UI without duplicating state or API logic.

## Consequences

- `/testing` no longer exposes robot or strategy lists; they live under Portfolio tabs.
- Strategy descriptions are richer but still code-defined; users cannot edit them.
- Backtests remain available from Testing only. The PDF and run journal are unchanged.
- The bot detail journal makes incremental requests; older pages are fetched only on demand.
- No real-trading behavior, ledger tables, or credentials are affected.
