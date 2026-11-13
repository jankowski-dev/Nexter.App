# Nexter — Agent Guide

This file is for AI agents working in this repository.

The full implementation contract is [`docs/mega-prompt.md`](docs/mega-prompt.md). Read it before starting any task.

## Current phase

UI-45 (2026-11-13, ADR 0040): stateful strategy support via `StrategyContext.state` / `StrategyDecision.nextState`; runner persists per bot/token in `bot_signals.strategy_state` (migration `0038`), backtest keeps run-local state. New custom strategy `crash_protected_grid` (`Защитная сетка`): remembers high-water mark, enters crash mode at 10% drop, pauses buys and closes the aggregate position if P&L ≥ −10%; deeper loss stays open; at 30% drop resets reference to current price, resets adds and starts a new grid. Stand hides stop-loss for strategies without `stopLossPct`. Production deployment `097c824b-9842-4c56-a163-5f44fc78760d`, bundle `assets/index-Dvpfp3Wd.js`, 39 migrations.

UI-44 (2026-11-13, ADR 0039): strategies are documentation-only; the backtest panel moved to a standalone `/testing` stand with a strategy selector that swaps parameter fields. `/portfolio` gains `Роботы` and `Стратегии` tabs after `Портфель`/`Сделки`; Testing keeps only the stand. Strategy metadata adds `bestFor`/`risks`. Bot trade/event journals paginate with `limit/offset` and `Ещё` (20 per page); the backtest journal starts at 20 and grows to 100. Production deployment `b138c1ea-af5b-4b31-9f9b-cd17c5e87c94`, bundle `assets/index-pQAOvbq_.js`. No migration.

UI-43 (2026-11-13, ADR 0038 follow-up): exit flags are passed into `StrategyContext` instead of post-filtering sell decisions. Disabling stop-loss now skips only the stop-loss branch; trend-break and other exits still fire. This fixed an XNY `trend_pullback` report where a May position was held to November because the disabled stop-loss decision masked the trend-break check. Corrected replay on the same candles: +317.58% vs +187.60%, PF 2.09 vs 1.86, 18/6 vs 12/2, max DD 28.59% vs 47.15%. PDF now also shows max drawdown. Production deployment `e5192250-affc-4049-b68d-826961e6151c`, bundle `assets/index-vYeHY3mT.js`. No migration.

UI-41 (2026-11-13, ADR 0038): backtest controls and report overhaul. Bot detail/edit drawers now sequence with exit animation instead of stacking. Backtests add 30-day periods, stop-loss/take-profit toggles, and profit reinvestment stored per run; runs can be deleted individually or cleared per strategy with audit. The PDF has a dark header, metric cards, explicit run conditions, equity SVG chart, labelled params, guide and methodology. The price chart uses a log scale, high/low wicks and a period-change label. Migration `0037` adds three boolean columns and a DELETE grant on `bot_backtest_runs`; 31 existing runs were preserved with true/true/false defaults. Production deployment `534e68b1-b064-4dfb-bb96-7445ee16cccf`, bundle `assets/index-DJtO_mjB.js`, 38 migrations.

UI-37 (2026-11-13, ADR 0036): strategies are read-only code, bots store `strategyKey`/`strategyParams`, and `bot_signals` plus `GET /bots/:id/signals` explain every token's latest decision. Migrations `0034`–`0035` were applied in production after a verified backup and a backfill test on the restored copy; all existing bots kept their params. Testing UI has no global “Роботы работают”, whole-card click, an edit action in the drawer (running bots are stopped after confirmation before the form opens), P&L/equity/profit-factor sorting, incremental token search through `apps/web/src/lib/search.ts`, and a read-only strategy guide drawer. Production deployment `9d70b353-5b00-4222-bdd7-0caca4524af3`, bundle `assets/index-eCq4h8AJ.js`. UI-38 (2026-11-13, ADR 0037): historical backtesting in the strategy drawer. Daily candles come from CoinGecko `market_chart` (grouped by UTC day) with GeckoTerminal daily OHLCV as fallback; previews are cached for one hour. `runBacktest` reuses the strategy registry, executes entries/strategy exits at daily close, checks stop-loss/take-profit against daily high/low (threshold fill, gap at open, stop first) with 25 bps fee/10 bps slippage, sizes buys as `initialCapital / maxAdds`, force-closes the last position, and reports P&L, gross profit/loss, profit factor, win rate, drawdown and buy-and-hold. Runs are immutable in `bot_backtest_runs` (migration `0036`, SELECT/INSERT only), the UI animates trade markers on a full-width chart, and PDF reports are generated on demand with pdfmake/Roboto. Production deployment `6ab56830-81c5-4c88-baf4-82ef54555185`, bundle `assets/index-NW7z5vXx.js`, 37 migrations.

