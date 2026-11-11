# UI redesign — target information architecture

Status: **UI-0 through UI-13 implemented.** Owner-approved direction on 2026-11-08, latest feedback batch on 2026-11-11. Russian light theme by default, USD base currency for crypto, no third-party analytics or trackers.

## Goals

- Reduce the number of steps for the core workflow: open/close a trade, exchange assets, record a deposit/withdrawal.
- Merge portfolio and trade management into one workspace.
- Make the dashboard a decision screen, not a wall of cards.
- Add user-defined watchlist groups and contract-address token discovery.
- Keep every swap security gate: allowlists, calldata verification, exact approvals, step-up TOTP above $500, kill switch, WalletConnect signing. UI automation may reduce quote/build clicks, but never signs automatically.

## Final navigation

| Item       | Contents                                                                       |
| ---------- | ------------------------------------------------------------------------------ |
| Dashboard  | Combined crypto/finance summary, today's tasks, habit streaks                  |
| Portfolio  | Positions, Основной список with buy actions, trade journal                     |
| Operations | Deposits, withdrawals, exchanges; no trades                                    |
| Watchlist  | User-created groups, contract-address token search, token cards                |
| Статистика | Detailed crypto P&L, trade statistics, operations, fees/gas, exports           |
| Finance    | Personal BYN accounts, operations, transfers and period overview               |
| Vault      | Separate top-level service: E2E-encrypted passwords and access notes           |
| Tasks      | Personal tasks, priorities, due dates, calendar/list journals                  |
| Notes      | Journal-style notes, tags, photos, pinning                                     |
| Settings   | Existing settings, security, accounts, audit, data quality; legacy import link |

- No separate **Trades** entry. `/trades` redirects to Portfolio; `/trades/$tradeId` remains the detail route.
- No separate **Swap** entry. Buy/sell runs in the token trade drawer; on-chain exchange runs in the Operations exchange drawer. `/swap` redirects to `/portfolio`.
- Phase 11 adds **Vault**, **Tasks**, and **Notes**. The vault is end-to-end encrypted in the browser; tasks and notes are plaintext owner-only modules.
- UI-6 groups Dashboard, Portfolio, Operations, Watchlist, and Статистика under a top-level **Crypto** accordion. UI-10 moves **Vault** out of that accordion: it is a separate top-level service, together with Finance, Tasks, Notes, and Settings. Crypto opens on click/expand and stays highlighted when collapsed.
- Import is legacy under Settings until the clean cutover; it is not part of the go-live path.

## Portfolio

- Tabs: `Портфель`, `Основной список`, `Сделки`.
- Summary cards: cash, positions value, equity, position count.
- Asset table: quantity, price, average price, value, cost basis, unrealized P&L, share.
- Clicking an asset opens a right-side drawer with lots, trade groups, transactions, thesis/tags, and a link to the full asset card.
- `Основной список` shows the default `Основная` watchlist group with icon, CoinGecko price, 24h move, existing position, value, and `Купить`. Tokens outside the on-chain allowlist offer only manual entry.
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
