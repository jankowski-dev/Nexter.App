# ADR 0069 — Configurable settings, dynamic swap allowlist and automation proposals

Status: accepted (2026-11-18)

## Context

Nexter kept most operational values in code or env: quote intervals, liquidity floor, slippage/impact/gas limits, bot defaults, reminder lead time, autosave, polling and automation caps. The owner asked for a flexible settings section. Separately, the on-chain swap token allowlist was a static code registry, so every new token required a code change and deploy. The owner approved a self-service allowlist and a cautious automation model.

## Decision

### 1. Settings

- Extend the existing per-owner `settings` row with typed columns for market data, swaps, bots/backtest, tasks/notes, reports/UI polling, notification toggles, automation defaults and caps. Additive migration `0046`.
- Defaults equal the previous hardcoded behavior; no behavior changes on deploy.
- `SettingsService.getRuntime()` caches a converted snapshot for 30 seconds for hot paths. `update` invalidates it.
- The settings hub becomes navigation plus quick accounting/export cards. New pages: `Учёт и отчёты`, `Рынок и графики`, `Торговля и свопы`, `Роботы и бэктест`, `Автоматизация`, `Задачи и заметки`, `Уведомления`, `Диагностика`, `Данные и экспорт`. Existing `Безопасность`, `Интерфейс`, `ИИ` remain; audit is linked from security.
- Security-critical values stay in env and are read-only in diagnostics: execution flags, kill switch, router/executor/selector/wallet allowlists, RPC, API keys, auth limits, session TTL, PBKDF2.
- Money values stay decimal strings in contracts and `numeric` in Postgres. Integer toggles/ranges are validated by Zod, a few DB checks cover enum-like fields.

### 2. Dynamic swap allowlist

- Add `watchlist.swap_enabled` (default false) in migration `0047`.
- A token is swappable only when it is active, belongs to the default `Основная` group, and the owner explicitly enabled swaps in the token drawer.
- `SwapTokenRegistryService` loads these tokens into an in-process map at startup and refreshes every 60 seconds. `getSwapToken` checks the static registry first, then the dynamic map.
- `GET /swap/config` appends dynamic tokens, deduplicated against the static registry.
- All existing safety checks remain unchanged: router/executor/selector/wallet allowlists, exact approvals, calldata validation, simulation, gas/impact caps, step-up TOTP and kill switch. Existing env swap limits remain hard upper bounds; settings can only tighten them.

### 3. Automation (superseded by ADR 0070)

The global automation UI/rules described in this section were replaced by per-order protection and delayed buys in ADR 0070. The module was never registered; its code and `automation_*` tables are removed by ADR 0072 / migration `0050`.

- Add `automation_rules`, `automation_rule_state` and `automation_runs` in migration `0047`; grants are SELECT/INSERT/UPDATE without DELETE.
- Supported rules: `buy` (price below or drop from high), `stop_loss`, `take_profit`, `trailing_stop`.
- Execution modes: `dry_run` (signal + notification) and `proposal` (notification + link to the trade card). There is **no** ledger or swap write: the server has no signer and must not have one.
- The runner ticks every 60 seconds under `pg_try_advisory_lock('nexter:automation-runner')`, uses fresh quotes only, evaluates per trade group, and enforces per-rule cooldown, per-rule max order, daily action and daily USD caps. Stop-loss/take-profit closes are not blocked by the per-order USD cap.
- `automation_enabled` defaults to false. All rule changes, triggers and pause-all actions are audited; triggers create notifications with `/trades/:id` or `/portfolio#tokens` links.
- Defaults chosen by the owner: stop-loss 10%, take-profit 20%, trailing 8% after +10% activation, buy on a 10% drop, $100 buy, max order $250, max daily $500, 5 actions/day, 60-minute cooldown.

## Consequences

- No code change/deploy is needed to enable a token for swaps, but the owner must explicitly flip the switch; the default group alone is not enough. This prevents accidental execution of an arbitrary contract.
- Settings changes apply at the next scheduler tick or immediately in request paths; interval settings do not require a restart because schedulers check the runtime snapshot.
- Automation cannot act without the owner: dry-run only notifies; proposal opens the existing trade/buy flow. True unattended execution remains a separate project with an external signer/AA or limit-order keeper.
- Two additive migrations must be applied with a pre-migration backup. `nexter_app` receives no DELETE on the new automation or history tables. Rollback is a redeploy of the previous image; the new tables/columns can remain.
- The chart and quote providers are still external; settings can reduce or increase pressure, but provider limits remain the hard boundary.
