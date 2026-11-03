# Phase 3 — Accounting Core Report

Date: 2026-11-03

Status: **accepted** after three independent reviews.

## Scope completed

- Accounting schema: `chains`, `assets`, `accounts`, `transactions`, `postings`, `trade_groups`, `trade_details`, `lots`, `lot_consumptions`, `prices`.
- Migrations `0005_cute_agent_brand.sql` (accounting schema and seed data) and `0006_cold_captain_midlands.sql` (`transactions.fees_usd`, USDT seeds).
- ADR `0006-accounting-ledger.md`.
- Idempotent account bootstrap: `External`, `Income`, `Expense`, `Equity`, `Tangem BSC`, `Tangem Ethereum`.
- Append-only manual transaction API:
  - buy, sell, swap, transfer, deposit, withdrawal, income, adjustment;
  - signed postings with per-asset balance validation;
  - negative wallet balances rejected before insert under a per-user advisory lock;
  - asset decimals and wallet/asset chain consistency validated;
  - manual POSTs support `Idempotency-Key` replay;
  - all manual ledger writes and their audit in one transaction (account bootstrap is a separate audited system path);
  - adjustment reasons persisted in notes and audit.
- Global FIFO per asset:
  - lots created for acquisitions;
  - oldest lots consumed first;
  - partial cost-basis allocation;
  - stablecoins excluded from lots;
  - withdrawals of non-cash assets realize P&L at the provided USD value;
  - positive adjustments are reported in `adjustmentsUsd` and included in total P&L;
  - non-capitalized fees are reported in `feesUsd` and subtracted from total P&L;
  - transfer and swap-to-cash fees are covered by reconciliation tests.
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
- API tests: 37 pass with PostgreSQL, including accounting e2e and FIFO property tests.
- Accounting e2e:
  - deposit USDC and BNB;
  - buy LINK with USDC and BNB gas;
  - verify balanced postings per asset;
  - set manual prices;
  - partial sell consumes FIFO and realizes P&L;
  - token-to-token swap creates an outbound lot and consumes the inbound lot;
  - transfer does not change global lots;
  - income creates a lot and is included in total P&L;
  - withdrawals, adjustments, transfer fees and swap-to-cash fees reconcile `equity − netDeposits = totalPnl`;
  - concurrent cash spends are serialized and cannot produce a negative balance;
  - asset decimals, chain consistency and zero-USD inputs are rejected;
  - `Idempotency-Key` replays do not create duplicate transactions;
  - generated buy/sell sequences keep lots equal to balances;
  - dashboard reconciles `equity − netDeposits = totalPnl`;
  - negative wallet balance returns `400 NEGATIVE_BALANCE` without creating a transaction.
- Fresh migration applies all migrations and seeds chains/assets.
- `pnpm build` and `pnpm smoke:static` pass locally.

## Known limitations

- No manual-entry UI yet; Phase 5 owns the UI.
- No trade-group list/detail/reverse endpoints yet; Phase 5/6.
- No transaction reversal endpoint yet; negative adjustments are not supported in MVP-1.
- No external price provider; prices are manual in Phase 3.
- Unknown token decimals default to 18 and are marked unverified until the token registry phase.
- No depeg flag yet; cash equivalents are valued at $1 and explicit cash USD must equal the cash amount.
- Fee USD values must be positive; cash-fee USD must equal the cash fee amount.
- `GET /transactions` is capped at 200 rows and has no cursor pagination yet.
- Portfolio snapshots, watchlist, imports, swaps, and on-chain reconciliation are later phases.
- Income, adjustments and non-capitalized fees are reported separately and included in total P&L as documented in ADR 0006.

## Review history

Independent review returned **FAIL** with:

- High: concurrent cash spends could go negative; withdrawals/adjustments broke equity/P&L reconciliation; transfer and swap-to-cash fees were not recognized; adjustment reasons were discarded.
- Medium: asset decimals/chain consistency, derived USD scale, zero-USD inputs, idempotency, property/e2e coverage, and report accuracy.

All High findings and the actionable Medium findings were fixed. A second review returned **PASS WITH CHANGES** with input-consistency issues; those were fixed by requiring positive fee USD, enforcing cash-equivalent USD = token amount, updating ADR/report claims, and adding fee/cash reconciliation tests. A third review returned **PASS** with no required changes; remaining Low items are listed as follow-ups. See ADR 0006.

## Next phase

Phase 4 — Notion import. See [`docs/phase-4-report.md`](phase-4-report.md).
