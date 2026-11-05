# Phase 10 — On-chain Reconciliation Report

Date: 2026-11-05

Status: **implementation in progress; live reconciliation acceptance pending.**

## Scope

- Watch-only wallet addresses per chain (no signing material).
- ERC-20 and native-transfer indexer with a bounded, resumable cursor.
- Raw gas backfill for confirmed swap orders.
- Ledger-vs-on-chain reconciliation runs with persisted items and summaries.
- Backend/API only; the reconciliation UI is deferred.

## Implementation

- Migration `0014` adds `watched_addresses`, `indexed_transfers`, `reconciliation_runs`, and `reconciliation_items`; migration `0015` backfills the verified contract addresses/decimals for seeded BSC/Ethereum assets. Additive only.
- `ensureForSwapToken` repairs an existing non-native asset with a missing contract address, so registry assets are reconcilable. `watched_addresses` is unique per `(user, chain, address)`. Addresses can be added explicitly via `POST /reconciliation/addresses` and are idempotently seeded from swap-order wallet addresses during a run.
- `OnchainIndexerService` scans ERC-20 `Transfer` logs and native transfers for enabled addresses, with a Postgres advisory lock, a configurable lookback, and a bounded block range per tick. Rows are idempotent by `event_key`; the cursor is `watched_addresses.last_indexed_block`.
- `ReconciliationService` compares the aggregate ledger balance of wallet accounts for a chain with the sum of on-chain balances across enabled watched addresses. Items are `MATCH`, `MISMATCH`, `MISSING_ONCHAIN`, `MISSING_LEDGER`, or `UNSUPPORTED` (`delta = ledger − on-chain`); runs persist summaries and never edit the ledger or swap orders. A non-native asset without a contract address is reported as `UNSUPPORTED`; if it has a ledger balance, the item carries that balance and the run completes with an explicit exception rather than a partial clean match.
- Gas backfill fills `swap_orders.network_fee_wei` from the receipt for already-accounted confirmed orders where it is missing, with an audit event. It does not invent USD values or rewrite accounting.
- API:
  - `GET /reconciliation/addresses`
  - `POST /reconciliation/addresses`
  - `GET /reconciliation/runs`
  - `GET /reconciliation/runs/:id`
  - `POST /reconciliation/run`
  - `GET /reconciliation/indexer`

## Configuration

- `RECONCILIATION_ENABLED` (default false)
- `RECONCILIATION_INDEX_INTERVAL_SECONDS` (default 60)
- `RECONCILIATION_LOOKBACK_BLOCKS` (default 100)
- `RECONCILIATION_MAX_BLOCKS_PER_TICK` (default 50)
- `RECONCILIATION_STALE_RUN_SECONDS` (default 3600)

## Verification

- Migrations `0014` and `0015` apply cleanly to the disposable PostgreSQL database.
- API tests cover watch-only native reconciliation (`MATCH`), seeded ERC-20 reconciliation (`USDC MATCH` with a clean item set), unsupported ledger assets (`UNSUPPORTED`), and ERC-20/native indexing with cursor advancement.
- Full suite: **139 passed, 1 skipped**; typecheck/lint/format/build pass.
- Live reconciliation: pending owner approval to add the production wallet and run `POST /reconciliation/run` on BSC and Ethereum.

## Acceptance

For each chain, a reconciliation run must complete and all non-zero assets must be `MATCH` (or a documented, owner-approved exception). A mismatch is not auto-corrected; it is investigated and corrected with a new append-only ledger transaction.

## Residuals

- Reconciliation UI and scheduled reports.
- Automatic discovery/validation of arbitrary ERC-20 tokens held by watched addresses.
- Historical indexing from genesis (current indexer starts from the configured lookback).
- Indexer reorg rewinds/parent-hash checks; reconciliation itself uses live balances, so transfer history can lag after a reorg.
- Automated post-accounting reorg compensation and manual attach-hash recovery.
- Gas backfill for non-swap/imported transactions.
