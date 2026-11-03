# Accounting Spec

## Principles

- Append-only multi-asset ledger.
- For every transaction and asset, `sum(postings.amount) = 0`.
- Balances and P&L are derived; only events, lots, and snapshots are stored.
- FIFO by default.
- USD is the base currency.
- Corrections are new transactions, never deletes.

## Core entities

`users`, `sessions`, `chains`, `assets`, `accounts`, `transactions`, `postings`, `trade_groups`, `trade_details`, `lots`, `lot_consumptions`, `prices`, `portfolio_snapshots`, `watchlist`, `imports`, `import_rows`, `audit_log`, `settings`.

## Event types

`trade` (buy/sell/swap), `transfer`, `deposit`, `withdrawal`, `fee`, `income`, `adjustment`.

## Cost basis

- Global FIFO per asset for MVP.
- Stablecoins (USDT/USDC) are cash equivalents: no lots; depeg flag is deferred until a later phase.
- Gas is added to acquisition cost basis by default and deducted from sale proceeds; configurable.
- Execution cost = `amount_in_usd - amount_out * reference_price`; informational, already embedded in actual token amounts, never deducted twice.
- `realized_pnl = proceeds_usd - cost_basis_usd - selling_fees_usd`.
- `unrealized_pnl = current_value_usd - remaining_cost_basis_usd`.

## Notion mapping

- `Source` → assets + watchlist; `Символ [P]` → CoinGecko ID.
- `Orders` → trade group + buy transaction + optional sell transaction.
- `Transactions` → deposit/withdrawal.
- `Statistics` → recompute, never import.

Control sums: 429 orders, 410 closed, 19 active, deposits 2519.80, withdrawals 57.00, net 2462.80, buy 54955.30, sell 52508.0139345416, cash 15.513934541602794, equity 2075.937588921603, total P&L -386.86241107839714, realized 69.81393454159962, unrealized -456.67634561999995, ROI -15.70823497963282%, win rate 54.87804878048781%, profit factor 1.0189656366911293.

Imported rows are flagged: `chain_known=false`, `contract_known=false`, `network_fee_included=false`, `reconciled=false`.

## Phase 3 implementation notes

- Seed chains: `bsc`, `ethereum`.
- Seed assets are per chain. BSC: USDC (18), USDT (18), XNY, BASED, APR, POP, LINK, BNB (18). Ethereum: USDC (6), USDT (6), LINK, BASED, APR, ETH (18).
- USDC and USDT are stablecoins and cash equivalents. Unknown token decimals default to 18 and are marked `is_verified = false` until the token registry is populated.
- Default accounts per owner: `External`, `Income`, `Expense`, `Equity`, `Tangem BSC`, `Tangem Ethereum`.
- Manual buys and sells require a cash-equivalent quote/proceeds asset in MVP-1; token-to-token swaps support two non-cash legs.
- Manual prices are stored with `source = manual`; missing prices make position value/unrealized P&L `null` and are listed in `missingPrices`.
- Cash equivalents are valued at $1 in Phase 3; explicit USD for cash legs must equal the token amount. Manual prices for cash equivalents are ignored until a depeg flag is implemented.
- Fee USD values must be positive when a fee is present; for a cash fee asset they must equal the fee amount.
- Income is tracked separately (`incomeUsd`) and included in total P&L, so `equity − netDeposits = totalPnl`; the disposal formula is unchanged.
- Withdrawals of non-cash assets are disposals at the provided USD value and realize P&L; cash withdrawals remain capital flows.
- Positive adjustments are tracked separately (`adjustmentsUsd`), included in total P&L, and their reasons are stored in notes and audit.
- Non-capitalized fees are tracked in `feesUsd` and subtracted from total P&L; capitalized/deducted fees remain in cost basis or realized P&L and are not counted twice.
- Manual writes are serialized per user with a PostgreSQL advisory lock, validate asset decimals and wallet chain consistency, and accept `Idempotency-Key` for safe retries.

## Invariants

1. Per transaction/asset postings sum to zero.
2. Account balance equals sum of postings.
3. No negative asset balances.
4. Lots remaining amount equals position outside cash equivalents.
5. No negative lots or cost basis.
6. Realized P&L equals sum of disposals.
7. Equity = cash + positions at market.
8. Equity − net deposits = total P&L within visible tolerance.
9. Imports are idempotent by `(source, source_id)`.
10. Every mutation is audited.
