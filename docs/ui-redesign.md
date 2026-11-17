# UI redesign — target information architecture

Status: **UI-0 through UI-70 implemented.** Owner-approved direction on 2026-11-08; latest feedback batches are UI-67 (trading page) and UI-68 (logout/finance/tasks) on 2026-11-17. Russian light theme by default, USD base currency for crypto, no third-party analytics or trackers.

## Goals

- Reduce the number of steps for the core workflow: open/close a trade, exchange assets, record a deposit/withdrawal.
- Merge portfolio and trade management into one workspace.
- Make the dashboard a decision screen, not a wall of cards.
- Add user-defined watchlist groups and contract-address token discovery.
- Keep every swap security gate: allowlists, calldata verification, exact approvals, step-up TOTP above $500, kill switch, WalletConnect signing. UI automation may reduce quote/build clicks, but never signs automatically.

## Final navigation

| Item       | Contents                                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------- |
| Dashboard  | Combined crypto/finance summary, today's tasks, habit streaks                                                             |
| Крипта     | One page, seven tabs: Обзор (summary + consolidated + main list), Токены, Ордера, Операции, Роботы, Стратегии, Статистика |
| Operations | Deposits, withdrawals, exchanges; no trades                                                                               |
| Watchlist  | User-created groups, contract-address token search, token cards                                                           |
| Статистика | Detailed crypto P&L, trade statistics, operations, fees/gas, exports                                                      |
| Finance    | Personal BYN accounts, operations, transfers and period overview                                                          |
| Vault      | Separate top-level service: E2E-encrypted passwords and access notes                                                      |
| Tasks      | Personal tasks, priorities, due dates, calendar/list journals                                                             |
| Notes      | Journal-style notes, tags, photos, pinning                                                                                |
| Settings   | Existing settings, security, accounts, audit, data quality; legacy import link                                            |

- No separate **Trades** entry. `/trades` redirects to Portfolio; `/trades/$tradeId` remains the detail route.
- No separate **Swap** entry. Buy/sell runs in the token trade drawer; on-chain exchange runs in the Operations exchange drawer. `/swap` redirects to `/portfolio`.
- Phase 11 adds **Vault**, **Tasks**, and **Notes**. The vault is end-to-end encrypted in the browser; tasks and notes are plaintext owner-only modules.
- UI-6 groups Dashboard, Portfolio, Operations, Watchlist, and Статистика under a top-level **Crypto** accordion. UI-10 moves **Vault** out of that accordion: it is a separate top-level service, together with Finance, Tasks, Notes, and Settings. Crypto opens on click/expand and stays highlighted when collapsed.
- Import is legacy under Settings until the clean cutover; it is not part of the go-live path.

## Portfolio

- Tabs (historical UI-0 design): `Портфель`, `Основной список`, `Сделки`.
- Current UI-69 workspace: one `Крипта` entry with `Обзор`, `Токены`, `Ордера`, `Операции`, `Роботы`, `Стратегии`, `Статистика`; the main list is at the bottom of `Обзор`; active trades and the full journal are in `Ордера`. See ADR 0067.
- Summary cards: cash, positions value, equity, position count.
- Asset table: quantity, price, average price, value, cost basis, unrealized P&L, share.
- Clicking an asset opens a right-side drawer with lots, trade groups, transactions, thesis/tags, and a link to the full asset card.
- Historical UI-12 `Основной список` showed the default `Основная` group with price/24h/position/value and `Купить`. Current UI-67 renders it in `Ручной` as clickable token blocks with a 3-month weekly chart; tokens outside the on-chain allowlist still offer manual entry.
- `Сделки` opens the trade journal; clicking a row opens the sell drawer. The old mass-selection close flow is removed.

## Trade and exchange drawers (UI-12)

The token-first buy/sell drawer replaces the unified trade/exchange modal:

```text
Buy BASED
CoinGecko price | KyberSwap price | difference
Pay: USDC [selector]     Network: BNB Smart Chain
Amount: [ ... ]
Receive: computed output, minimum after slippage
Gas | price impact | slippage | remaining
[ Buy BASED ]
```

