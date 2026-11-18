# Static Limit Strategy Design

**Date:** 2026-11-19
**Status:** approved by owner choice A2 (absolute prices, auto re-arm)

## Intent

Add a classic paper-bot strategy where the owner sets an absolute buy price, stop price and take-profit price. It is a manual strategy, not an AI-selected one, and is valid only for a bot with exactly one token.

## Behaviour

- Params: `buyPriceUsd`, `stopPriceUsd`, `takeProfitPriceUsd`; absolute USD prices.
- Validation: `stopPriceUsd < buyPriceUsd < takeProfitPriceUsd`, all positive.
- Bot validation: exactly one token. The API rejects create/update for any other token count.
- Entry: while armed, buy when market price `<= buyPriceUsd`.
- Exit: sell when price `<= stopPriceUsd` (stop first) or `>= takeProfitPriceUsd`.
- Auto re-arm (owner choice A2): after exit the strategy enters `waiting`; it re-arms only after price recovers to `buyPriceUsd` or above, then buys on the next pullback to the limit. This prevents immediate re-buying below the buy price after a stop.
- Unconfigured prices (all zero) hold; bot create/update rejects an unconfigured static-limit bot.
- AI lab excludes this strategy (`aiEligible: false`); it remains available to manual bots and the backtest panel.

## Non-goals

- No real orders, no shorting, no per-token price maps.
- No separate re-arm button; A2 is automatic.
- No schema migration.

## Verification

- Unit tests for entry, stop, take, waiting/recovery/re-arm, unconfigured params, disabled protective exits.
- Registry count/key test.
- E2E: reject two tokens, accept one valid bot, reject updating it to two tokens.
- Format, typecheck, lint, API/web tests, build.
