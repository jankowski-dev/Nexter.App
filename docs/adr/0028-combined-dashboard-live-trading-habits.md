# ADR 0028 — Combined dashboard, live crypto trading UI, and habits

## Status

Accepted for the crypto/habits feedback batch (2026-11-11).

## Context

The owner asked to merge the crypto and finance summaries into one short dashboard, move detailed crypto statistics to a renamed Statistics page, replace the unified trade/exchange modal with a token-first buy/sell drawer, close only one trade at a time (full or partial), add live price updates, split trade journal tabs, fix manual exchange accounting, show exact tiny prices, make the chain switch obvious, fix token icons, and add a days-without-habits counter.

## Decision

- **Combined dashboard.** `/dashboard` becomes a short overview: crypto month net P&L, positive and negative unrealized P&L, equity; finance average daily income/expense and month income/expense in BYN; today's open tasks (including overdue); and habit streaks. The finance page keeps its own overview unchanged. Detailed crypto statistics live in `Статистика` (`/statistics`, with `/reports` redirecting).
- **Habits.** Migration `0027` adds `habits` (`name`, `started_on`, soft archive). The dashboard form accepts a name and start date; each habit shows inclusive days since the start date, can be edited, reset to today, or soft-archived. All mutations are audited. There is no habit history table; the start date is the streak anchor.
- **Portfolio tabs.** `Портфель` keeps positions, `Основной список` shows the default `Основная` watchlist group with icon, CoinGecko price, 24h move, existing position, value, and `Купить`. The `Сделки` tab contains the trade journal. The mass-selection and multi-group close UI is removed.
- **Buy/sell drawer.** A token-first one-third-width drawer fixes the token from the row. It shows the CoinGecko price, KyberSwap preview, rate difference, quote asset (USDC default; any stablecoin available in the swap allowlist), amount, computed output, gas, price impact, and slippage. KyberSwap preview is refreshed every 10 seconds through `POST /swap/preview`; preview does not persist an order. The actual quote/build/approval/sign/submit flow is automatic behind one button.
- **After a successful buy.** Once the order is confirmed and accounting exists, the drawer loads the new trade group, shows buy price/current price/P&L/remaining, switches to sell mode, and defaults the sell amount to the full remaining amount. A sell from a trade row opens the same drawer in sell mode.
- **Partial close.** Only one trade group can be closed per on-chain order. The requested amount may be less than or equal to the group's remaining amount. `swap_order_close_groups.expected_amount` stores the requested close amount; the order remains valid while the group still has at least that amount. FIFO consumption is restricted to the selected group, so a partial sale leaves the remaining position intact.
- **Manual entry.** `Ручная сделка` is a separate manual buy/sell dialog. Manual operations are a separate dialog for exchange, deposit, withdrawal, income, and adjustment. Deposit records token amount and USD spent; withdrawal records token amount and USD received. Manual exchange computes USD sides from current prices and creates a normal `swap` transaction, so it appears in the `Обмены` journal.
- **On-chain exchange.** A dedicated `ExchangeDrawer` replaces the old multi-step swap panel: token pair, amount, live Kyber preview, CoinGecko rate difference, gas/impact, one `Обменять` action with the same automatic approval/sign/step-up flow.
- **Live data.** Portfolio positions, trade groups, dashboard, and the main list poll every 10–15 seconds; the trade drawer refreshes its trade every 15 seconds. No WebSocket infrastructure is introduced.
- **Price formatting.** `formatPrice` keeps small token prices visible (`0.000083` instead of `0.00`) while rounding normal prices to a readable precision (`0.6788` → `0.679`).
- **Token icons.** The asset contract already exposes `logo_url`; a background backfill service fills missing logos from CoinGecko by `coingeckoId` and, when needed, by contract address. Portfolio, trades, the main list, and the token base use the shared `TokenIcon`; manual uploads remain available.
- **Chain switch.** BNB/ETH become a labeled segmented switch. The active chain is white/raised with a green status dot and a colored chain icon; the inactive chain is grayscale and muted.
- **Trade tabs.** `Активные` (default), `Прибыльные`, `Убыточные`, `Закрытые`. Profitable/losing are subsets of active trades by current total P&L per the owner's choice. The server accepts an additive `view` filter.

## Consequences

- Migration `0027` is additive and conditionally grants DML to `nexter_app`.
- The old unified trade/exchange modal and the mass-close UI are no longer used; the API still preserves multi-group close compatibility for historical orders.
- The buy/sell execution remains WalletConnect/Tangem-only for signing; the server never receives keys or seed phrases.
- Live updates are polling-based. A future WebSocket/SSE layer can replace polling without changing the ledger.
- Habit streaks are anchored to a date, not a full relapse history; editing the date is the reset mechanism.
- Token icon backfill depends on CoinGecko availability. Assets not found by ID or contract continue to show initials until a manual icon is uploaded.
- Partial-close concurrency residual: lots are not reserved while a close order is quoted or signed. If a concurrent manual sale reduces the selected group below the requested amount before the on-chain swap is confirmed, accounting fails closed and the order remains unaccounted for manual follow-up. The normal flow checks the group at quote and build time; reserving lots would require a schema/state change and is deferred.