- The token is fixed by the row that opened the drawer; there is no token selector.
- USDC is the default quote asset; any cash-equivalent token in the same chain allowlist can be used.
- KyberSwap preview refreshes every 10 seconds through `POST /swap/preview`; it does not persist an order.
- One `Купить` click runs quote → build → approval if needed → WalletConnect signature → submit → tracking. Step-up TOTP and calldata verification stay mandatory.
- After a confirmed buy, the drawer shows the trade summary and switches to sell mode with the full remaining amount prefilled.
- Manual recording remains a separate `Ручная сделка` dialog. Manual exchange, deposit, withdrawal, income, and adjustment live in `Новая операция`; a manual exchange creates a normal swap operation and appears in `Обмены`.
- On-chain exchange runs in the dedicated Operations exchange drawer with the same automatic execution flow.

### Closing positions

- Only one trade group can be closed per on-chain order: `closeGroupIds: [tradeGroupId]`.
- The requested amount may be less than or equal to the group remaining amount. `swap_order_close_groups.expected_amount` stores the requested close amount.
- Accounting consumes lots only from the selected group (FIFO inside it) and refreshes the group to `closed` or `partial`; a partial sale keeps the remaining position.
- Validate ownership, asset, open status, and remaining amount at build/sign; fail closed if anything changed.
- The API retains multi-group compatibility for historical orders, but the UI no longer creates multi-group closes.

### Exchange semantics

- A crypto-to-crypto exchange is an **operation**, not a trade group. It appears in Operations, not in the trade journal.
- The source lot is consumed and realized P&L is recognized; the destination lot is created without a trade group. This preserves ledger correctness without presenting the exchange as a trade.
- A pure cost-basis transfer without P&L is a different accounting policy and requires explicit owner approval; do not implement it implicitly.

## Dashboard / Статистика

The main dashboard is a short overview:

- Crypto: current-month net P&L, positive unrealized, negative unrealized, equity.
- Finance: average daily expense/income and month income/expense in BYN.
- Open tasks due today, including overdue, in the same compact row style as the tasks list.
- Habit streaks with a name and start date; archived habits can be restored.

Detailed metrics live in `Статистика` (`/statistics`; `/reports` redirects):

- Profit factor: gross realized profit / absolute gross realized loss (formula shown in a tooltip).
- Gross positive/negative unrealized P&L.
- Win/loss parity: winning vs losing closed trades in absolute USD.
- Free cash outside positions, split by cash asset (USDT/USDC).
- Gas paid from confirmed swap network fees; manual/imported gas remains unknown.
- Daily portfolio snapshots after the clean cutover; historical points before the cutover stay approximate.
- Interactive chart hover with date/value.
- Period filters, trade statistics, operations, fees/gas, asset breakdowns, and CSV export. No tax calculations.

## Watchlist

- User-created groups; a token has one primary group. The "Main" group feeds the trade asset picker.
- Search by contract address with an explicit chain selector. Server-side metadata: on-chain symbol/name/decimals, CoinGecko price/icon, cached.
- Store stable metadata and a cached icon; do not copy volatile market metrics into the asset row.
- A token from the watchlist can be recorded manually. On-chain execution remains limited to the swap allowlist; show that distinction in the UI.
- Arbitrary token creation must handle duplicate symbols/contracts and scam-token risk.

## Backend work

1. `swap_orders` / build request: `closeGroupIds` linkage; accounting consumes selected groups.
2. Analytics endpoints: profit factor, gross win/loss, cash by asset, gas; daily snapshots.
3. Watchlist groups schema and CRUD (ADR + migration).
4. Market data service: CoinGecko + on-chain metadata, cache, icon proxy; no client-side trackers.
5. Asset creation from contract address with duplicate/scam checks.
6. Статистика aggregation and export endpoints.

## Delivery order

