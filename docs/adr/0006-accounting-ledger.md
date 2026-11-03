# ADR 0006 — Accounting ledger schema and FIFO model

## Status

Accepted for Phase 3.

## Context

Phase 2 established authentication and security. Phase 3 adds the append-only accounting core: accounts, assets, transactions, postings, trade groups, lots, and manual prices. The schema must support the invariants in `docs/specs/accounting-spec.md` without introducing swap or import logic yet.

## Decision

### Reference data

- `chains` stores `bsc` and `ethereum`; BSC is the primary chain.
- `assets` are per chain (`chain_id`, `symbol` unique). This lets the same ticker have different decimals on BSC and Ethereum.
- Seed assets: BSC — USDC, XNY, BASED, APR, POP, LINK, BNB; Ethereum — USDC, LINK, BASED, APR, ETH.
- USDC is a stablecoin and a cash equivalent on both chains. Contract addresses are intentionally left unset until the token registry phase; unknown token decimals default to 18 and can be corrected before import.

### Accounts

- `accounts` belong to a user and have a type: `wallet`, `external`, `income`, `expense`, `equity`.
- Every user receives system accounts `External`, `Income`, `Expense`, `Equity`, plus wallet accounts `Tangem BSC` and `Tangem Ethereum`.
- Wallet accounts are the only accounts that must never have a negative asset balance. System accounts are reporting/counterparty accounts and may be negative.
- Account names are unique per user, which makes bootstrap idempotent.

### Ledger

- `transactions` is append-only and has `type`, `source`, optional `source_id`, `occurred_at`, and optional `trade_group_id`.
- `postings` are signed decimal amounts (`numeric(36,18)`) and signed USD values (`numeric(24,8)`). Money is never stored as a JS number.
- For every transaction and asset, `sum(postings.amount) = 0`.
- Negative wallet balances are rejected before insert.
- `source_id` is unique per user/source when present, preparing idempotent imports.
- Deletes are not exposed. Corrections must be new `adjustment` transactions.

### Trade groups and lots

- A `trade_group` represents a user-facing trade/round trip. Manual buys create a group; sells consume global FIFO lots and update group status.
- `lots` are global per asset, not per account. Acquisitions create lots; disposals consume oldest lots first.
- `lot_consumptions` records amount, cost basis, proceeds, and realized P&L per consumed lot. Withdrawals reduce lots with zero realized P&L.
- Stablecoins do not create lots; their balances are tracked by postings.
- Gas is posted as a movement of the gas asset. By default it is included in acquisition cost basis and deducted from sale proceeds according to `settings.include_gas_in_cost_basis`.
- Execution cost is informational only and is never subtracted twice.

### Prices and reporting

- Phase 3 uses manual prices in `prices` (`source = manual`). No third-party price API is added in this phase.
- Positions and dashboard summaries are derived from postings, lots, and the latest manual price.
- Equity = cash equivalents + positions at the latest price.
- Net deposits = deposits − withdrawals; total P&L = realized disposals + unrealized + income.
- Income is reported separately (`incomeUsd`) so equity − net deposits reconciles with total P&L; the disposal formula `realized = proceeds − cost basis − fees` is unchanged.

### Deferred

- Portfolio snapshots, watchlist, imports, swaps, on-chain reconciliation, and price providers are later phases.
- Token contract addresses, verified decimals, and CoinGecko IDs can be filled by the import/token-registry phases.

## Consequences

- The ledger is auditable and append-only from the start.
- Global FIFO keeps the MVP simple; per-account lots can be added later without changing postings.
- Manual prices mean unrealized P&L is only available after the owner enters prices; missing prices are returned as `null`, not invented.
- Unknown token decimals are a known data-quality flag until the token registry is populated.
