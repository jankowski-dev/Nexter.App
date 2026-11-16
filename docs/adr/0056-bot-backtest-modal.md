# ADR 0056 — Bot backtest modal instead of a standalone page

## Status

Accepted for UI-62 on 2026-11-16. No migration.

## Context

Strategy backtests lived on the separate `/testing` page. The owner had to re-enter the bot's token and parameters on the test stand, then repeat them in the bot form. The owner asked to remove the standalone page and test directly from the create/edit bot form while keeping the form open.

## Decision

- Remove the top-level `/testing` navigation item and route.
- Keep `Портфель → Роботы` and `Портфель → Стратегии` as the entry points.
- Add a `Тестировать` action to the bot create/edit drawer footer.
- The action opens a second drawer with `placement="beside"`: a wider panel anchored left of the bot drawer on desktop, full width on small screens. The bot drawer stays mounted and visible.
- The backtest panel is prefilled with the current strategy, parameter values, selected token and protective-exit toggles from the bot form.
- Strategy cards and the strategy detail drawer open the same backtest drawer with default parameters.

The backtest drawer is read-only with respect to the bot: running a test never changes the bot form or saves a bot.

## Consequences

- `BacktestPanel` accepts optional initial asset, params and stop/take-profit flags.
- `Drawer` gains an `xl` size and a `beside` placement.
- Old `/testing?strategy=` links are no longer used; the page is removed.
- No server or schema change.

## Verification

- Playwright opens the bot create drawer, selects a token, opens the test drawer, asserts two dialogs, closes the test drawer and confirms the bot form is intact.
- Web typecheck, lint and build pass.