- **UI-0** — shell, navigation, Portfolio + trade journal merge, asset drawer, Operations/Статистика pages, Import legacy link. No backend changes. Implemented.
- **UI-1** — unified trade/exchange modal (superseded by UI-12), transactions, `closeGroupIds` backend. Implemented: the global “+ Операция” and the Portfolio “Новая сделка” use the same modal with Trade, Exchange, Deposit, and Withdrawal tabs; manual recording, embedded on-chain execution, and one/several/all open-group selection. UI-12 removes this modal and the mass-close flow. Income and adjustment live under “Дополнительно” to avoid a tab pile. Internal transfer was removed from the UI because the owner does not send crypto to third parties and the current setup has one wallet per chain; the backend transfer endpoint remains for a future multi-wallet flow. The legacy manual dialog was removed.
- **UI-2** — dashboard metrics and interactive charts, daily snapshots. Implemented: profit factor, gross profit/loss, win rate, positive/negative unrealized, cash by asset, gas paid, daily snapshot capture, snapshot-backed equity curve, and hover tooltips on line/bar charts.
- **UI-3** — watchlist groups, contract-address search, market data. Implemented: user-created groups with a default group, group moves, contract-address search with on-chain metadata, CoinGecko price/icon enrichment, server-side icon proxy, and watchlist cards with prices.
- **UI-4** — reports/statistics. Implemented: period presets and custom dates, realized P&L and trade statistics, fees/gas, cash-flow summary, monthly detail, per-asset realized results, operation counts, period-scoped transaction export, and current portfolio/allocation/equity charts. No tax calculations.
- **UI-5** — remove the hidden legacy swap route from the go-live path, E2E, responsive polish. Implemented: `/swap` redirects to `/portfolio`; the UI-1 swap panel was embedded-only inside the trade/exchange modal (removed by UI-12); unused standalone swap history was removed; mobile navigation and dialogs are covered by E2E. The legacy Notion import remains under Settings until the clean cutover.
- **UI-10** — owner feedback: vault as a separate top-level service; finance period presets (current, previous, custom month, year, all time); Russian finance labels; visual category color markers; global header wallet/chain controls with BNB default; token icons from the token base with manual upload. Implemented. No migration. See ADR 0026.
- **UI-11** — tasks/notes journal polish: calendar-first tasks with blue/green/red status chips, compact task list without description, one-third-width task view/edit drawer, soft delete + Actual/Archive switch, notes with notebook icon and right-side pin actions, footer save indicator, `Готово` returns to read mode, and page/dialog/drawer motion. Implemented. No migration. See ADR 0027.
- **UI-12** — crypto/habits overhaul: combined main dashboard, `Статистика` rename, portfolio `Основной список`, token-first buy/sell drawer with live 10s Kyber preview and partial single-trade close, separate manual trade/operation dialogs, on-chain exchange drawer, trade tabs (active/profitable/losing/closed), live polling, exact tiny-price formatting, clearer BNB/ETH switch, background token icon backfill, and habit streaks. Migration `0027` adds `habits`. See ADR 0028.
- **UI-13** — UI polish: reference-counted scroll lock behind dialogs/drawers, Dashboard and Tasks moved to top-level navigation, portfolio `Позиции по активам`/`Основной список` sub-tabs, Buy action next to the token name, shared BNB/ETH chain toggle and compact one-row token list in the token base, and a header live-refresh countdown with a brief green flash on updated cards. No migration. See ADR 0029.
- **UI-14** — unified market quotes and live-value polish: `market_quotes` with DexScreener primary (60s) and CoinGecko fallback (10 min), one price source for portfolio/dashboard/trades/watchlist, per-row last-update times, value-level green flashes only when displayed values change, a spinning fan instead of the countdown, and silent WalletConnect session restore with persisted chain. Migration `0028`. See ADR 0030.
- **UI-15** — owner cosmetic batch: trade/exchange drawers drop the footer status and `Готово` (backdrop/X close), the trade journal drops the quality/reconciled column, the fan loses its background and grows slightly, the vault list is full-width with instant search, task/note saves show a transient three-second loader, and pinning leaves the note drawer. No migration. See `docs/decisions.md`.
- **UI-16** — multi-period market changes, token-base sorting, and icon caching: `market_quotes` gains 7d/30d/1y changes and market cap from CoinGecko; positions, Основной список, and token base show 24h/7d/30d/1y; token base sorts by cap or any period in both directions; icons are cached in the API for 24 hours and the icon route is exempt from no-store. Migration `0029`. See ADR 0031. UI-20 later reduced the token base to 24h and button sorting.
- **UI-20** — feedback batch: statistics icons, compact asset card, BSC/ETH contract metadata, series-wide recurring tasks, note file attachments, compact vault, 24h token-base view, trade P/L and sell cap, route loader, swap-preview caching, and native TRON/SOL holdings. Migrations `0030`/`0031`. See ADR 0033.