UI-27 (2026-11-13, ADR 0035): durable notifications. `notifications` stores owner-scoped system events (type/title/body/href/payload/readAt); `GET /notifications`, `GET /notifications/unread-count`, `POST /notifications/read-all`. Opening `/notifications` marks all read and clears the nav badge. Bot stop, forced position close and automatic stop (missing strategy/invalid params) create notifications. Migration `0033` is additive; `nexter_app` has SELECT/INSERT/UPDATE, no DELETE. Archive checkboxes on the token base and vault are on/off switches; vault login has spacing before the password; success info bars were removed, inline errors remain.

UI-24 (2026-11-12, ADR 0034): paper trading bots in a new top-level `Тестирование` section. Five built-in strategies (`momentum_breakout`, `mean_reversion`, `grid_range`, `trend_pullback`, `dca_dip`) run in a code registry with Zod-validated params. Bots have a $100-step budget, token list from the active token base, position sizing, max positions, fee/slippage, cooldown, and daily loss limit. `BotRunnerService` ticks every 60 seconds under a Postgres advisory lock, uses only `market_quotes`, simulates average-cost paper fills, and writes isolated `bot_*` tables; real ledger/swaps/signing are untouched. Migration `0032` is additive and includes `nexter_app` grants. Unit tests cover all five strategies and `apps/api/test/trading-bots.e2e.spec.ts` covers CRUD, buy/sell, stats, reset, and archive. Production release 2026-11-12: encrypted backup `nexter-2026-11-12-ui24.dump.enc` with restore-check exact match, PR #88 merged as `f4e806d`, deployment `d2e037be-d146-48d3-829a-61860c2512d2`, migration `0032` applied (33 migrations), `/ready` 200, bundle `assets/index-CJwbitFy.js`; DELETE revoked on `bot_strategies`/`trading_bots`, no bots created yet.

UI-20 (2026-11-12, ADR 0033): feedback batch covering statistics icons, compact asset card, BSC/ETH contract metadata (migration `0030`), series-wide recurring-task edits/deletes, note file attachments, compact vault rows, 24h token-base view with button sorting, sell cap and proportional P/L block, route loader, swap-preview debounce/cache, and native TRON/SOL chains/assets/accounts (migration `0031`). The owner clarified that the six balances were USD values: BNB 6.15 USD, ETH 1.15 USD, TRX 0.35 USD, SOL 2.83 USD; token quantities are computed at market price, USDT is zeroed, and XNY/POP/BASED/APR are kept. Equity is about $1,584. The token base no longer shows multi-period changes; positions/main list still do.

UI-16 (2026-11-11, ADR 0031) adds multi-period market changes: `market_quotes` gains 7d/30d/1y changes and market cap (migration `0029`, additive). CoinGecko supplies them every 10 minutes while DexScreener stays primary for price and 24h. Positions, `Основной список`, and the token base show 24h/7d/30d/1y; the token base sorts by cap or period in both directions. Token icons are cached in the API for 24 hours and `/api/v1/watchlist/icon` is exempt from no-store. UI-15 (2026-11-11) removed the trade/exchange drawer footers and the trade-journal quality column, restyled the fan, made vault rows full-width with instant search, added a transient three-second task/note save indicator, and removed pinning from the note drawer. UI-15 is live with bundle `assets/index-DuPzXk-4.js`; UI-16 is live with migration `0029` applied, 45 quotes, and the icon cache header verified; the current production bundle after UI-18 is `assets/index-lgVul-1z.js`. UI-17/UI-18 refreshed the legacy Notion data on 2026-11-11 via incremental import: 436 orders (5 added, 5 closed, 426 skipped, no errors), transactions 856→866, lots 433→438, trade groups 431→436. Order 439 stayed partially consumed after later manual activity. The control baseline now applies only to the original 431-order export (ids ≤466); later exports rely on preview totals and `detectExisting` per ADR 0032. The 3-month price period remains intentionally omitted.

