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

- Migration `0014` adds `watched_addresses`, `indexed_transfers`, `reconciliation_runs`, and `reconciliation_items`; additive only.
- `watched_addresses` is unique per `(user, chain, address)`. Addresses can be added explicitly via `POST /reconciliation/addresses` and are idempotently seeded from swap-order wallet addresses during a run.
- `OnchainIndexerService` scans ERC-20 `Transfer` logs and native transfers for enabled addresses, with a Postgres advisory lock, a configurable lookback, and a bounded block range per tick. Rows are idempotent by `event_key`; the cursor is `watched_addresses.last_indexed_block`.
- `ReconciliationService` compares the aggregate ledger balance of wallet accounts for a chain with the sum of on-chain balances across enabled watched addresses. Items are `MATCH`, `MISMATCH`, `MISSING_ONCHAIN`, or `MISSING_LEDGER` (`delta = ledger − on-chain`); runs persist summaries and never edit the ledger or swap orders. Assets without a contract address that are not the chain native asset are reported as unsupported rather than treated as native.
- Gas backfill fills `swap_orders.network_fee_wei` from the receipt for confirmed orders where it is missing, with an audit event. It does not invent USD values or rewrite accounting.
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

## Verification

- Migration `0014` applies cleanly to the disposable PostgreSQL database.
- API tests cover watch-only native reconciliation (`MATCH`) and ERC-20/native indexing with cursor advancement.
- Full suite: **136 passed, 1 skipped**; typecheck/lint/format/build pass.
- Live reconciliation: pending owner approval to add the production wallet and run `POST /reconciliation/run` on BSC and Ethereum.

## Acceptance

For each chain, a reconciliation run must complete and all non-zero assets must be `MATCH` (or a documented, owner-approved exception). A mismatch is not auto-corrected; it is investigated and corrected with a new append-only ledger transaction.

## Residuals

- Reconciliation UI and scheduled reports.
- Automatic discovery/validation of arbitrary ERC-20 tokens held by watched addresses.
- Historical indexing from genesis (current indexer starts from the configured lookback).
- Automated post-accounting reorg compensation and manual attach-hash recovery.
- Gas backfill for non-swap/imported transactions.