## Header and wallet

- The header shows the theme switch, owner email, wallet connect/disconnect, and BNB/ETH chain toggles. The global `+ Операция` button and the old `MVP-1 · BSC/Ethereum` status text are gone.
- Wallet state lives in `WalletProvider`; the header, buy/sell drawer, and exchange drawer read the same selected chain. Connecting defaults to BNB and switching requests a wallet network change. Signing still verifies the order chain server-side.
- The operation modal opens from Portfolio `Новая сделка` and from asset actions.

## Finance

- Period presets mirror Статистика; the summary API accepts `from`/`to` or `all=true`.
- Category colors come from a fixed visual palette.

## Token icons

- `assets.logoUrl` is exposed on every asset response. Portfolio, trades, the asset drawer, and token-base cards use the shared `TokenIcon`.
- The token-base edit dialog can upload an icon (128×128, PNG/JPEG/WebP source, compressed data URL) or use a CoinGecko URL. The mutation is audited.
- **UI-6** — navigation grouping and dialog focus. Implemented: Crypto accordion (Dashboard, Portfolio, Operations, Watchlist, Статистика, Vault), Tasks/Notes/Settings below, route-aware expansion, and a focus fix so modal inputs no longer lose focus on parent re-renders.
- **UI-7** — owner feedback pass. Implemented: simplified dashboard with monthly P&L and gas/fees, Статистика period tabs and removed duplicate portfolio/operations blocks, portfolio `Портфель`/`Сделки` tabs with sorting and P&L tints, trade drawer, sequential multi-token close flow with approval/TOTP/tracking/recovery, token base with contract/links/investors, and task list/calendar with drag/drop and recurring occurrences. See ADR 0020 and ADR 0021.
- **UI-8** — owner feedback pass. Implemented: task tags, compressed image attachments stored in Postgres, taller task dialog with autosave (10 s and on close, no Save button), status/priority above the title, one-line description clamp, square BSC/Ethereum chain icons, full-width shell, and the `Открытые` default task filter. See ADR 0022.
- **UI-9** — visual system. Implemented: light/graphite dark themes with a persistent header switcher, refreshed cards/buttons/inputs/navigation, icon-tiled dashboard KPI blocks, compact cash/gas/fee tiles, quality metrics, and a full-width hero equity chart with a 4 px line. See ADR 0023.
- Then the ADR 0014 clean cutover.

## Auth and quick lock

- **UI-53** — the auth pages use the owner-supplied graphite concept: full-screen `#484848`, the 12-ray Nexter logo, Exo font, dark fields and a lime accent. Login, setup, TOTP, recovery and reset keep their existing APIs. The logo lights with input progress and turns red/green on error/success.
- `Заблокировать` sits next to `Выйти` in the desktop sidebar and as an icon in the mobile header. The first use configures a 6-digit PIN; later uses cover the app with an opaque lock screen. The PIN is hashed with PBKDF2 and stored only in the browser; `Настройки → Безопасность` can change/remove it. This is a privacy screen, not a replacement for password + 2FA. See ADR 0044.

## Finance arithmetic, metric surfaces and portfolio rates

- **UI-54** — finance amount fields evaluate small arithmetic expressions safely on blur/Enter; dashboard, Finance, Statistics and portfolio metrics share the same tinted surfaces in light and dark themes; the sidebar uses the 12-ray brand; auth is reduced to the minimal logo/fields layout. Portfolio token rows show current price, 24h change and an invested-share bar. The buy drawer has a custom stablecoin selector with on-chain wallet balances. The monthly realized P&L bar chart was rebuilt with gradients, grid, hover and tooltip. See ADR 0045.

