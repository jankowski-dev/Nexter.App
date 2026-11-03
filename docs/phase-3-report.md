# Phase 3 — Accounting Core Report

Date: 2026-11-03

Status: implemented, pending independent review

## Scope completed

- Accounting schema: `chains`, `assets`, `accounts`, `transactions`, `postings`, `trade_groups`, `trade_details`, `lots`, `lot_consumptions`, `prices`.
- Migration `0005_cute_agent_brand.sql` plus seed chains and per-chain assets.
- ADR `0006-accounting-ledger.md`.
- Idempotent account bootstrap: `External`, `Income`, `Expense`, `Equity`, `Tangem BSC`, `Tangem Ethereum`.
- Append-only manual transaction API:
  - buy, sell, swap, transfer, deposit, withdrawal, income, adjustment;
  - signed postings with per-asset balance validation;
  - negative wallet balances rejected before insert;
  - all ledger writes and audit in one transaction.
- Global FIFO per asset:
  - lots created for acquisitions;
  - oldest lots consumed first;
  - partial cost-basis allocation;
  - stablecoins excluded from lots;
  - withdrawals reduce lots without realized P&L;
  - gas/fee asset movements consume lots without double-counting.
- Trade groups and lots linked to acquisitions; group status updates after disposals.
- Manual prices API and latest-price lookup.
- Positions and dashboard summary:
  - cash equivalents, positions, cost basis, market value;
  - realized, unrealized, income, total P&L;
  - missing-price reporting.
- Assets, accounts, transactions, positions, prices, and dashboard endpoints protected by the Phase 2 auth/2FA guards.
- Property-based FIFO allocator tests with `fast-check`.
- Accounting e2e covering buy/sell/swap/transfer/income and negative-balance rejection.

## Verification

- `pnpm typecheck`, `pnpm lint`, `pnpm format:check` pass.
- API tests: 33 pass with PostgreSQL, including accounting e2e and FIFO property tests.
- Accounting e2e:
  - deposit USDC and BNB;
  - buy LINK with USDC and BNB gas;
  - verify balanced postings per asset;
  - set manual prices;
  - partial sell consumes FIFO and realizes P&L;
  - token-to-token swap creates an outbound lot and consumes the inbound lot;
  - transfer does not change global lots;
  - income creates a lot and is included in total P&L;
  - dashboard reconciles `equity − netDeposits = totalPnl`;
  - negative wallet balance returns `400 NEGATIVE_BALANCE` without creating a transaction.
- Fresh migration applies all migrations and seeds chains/assets.
- `pnpm build` and `pnpm smoke:static` pass locally.

## Known limitations

- No manual-entry UI yet; Phase 5 owns the UI.
- No trade-group list/detail/reverse endpoints yet; Phase 5/6.
- No transaction reversal endpoint yet; adjustments are positive additions in MVP-1.
- No external price provider; prices are manual in Phase 3.
- Unknown token decimals default to 18 and are marked unverified until the token registry phase.
- Portfolio snapshots, watchlist, imports, swaps, and on-chain reconciliation are later phases.
- Income treatment is documented in ADR 0006; total P&L includes income separately from disposal realized P&L.

## Next phase

Phase 4 — Notion import, after Phase 3 review.
