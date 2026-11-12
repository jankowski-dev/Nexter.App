# ADR 0034 — Paper trading bots

## Status

Accepted for UI-24 on 2026-11-12. Migration `0032` is additive and not yet applied to production at the time of the decision. Production rollout requires a verified backup and restore check.

## Context

The owner wants to test trading strategies without the speed and risk limits of manual execution. The long-term goal is automated non-custodial DEX trading from the same interface. The first version must be safe, auditable, and useful without exposing private keys or real funds.

The owner chose:

- paper trading only for v1;
- built-in, code-defined strategies with typed parameters;
- a 60-second tick from the existing `market_quotes` source;
- budget fraction per trade plus a maximum number of open positions;
- all tokens from the active token base that have a quote;
- no historical backtest yet;
- an independent paper portfolio per bot and a reset action.

## Decision

- **Isolated paper ledger.** New tables `bot_strategies`, `trading_bots`, `bot_tokens`, `bot_positions`, `bot_trades`, `bot_equity_snapshots`, `bot_events`, and `bot_quote_samples`. Paper trades never write to `transactions`, `postings`, `lots`, or `trade_groups`.
- **Strategy registry.** Strategies are TypeScript modules in `apps/api/src/modules/trading-bots/strategies/` with a stable `key`, version, Zod params schema, defaults, and `evaluate(ctx)`. A new strategy requires code, tests, and deploy; arbitrary user scripts are not executed. The initial five strategies are `momentum_breakout`, `mean_reversion`, `grid_range`, `trend_pullback`, and `dca_dip`.
- **Runner.** `BotRunnerService` ticks every `BOT_RUNNER_INTERVAL_SECONDS` (default 60) under a session-level Postgres advisory lock `nexter:bot-runner` on a dedicated pool connection. `BOT_RUNNER_ENABLED` is the emergency stop. `runOnce()` is public for tests and manual operations.
- **Execution model.** Each tick reads `market_quotes`; quotes older than five minutes are skipped. Buy size is `min(budget * positionSizePct / 100, cash)`. Max positions limits new positions only. Fee and slippage are simulated in basis points. Positions use average cost; buy cost basis includes the fee, sell realized P&L is net proceeds minus cost basis. Cooldown blocks buys per token; the daily loss limit blocks buys after the configured realized loss.
- **Statistics.** The API computes cash, positions value, equity, realized/unrealized/total P&L, gross profit/loss, profit factor, win rate, trade counts, open positions, and max drawdown from snapshots.
- **Audit.** User mutations are audited through `AuditService` (`bot.*`). Paper trades and runner events are business records in `bot_trades`/`bot_events`, not `audit_log` entries.
- **API/UI.** `/api/v1/trading-bots` exposes strategy CRUD, bot CRUD/start/stop/reset/archive, trades, events, and equity. `/testing` is a top-level Russian UI with full-width bot cards, running fan, strategy tab, and a detail drawer.
- **Budget rules.** The default budget is $1,000; the step is $100; the minimum is $100. Budget is immutable after creation; `reset` restores the same budget and clears the paper portfolio.
- **Independent bots.** Multiple bots may trade the same token; their positions, cash, and statistics are independent.
- **Retention.** Quote samples are kept for `BOT_SAMPLE_RETENTION_DAYS` (30), events for 90 days, and equity snapshots for 365 days. Cleanup runs during ticks.
- **Live trading remains blocked.** WalletConnect/Tangem requires manual confirmation for every signature. A future live venue needs an owner-approved signer/session-key/account-abstraction design and a separate security review. The server must not store private keys or seed phrases.

## Consequences

- Migration `0032` is additive. `nexter_app` receives SELECT/INSERT/UPDATE on `bot_strategies`/`trading_bots` and SELECT/INSERT/UPDATE/DELETE on the child tables because reset and retention need DELETE; the API does not gain grants on unrelated tables.
- The runner runs in the API process, not the worker. A stopped API means no bot ticks. The advisory lock prevents duplicate ticks across replicas.
- One-minute ticks are not HFT. Stop-loss and take-profit can be delayed by up to one interval.
- Paper fills use the last quote with fixed slippage and do not model pool depth. Results are comparative, not a guarantee of live performance.
- Strategy changes require a deploy. The owner can create named instances and edit validated parameters without code changes.
- Bots do not affect the real ledger, reports, taxes, or swap allowlists.
- If the strategy registry loses a key or a strategy is archived, existing bots cannot be started until a valid strategy is assigned.
