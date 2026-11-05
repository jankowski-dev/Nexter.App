# ADR 0013 — Phase 10 on-chain reconciliation

## Status

In progress. Implementation and local verification; live reconciliation acceptance pending.

## Context

Phase 9 exposes BSC and Ethereum swaps, but the ledger is still derived from manual/imported history and confirmed swap accounting. Phase 10 must compare ledger wallet balances with on-chain balances using watch-only addresses. The server never holds private keys, never signs, and never changes ledger balances from on-chain data automatically.

## Decision

- **Watch-only addresses.** `watched_addresses` stores `(user, chain, address, label, enabled, last_indexed_block)`. Addresses can be added explicitly and are also seeded idempotently from confirmed/active swap orders so an owner's swap wallet becomes watchable without a UI. No signing material is stored.
- **Indexer.** An API-hosted indexer scans recent blocks per watched address with a Postgres advisory lock, a bounded block range per tick, and idempotent `indexed_transfers` rows. It indexes ERC-20 `Transfer` logs and native transfers. Only public chain data is read; RPC chain IDs are validated by `EvmRpcService`.
- **Reconciliation.** A reconciliation run compares the aggregate ledger balance of the user's wallet accounts for a chain with the sum of on-chain balances across enabled watched addresses. Amounts use decimal strings / Postgres `numeric`; raw base units are converted with the asset decimals. A run produces `MATCH`, `MISMATCH`, `MISSING_ONCHAIN`, or `MISSING_LEDGER` items and a summary. It never edits the ledger or swap orders.
- **Gas backfill.** For confirmed swap orders with a tx hash and missing `network_fee_wei`, the run fetches the receipt and fills the raw gas fee with an audit event. It does not rewrite accounting transactions or invent USD gas values.
- **API and UI.** Backend endpoints cover watched-address management, indexer status, reconciliation runs, and run detail. Phase 10 is backend-only; the UI is a later task.
- **Security.** Owner-only, CSRF-protected mutations; address format and chain allowlist validation; no arbitrary contract calls beyond balance reads and transfer log queries; no secrets in logs.
- **Schema is additive.** Migration 0014 adds the four tables; migration 0015 backfills verified contract addresses/decimals for seeded assets. No ledger transactions or swap accounting rows are rewritten; the asset metadata backfill is a system migration and is documented separately.

## Consequences

- Reconciliation reports mismatches rather than auto-correcting them; corrections remain append-only ledger transactions (Phase 11/hardening).
- The indexer is bounded and may lag the chain head; reconciliation uses current balances, not the indexer cursor, for the final comparison. Indexer reorg rewind/parent-hash checks are a later hardening item; transfer history can be stale after a reorg.
- A watched address added after a historical block starts indexing from the configured lookback, not genesis.
- Live acceptance requires owner approval to add the production wallet address and run `/reconciliation/run`; no production data is changed by the run.