Phase 11 — Other modules implemented (2026-11-09): end-to-end encrypted password vault, tasks, and notes, with ADR 0019. UI-6 followed with the Crypto accordion navigation and the dialog focus fix; production API uses the `nexter_app` role with `MIGRATION_DATABASE_URL` for pre-deploy migrations; the worker remains on the owner role because pg-boss needs DDL for its schema. Phase 10 — On-chain reconciliation (implementation and live execution accepted 2026-11-08; data reconciliation deferred to the go-live clean cutover per ADR 0014). UI redesign UI-0 through UI-7 are implemented (new navigation, Portfolio + trade journal, asset drawer, Operations/Reports, unified trade/exchange modal, position-close linkage, dashboard analytics, daily snapshots, interactive charts, watchlist groups and contract-address token discovery, period reports and trade statistics, embedded-only swap, mobile navigation, sequential multi-token close flow with stale-order recovery, token base with contract/links/investors, task list/calendar with recurring occurrences). UI-7 is complete as of 2026-11-10; migrations `0020` (token base metadata) and `0021` (task recurrence) are applied in production. UI-8 followed with task tags, compressed image attachments in `task_images`, autosave in the task dialog, square chain icons, full-width layout, and the `Открытые` default filter (migration `0022`). UI-9 added light/graphite dark themes with a header switcher and rebuilt the dashboard around icon-tiled cards and a thicker equity chart; no migrations. A separate personal-finance module followed on 2026-11-10 (ADR 0024): BYN base, accounts/categories/transactions/transfers, import preview/commit/rollback, and the full Notion history migrated (7 accounts, 19 categories, 248 operations, 43 transfers; net worth 12 129.05 BYN). Migrations `0023`–`0025` are additive and applied in production. Notes were redesigned as a journal on 2026-11-10 (ADR 0025): one-third-width read/edit drawer, safe Markdown editor, autosave, photos in `note_images` (migration `0026`), archive toggle, and 30-note pagination. UI-11 followed on 2026-11-10 (ADR 0027): tasks default to calendar with blue/green/red status chips, compact list rows without descriptions, a one-third-width view/edit drawer, soft delete with Actual/Archive switch, and notes with notebook icons, right-side pin actions, footer save status, and `Готово` returning to read mode. No migration. UI-12 (2026-11-11, ADR 0028): combined dashboard with finance/tasks/habits, `Статистика` rename, portfolio `Основной список`, token-first buy/sell and exchange drawers with 10s Kyber preview, partial single-trade close, live polling, precise small prices, token icon backfill, and habit streaks. Migration `0027` adds `habits` and was applied in production on 2026-11-11 after a verified encrypted backup and restore check. The UI-12 API deployment is live (`/ready` green, bundle `assets/index-BFRB8_I4.js`); the logo backfill filled 38 assets, and habits are available through API and dashboard. UI-13 (2026-11-11, ADR 0029): reference-counted scroll lock behind dialogs/drawers, Dashboard/Tasks as top-level navigation, portfolio `Позиции по активам`/`Основной список` sub-tabs, Buy action next to the token name, shared BNB/ETH chain toggle and compact token-base rows, and a header live-refresh countdown with brief card highlights. No migration. Deployed as PR #74 with production bundle `assets/index-Dzy6ybJW.js`; verified on production. UI-14 (2026-11-11, ADR 0030): `market_quotes` unifies DexScreener (60s, >= $25k liquidity) and CoinGecko (10 min fallback) for portfolio/dashboard/trades/watchlist; per-row check times; value-level flashes only on changed values; spinning fan instead of countdown; silent WalletConnect session restore with expiry/account validation and persisted chain. Migration `0028` was applied in production on 2026-11-11 after a verified backup/restore; the API is live with bundle `assets/index-4eVw9zSV.js`, 45 quotes, XNY 0.005035 from DexScreener, and no DELETE grant for `nexter_app`. UI-10 followed on 2026-11-10 (ADR 0026): the vault is a top-level service; finance has period presets (current, previous, custom month, year, all time) and a visual category-color palette; WalletConnect and BNB/ETH selection moved into the global header with BNB as the post-connect default; portfolio, trades, and the token base render token icons with a manual upload override. No migration. See `docs/ui-redesign.md`, the ADRs, and `docs/decisions.md`. Phase 9 — Ethereum execution (accepted 2026-11-05). Live small Ethereum swap completed; Phase 8 — Swap execution is accepted (2026-11-05). Live small BSC swap completed; WalletConnect/Tangem, exact approvals, step-up TOTP, calldata verification, execution UI, tracking, and confirmed-swap accounting are implemented. Phase 8.x hardening is accepted; remaining residuals are listed in the Phase 8 report. Ethereum execution is controlled by `SWAP_EXECUTION_ENABLED` plus `SWAP_ETHEREUM_EXECUTION_ENABLED`, and the kill switch. Phase 7 is accepted. Phase 10 adds watch-only addresses, a transfer indexer, raw gas backfill, and reconciliation runs.

