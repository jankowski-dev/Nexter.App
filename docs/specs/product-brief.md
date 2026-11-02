# Product Brief

## Product

Nexter is a private, single-user, modular personal finance application. It replaces a slow and fragile Notion-based crypto accounting system and later adds safe non-custodial DEX swaps, passwords, tasks, and notes.

## User

- One person, tax residence Belarus.
- Accounting currency USD; BYN is optional and deferred.
- Tangem cold wallet via WalletConnect.
- Networks: BNB Smart Chain (BSC) first, Ethereum second.
- Manual DEX trading through KyberSwap.

## Problem

- Notion recalculates a large formula/rollup graph and is slow.
- Accounting logic is mixed with presentation and is hard to audit.
- DEX swaps are manual and error-prone.
- Historical data is hard to reconcile.
- The owner is concerned about data leakage and unauthorized access.

## MVP-1 — Accounting

- Single-user auth with TOTP, recovery codes, sessions, audit log.
- Assets, accounts, trades, transfers, deposits, withdrawals, fees, income, adjustments.
- Append-only ledger with postings and FIFO lots.
- Global FIFO per asset; stablecoins are cash equivalents.
- Notion import with dry-run, reconciliation, and commit.
- Dashboard, portfolio, trades, watchlist, settings, data quality, export.

## MVP-2 — Swaps

- KyberSwap on BSC, then Ethereum.
- Non-custodial Tangem signing via WalletConnect.
- Quote → build → validate → simulate → sign → submit → track.
- Automatic recording of the trade, gas, and P&L.
- Step-up TOTP above $500.
- Kill switch.

## Non-goals

- Multi-user.
- Mobile app.
- Automated trading without confirmation.
- Non-EVM DEX execution.
- Passwords, tasks, notes before MVP-4.
- Legally guaranteed tax filing.

## Success criteria

- Notion import reconciles 429 orders and the control sums.
- Dashboard responds under 1 second on current data.
- No private keys on the server.
- Every mutation is audited.
- Every swap has a tx hash, status, gas, and ledger entry.
- Zero critical security findings before real swaps.
