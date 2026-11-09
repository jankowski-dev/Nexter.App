# UI redesign — target information architecture

Status: **UI-0 through UI-5 implemented.** Owner-approved direction on 2026-11-08. Russian light theme, USD base currency, no third-party analytics or trackers.

## Goals

- Reduce the number of steps for the core workflow: open/close a trade, exchange assets, record a deposit/withdrawal.
- Merge portfolio and trade management into one workspace.
- Make the dashboard a decision screen, not a wall of cards.
- Add user-defined watchlist groups and contract-address token discovery.
- Keep every swap security gate: allowlists, calldata verification, exact approvals, step-up TOTP above $500, kill switch, WalletConnect signing. UI automation may reduce quote/build clicks, but never signs automatically.

## Final navigation

| Item       | Contents                                                                       |
| ---------- | ------------------------------------------------------------------------------ |
| Dashboard  | Capital, P&L, profit factor, cash, gas, active positions, interactive charts   |
| Portfolio  | Asset strip/table, side drawer per asset, trade journal below                  |
| Operations | Deposits, withdrawals, exchanges; no trades                                    |
| Watchlist  | User-created groups, contract-address token search, token cards                |
| Reports    | P&L, trade statistics, operations, fees/gas, exports                           |
| Vault      | E2E-encrypted passwords and access notes                                       |
| Tasks      | Personal tasks, priorities, due dates                                          |
| Notes      | Free-form notes, tags, pinning                                                 |
| Settings   | Existing settings, security, accounts, audit, data quality; legacy import link |

- No separate **Trades** entry. `/trades` redirects to Portfolio; `/trades/$tradeId` remains the detail route.
- No separate **Swap** entry. The swap flow is embedded in the trade/exchange modal; `/swap` redirects to `/portfolio`.
- Phase 11 adds **Vault**, **Tasks**, and **Notes** after Reports. The vault is end-to-end encrypted in the browser; tasks and notes are plaintext owner-only modules.
- UI-6 groups Dashboard, Portfolio, Operations, Watchlist, Reports, and Vault under a top-level **Crypto** accordion. Tasks, Notes, and Settings are top-level items; Crypto opens on click/expand and stays highlighted when collapsed.
- Import is legacy under Settings until the clean cutover; it is not part of the go-live path.

## Portfolio

- Summary cards: cash, positions value, equity, position count.
- Asset table: quantity, price, average price, value, cost basis, unrealized P&L, share.
- Clicking an asset opens a right-side drawer with lots, trade groups, transactions, thesis/tags, and a link to the full asset card.
- Below the assets: trade journal with the existing position/activity tabs and filters.
- "New trade" opens the trade modal; UI-0 temporarily reuses the manual-entry dialog.

## Trade / exchange modal (UI-1)

One modal with four modes:

```text
[ Trade ] [ Exchange ] [ Deposit ] [ Withdrawal ]

Entry / Exit
From: USDT [balance]  ->  To: TOKEN [selector]
Amount: [ ... ] [Max]       approx. $...
```

- Quote is fetched automatically after a debounced amount change. There is no separate "get quote" button.
- Two explicit execution paths: **record manually** or **execute on-chain**.
- On-chain path: auto-build after "Continue", inline approval if needed, WalletConnect signature, tracking, accounting. Step-up TOTP and calldata verification stay mandatory.
- Manual path: compact price/fee/date/account/note fields, no wallet interaction.
- Never create a manual ledger row and an on-chain accounting row for the same action.

### Closing positions

- A swap order may carry `closeGroupIds: string[]` (single, multiple, or all open groups for a token).
- Accounting consumes lots only from the selected groups (FIFO inside the selection), allocates proceeds proportionally, and refreshes each group to `closed`/`partial`.
- Validate ownership, asset, open status, and remaining amount at build/sign; fail closed if anything changed.
- Partial close of one group is a later extension (`closeLegs: [{ tradeGroupId, amount }]`).

### Exchange semantics

- A crypto-to-crypto exchange is an **operation**, not a trade group. It appears in Operations, not in the trade journal.
- The source lot is consumed and realized P&L is recognized; the destination lot is created without a trade group. This preserves ledger correctness without presenting the exchange as a trade.
- A pure cost-basis transfer without P&L is a different accounting policy and requires explicit owner approval; do not implement it implicitly.