Phase 3 — Accounting core, Phase 4 — Notion import, Phase 5 — MVP-1 UI, Phase 6 — MVP-1 hardening, and Phase 7 — Swap foundation are accepted. Phase 7 is scoped by ADR 0009: BSC quote/build/simulate only, no signing. Phase 8 adds WalletConnect/Tangem, exact approvals, step-up TOTP, submission/tracking, and accounting integration. No private keys or seed phrases may ever reach the server.

## Non-negotiable rules

1. No private keys, seed phrases, or signing keys on the server.
2. No public signup.
3. No wallet connection in MVP-1.
4. No swap execution in MVP-1.
5. Money is always decimal strings / Postgres `numeric`; never JS number/float.
6. Every mutation must be audited.
7. The ledger is append-only; corrections are new transactions.
8. No secrets in code, prompts, logs, or screenshots.
9. Production access is allowed only with explicit owner approval for a specific operation; take a backup first and document the rollback.
10. Schema changes require an ADR and review.
11. No destructive migrations without a backup and explicit approval.
12. Tests, typecheck, and lint must pass before merge.
13. UI is Russian, light theme, USD base currency.
14. BSC first, Ethereum second.
15. Swap tokens are allowlisted.
16. Step-up TOTP is required for swaps above $500.
17. Cloudflare is optional; application auth is mandatory.
18. RPO is 1 hour and RTO is 4 hours.
19. No third-party analytics or trackers.
20. Do not change acceptance tests to make them pass.
21. Do not invent financial or tax logic.
22. If something is unclear, stop and ask.

## Commands

Use `npx pnpm@10.20.0` if pnpm is not globally installed.

```bash
npx pnpm@10.20.0 install
npx pnpm@10.20.0 dev
npx pnpm@10.20.0 build
npx pnpm@10.20.0 typecheck
npx pnpm@10.20.0 lint
npx pnpm@10.20.0 test
npx pnpm@10.20.0 db:generate
npx pnpm@10.20.0 db:migrate
```

## Conventions

- TypeScript strict mode.
- English identifiers and code comments.
- Russian UI copy.
- Zod for input validation.
- Drizzle for database access.
- No `any` in the frontend API layer.
- Small, focused changes.
- One worktree per implementation task.
- Update `docs/decisions.md` for decisions that affect architecture or product behavior.

## Definition of Done

- Spec/acceptance criteria are clear.
- Unit/integration/E2E tests pass.
- Typecheck and lint pass.
- Migration is reviewed (if any).
- Audit log is written (if mutation).
- Errors are handled.
- Docs are updated.
- No secrets.
- Security review for sensitive changes.
- Feature flag and rollback plan where relevant.