## Unified selects and header clock

- **UI-55** — every `Select` uses the custom dropdown, dashboard metric boxes are transparent over their gradient parents, auth/lock accents use emerald, the header shows a live date and clock, and the PIN screen unlocks automatically after the sixth digit. See ADR 0046.

## Robot uptime and modal system

- **UI-56** — robot start resets the live uptime counter; bot cards use tone surfaces; equity lines are thinner; bot trades/events paginate 10 rows at a time; a per-token completed-trade summary endpoint feeds a new bot drawer section. Modals now have fixed footers and consistent 24 px padding, read-only actions say `Готово`, and delete actions are full danger buttons on the left. The portfolio asset drawer gains a chart from `watchlistId`, drops lots/transactions, renders richer orders and colored metrics, and keeps the base drawer open while buying. The separate full asset page is removed. See ADR 0047.

## Robot polish and internal confirmations

- **UI-57** — robot tokens come from the default `Основная` watchlist group; custom bot icons use migration `0040` and fall back to the strategy icon; removing a token keeps its open position managed exit-only; uptime reads `2 д 1 ч` / `5 мин 7 с`; the equity chart matches the portfolio chart with ranges and downsampling; bot/asset journals and orders show 10 rows with centered `Ещё`; closed orders open `/trades/$tradeId`. All browser confirmations were replaced by the internal `ConfirmProvider`. See ADR 0048.

## Equity ranges and active orders

- **UI-58** — bot equity ranges 7d/30d/1y no longer 500; the portfolio asset drawer lists only active orders; clicking a card opens the sell/close drawer, and the labels clarify cost/quantity/buy/sell; the bot journal is a table. See `docs/decisions.md`.

## Unified trade and operation modals

- **UI-59** — buy only from the main token list; sell/close from orders or the asset drawer; both order modals have `Ончейн`/`Вручную` tabs and fixed footer actions; operations has four manual tabs. See ADR 0049.

## Readable amounts and swap provider limits

- **UI-60** — token quantities no longer show raw 18-decimal tails; USD stays two-decimal and prices keep precision. Kyber 429s are not retried, route calls are throttled, previews are cached/polled less, and provider errors are specific with retry/manual actions. See ADR 0050.

## Server-side trade policy

- **UI-61/W1** — manual buys are server-restricted to the default `Основная` watchlist group; manual sells require an owned open order and cannot exceed its remaining amount. New `TRADE_*` errors surface in the UI. See ADR 0051.

## System status

- **UI-61/W3** — `Настройки → Система` shows quote freshness, bot ticks, swap accounting/stuck states, provider error rates, snapshots, reconciliation and indexer state. Owner-only, read-only, 30s refresh. See ADR 0052.

## Data quality

- **UI-61/W4** — `Настройки → Качество данных` shows grouped read-only checks with severity, count, samples and links, plus a manual re-check. No automatic ledger corrections. See ADR 0053.

## Trade intent metadata

- **UI-61/W5A** — manual and on-chain audit entries now share `intentId`, `channel`, `kind` and `tradeSource`; no schema or execution change. See ADR 0054.

## Owner remarks UI-62

- **Testing** — the standalone `/testing` page is removed. Bot create/edit opens a wider backtest drawer beside the bot drawer with the current strategy, token, params and protective-exit flags prefilled. Strategy cards use the same drawer.
- **Strategies** — add `trailing_stop` (`Трейлинг-стоп`): breakout entry, hard stop before activation, then a peak-based trailing exit.
- **Tasks** — due time is entered with hour/minute selects and `09:00`/`12:00`/`18:00` presets instead of the native time control.
- **Portfolio** — `Средний курс` shows the percent difference between the current market price and the break-even rate.
- **Settings** — new `Интерфейс и поведение` page groups theme, wallet chain and the idle auto-lock timeout (default 5 minutes).
- **Header** — the chain toggle tooltip and settings copy now state that it selects the wallet/execution network and does not filter the portfolio.
- **Backtests** — insufficient or unavailable historical data has dedicated `BACKTEST_*` messages.

## UI-63 robot journal and calendar polish