## Dashboard / reports

Required metrics beyond the current dashboard:

- Profit factor: gross realized profit / absolute gross realized loss (formula shown in a tooltip).
- Gross positive/negative unrealized P&L.
- Win/loss parity: winning vs losing closed trades in absolute USD.
- Free cash outside positions, split by cash asset (USDT/USDC).
- Gas paid from confirmed swap network fees; manual/imported gas remains unknown.
- Daily portfolio snapshots after the clean cutover; historical points before the cutover stay approximate.
- Interactive chart hover with date/value.

Reports adds period filters, trade statistics, operations, fees/gas, asset breakdowns, and CSV export. No tax calculations.

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
6. Reports aggregation and export endpoints.

## Delivery order

- **UI-0** — shell, navigation, Portfolio + trade journal merge, asset drawer, Operations/Reports pages, Import legacy link. No backend changes. Implemented.
- **UI-1** — unified trade/exchange modal, transactions, `closeGroupIds` backend. Implemented: the global “+ Операция” and the Portfolio “Новая сделка” use the same modal with Trade, Exchange, Deposit, and Withdrawal tabs; manual recording, embedded on-chain execution, and one/several/all open-group selection. Income and adjustment live under “Дополнительно” to avoid a tab pile. Internal transfer was removed from the UI because the owner does not send crypto to third parties and the current setup has one wallet per chain; the backend transfer endpoint remains for a future multi-wallet flow. The legacy manual dialog was removed.
- **UI-2** — dashboard metrics and interactive charts, daily snapshots. Implemented: profit factor, gross profit/loss, win rate, positive/negative unrealized, cash by asset, gas paid, daily snapshot capture, snapshot-backed equity curve, and hover tooltips on line/bar charts.
- **UI-3** — watchlist groups, contract-address search, market data. Implemented: user-created groups with a default group, group moves, contract-address search with on-chain metadata, CoinGecko price/icon enrichment, server-side icon proxy, and watchlist cards with prices.
- **UI-4** — reports/statistics. Implemented: period presets and custom dates, realized P&L and trade statistics, fees/gas, cash-flow summary, monthly detail, per-asset realized results, operation counts, period-scoped transaction export, and current portfolio/allocation/equity charts. No tax calculations.
- **UI-5** — remove the hidden legacy swap route from the go-live path, E2E, responsive polish. Implemented: `/swap` redirects to `/portfolio`; the swap panel is embedded-only inside the trade/exchange modal; unused standalone swap history was removed; mobile navigation and dialogs are covered by E2E. The legacy Notion import remains under Settings until the clean cutover.
- **UI-6** — navigation grouping and dialog focus. Implemented: Crypto accordion (Dashboard, Portfolio, Operations, Watchlist, Reports, Vault), Tasks/Notes/Settings below, route-aware expansion, and a focus fix so modal inputs no longer lose focus on parent re-renders.
- **UI-7** — owner feedback pass. Implemented: simplified dashboard with monthly P&L and gas/fees, reports period tabs and removed duplicate portfolio/operations blocks, portfolio `Портфель`/`Сделки` tabs with sorting and P&L tints, trade drawer, sequential multi-token close flow with approval/TOTP/tracking/recovery, token base with contract/links/investors, and task list/calendar with drag/drop and recurring occurrences. See ADR 0020 and ADR 0021.
- **UI-8** — owner feedback pass. Implemented: task tags, compressed image attachments stored in Postgres, taller task dialog with autosave (10 s and on close, no Save button), status/priority above the title, one-line description clamp, square BSC/Ethereum chain icons, full-width shell, and the `Открытые` default task filter. See ADR 0022.
- **UI-9** — visual system. Implemented: light/graphite dark themes with a persistent header switcher, refreshed cards/buttons/inputs/navigation, icon-tiled dashboard KPI blocks, compact cash/gas/fee tiles, quality metrics, and a full-width hero equity chart with a 4 px line. See ADR 0023.
- Then the ADR 0014 clean cutover.
