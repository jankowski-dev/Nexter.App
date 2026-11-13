# ADR 0036 — Strategy simplification and per-token diagnostics

## Status

Accepted for UI-37 on 2026-11-13. Migrations `0034`–`0035` preserve existing strategy parameters, then remove the strategy-instance layer. Production rollout requires a verified backup and restore check.

## Context

UI-24 introduced two layers: a code-defined strategy template and a user-owned strategy instance that stored name, description, version, and validated params. Bots referenced an instance. In practice the instance added no useful flexibility: its algorithm could not be changed, and its only editable fields were a name and a JSON param bag. The owner asked to collapse the layers so a bot directly chooses a built-in strategy and owns its numeric parameters.

The owner also observed that a bot with seven tokens traded only two of them. Quotes and minute samples existed for all tokens, so the likely cause was strategy conditions, but the UI offered no evidence. The system needs a per-token, per-tick diagnostic view instead of guesswork.

## Decision

- **No strategy instances.** `bot_strategies` is removed. `trading_bots` stores `strategy_key` and `strategy_params`. The strategy list endpoint becomes read-only and returns code metadata.
- **Read-only strategy documentation.** Each strategy definition gains `guide`, `kind` (`system`/`custom`), and `paramFields` metadata. The UI renders a read-only drawer with description, guide, default parameters, and a system/custom badge.
- **Per-bot parameters.** Bot create/update accepts `strategyKey` and `strategyParams`; changing the key without params applies that strategy's defaults. Params are validated by the same Zod schema used by the runner.
- **Migration order.** `0034` adds `bot_signals`, adds nullable `strategy_key`, adds `strategy_params`, backfills both from `bot_strategies`, sets `strategy_key` not-null, and grants `nexter_app` access. `0035` drops the FK/column and the old table. Existing production instance params are preserved exactly.
- **Diagnostics.** `bot_signals` stores one row per bot/token with the latest quote, action, reason, position flag, and time. The runner upserts it on every tick, including skip/block reasons. `GET /bots/:id/signals` merges signal rows with the bot token list so tokens that have not ticked yet are visible.
- **UI fixes folded into the redesign.** The global “Роботы работают” indicator is removed; a bot card is clickable as a whole; the bot drawer has an edit action; the bots tab has P&L/equity/profit-factor sorting; the token picker has incremental search through the shared client search helper.
- **Search reuse.** `apps/web/src/lib/search.ts` provides case-insensitive, diacritic/`ё`-normalized, multi-word AND search. Testing and Vault use it; future client-side filters should reuse it rather than duplicating logic.

## Consequences

- Existing bots keep their effective strategy and parameters through the backfill. No bot needs to be recreated.
- The extra “strategy instance” concept disappears from API, DB, UI, docs, and tests.
- Per-bot parameter changes no longer affect other bots; this matches the owner's mental model.
- Strategies remain code-only. Adding or changing an algorithm still requires tests, review, and deploy.
- `bot_signals` is diagnostic, bounded by tokens × bots, and does not participate in P&L or the real ledger.
- A token can still hold only one position at a time, but different tokens are evaluated independently. The UI now shows exactly which condition blocked each token.
- Historical backtesting remains a separate follow-up (UI-38) and will use the same strategy registry with daily bars.