- The bot backtest drawer uses the same width as the bot form and a single-column layout.
- Calendar tasks with an explicit time show a small time badge before the title; timed tasks sort before all-day tasks.
- Viber task reminders are reduced to `⏰ <task title>`.
- The bot drawer `Телеметрия` action builds a schema-v1 telemetry JSON for a bot/period and downloads it for external AI analysis. It includes bot/strategy config, tokens and latest signals, positions, trades with signal snapshots, events, equity and downsampled quote samples.

## UI-64 settings cards and bot telemetry placement

- Settings hub cards use the strategy-card pattern with per-section icons.
- Bot cooldown applies after any trade, including stop-loss and take-profit exits.
- Telemetry is opened from `Телеметрия` inside the bot drawer; deleting a bot purges its telemetry source data and keeps only an archived parent row.

## UI-65 AI settings and audio notes

- `Настройки → ИИ`: DeepSeek key (masked), enable toggle, model, reasoning mode, temperature, max tokens, raw fallback and connection test.
- Viber audio files are transcribed locally and saved as notes with an AI summary/structure; the original audio is attached and playable/downloadable in the notes drawer.

## UI-66 buttons, bot testing and task calendar

- Primary/danger buttons are pale emerald/red with colored text; icons have a consistent gap.
- Bot footer keeps Delete, Close positions, Start/Stop, Test, Telemetry and Edit; Reset and Done were removed, and Test works for running bots.
- Task calendar renders all tasks and stretches each week row to its busiest day.
- Task time is explicit: 12:00 can be a real deadline; recurrence is editable for one-off tasks and converts them to a series.

## UI-67 trading page tabs and blocks

- Historical UI-67: five tabs `Портфель`, `Ручной`, `Сделки`, `Роботы`, `Стратегии`; replaced by the seven-tab UI-69 workspace.
- `Портфель` keeps the four summary cards and consolidated token blocks and adds an `Активные сделки` section. Active trade blocks emphasize `Результат`, `Доходность` and `Обновление`; average price, invested remaining cost, days and opened date are muted/right-aligned. Source, closed and sale columns are removed from active blocks.
- `Ручной` is the former main list: clickable token blocks with price/24h, interactive 3-month weekly chart, 7d/30d/1y changes, market cap and `Купить`.
- `Сделки` is the full journal with the existing views/filters and block layout; portfolio active blocks open the read-only asset drawer, while the journal keeps the sell/detail path.
- Hash compatibility: `#trades`/`#orders` -> `Ручной`, `#deals`/`#journal` -> `Сделки`. See ADR 0066.

## UI-68 logout, finance averages and task defaults

- Sidebar `Выйти` uses a dark-adapted pale-red danger treatment; mobile `Выйти` uses the standard danger variant.
- `Финансы → Обзор` adds `Средний расход в день` and `Средний доход в день` for the selected period.
- Switching Tasks from `Календарь` back to `Список` resets the filter to `Открытые`.

## UI-69 unified Crypto workspace

- One `Крипта` sidebar/mobile link; `/portfolio` is the canonical page with seven tabs: `Обзор`, `Токены`, `Ордера`, `Операции`, `Роботы`, `Стратегии`, `Статистика`.
- `Обзор` keeps the summary cards, consolidated token blocks and active trade blocks, and moves the former `Ручной` main token list to the bottom.
- `Токены` is the token base, `Ордера` the full journal, `Операции` the operations journal, `Роботы`/`Стратегии` the paper-bot pages, and `Статистика` the reports page.
- `/operations`, `/watchlist` and `/statistics` render the same shell with their tab; tab switches canonicalize to `/portfolio#<tab>`. Embedded pages use compact section headers.
- See ADR 0067. No migration.

## UI-70 token charts and section cleanup

- `Токены` reuses the `TokenBlock` from the main list for every token, without `Купить`. Charts are cached for a day and fall back to manual price history.
- The active crypto tab is the page heading; descriptions and the old `База токенов` heading are removed.
- `Обзор` no longer includes active trades.
- `Операции` uses colored block rows instead of the wide grey table.
- `Статистика` removes the timezone/export row and defaults to all time.
