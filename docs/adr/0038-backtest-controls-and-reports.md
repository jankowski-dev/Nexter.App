# ADR 0038 — Backtest controls, cleanup and report clarity

## Status

Accepted for UI-41 on 2026-11-13. Migration `0037` is additive (new boolean columns and a DELETE grant on `bot_backtest_runs`).

## Context

The first backtest release was usable but the owner found several gaps:

- editing a running/stopped bot opened the edit drawer underneath the bot detail drawer;
- PDF reports showed trades but not the run conditions clearly enough, and looked plain;
- runs accumulated with no delete/clear action;
- some strategy features need to be disabled for experiments (notably stop-loss);
- only 90/180/365-day periods were offered;
- low-priced assets looked flat because the chart used a linear absolute-price scale and only closes;
- reinvestment of profits was not modelled.

## Decision

- **Drawer replacement.** `Drawer` now has an exit animation and `BotDetailDrawer` receives an `open` flag. Opening edit from the detail drawer closes the detail drawer first, waits for the exit transition, opens edit, and reopens the detail drawer after save/cancel. There is no stacked pair of bot drawers.
- **Backtest options.** `useStopLoss`, `useTakeProfit`, and `reinvestProfit` are stored per run (migration `0037`). The flags are passed into `StrategyContext`: disabling stop-loss/take-profit skips only that exit branch (both intrabar protection and the strategy's close-based check), so other exits such as trend break or mean reversion still fire. It does not post-filter whole sell decisions. Reinvestment sizes each buy from current equity instead of initial capital.
- **Run cleanup.** `DELETE /backtests/:id` removes one run; `DELETE /backtests?strategyKey=` clears the journal for a strategy. Deletions are owner-scoped and audited (`bot.backtest_deleted`). `nexter_app` receives DELETE on `bot_backtest_runs`; UPDATE remains revoked.
- **30-day period.** The UI offers 30/90/180/365 days; the API already accepted 30–730.
- **Adaptive chart.** The chart uses a logarithmic price axis when values are positive, draws daily high/low wicks, a first-close baseline, and a period-change label. This makes small absolute prices and wide ranges readable.
- **PDF redesign.** The report now has a dark header, metric cards, explicit “Исходные условия” (token, period, source, gaps, fees, slippage, stop/take-profit state, reinvestment, sizing), an equity SVG chart, labelled strategy params, a guide, alternating trade rows and a methodology/disclaimer block.

## Consequences

- Existing runs keep `true/true/false` defaults and remain readable. Their content is still immutable; deletion is the only cleanup path.
- Backtest options are experimental and do not change paper bots or the real ledger.
- Clearing runs is irreversible; the UI asks for confirmation and the audit log records the count.
- The chart log scale is a presentation choice only; backtest math stays in decimal strings.
- PDF generation remains on demand and uses the stored run snapshot.
