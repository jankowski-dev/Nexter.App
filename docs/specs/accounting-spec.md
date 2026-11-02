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
- Stablecoins (USDT/USDC) are cash equivalents: no lots, depeg flag.
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
