# Phase 10 — On-chain Reconciliation Report

Date: 2026-11-05 (live run: 2026-11-08)

Status: **implementation and live execution accepted 2026-11-08; data reconciliation open.** PR #34 is merged and deployed (`4171140`, API/worker `SUCCESS`, `/ready` 200). Both live runs completed and persisted their items. Ten non-zero supported assets differ from the watched wallet and require append-only corrections or documented owner-approved exceptions. No reconciliation code defect was found.

## First live run

The owner ran BSC and Ethereum reconciliation on 2026-11-08. Both runs completed:

- BSC run `9c7732bc-2aea-424b-8684-cef97d1886f5`, block `132414560`: 8 supported assets - 1 `MATCH`, 5 `MISMATCH`, 1 `MISSING_LEDGER`, 1 `MISSING_ONCHAIN`; 30 imported assets were `UNSUPPORTED`.
- Ethereum run `859ce00b-8e5c-4ec5-a406-0ca65b9ccff1`, block `26370976`: 3 supported assets - 0 `MATCH`, 2 `MISMATCH`, 1 `MISSING_LEDGER`; no unsupported assets.
- `gasBackfilled` was 0 on both chains. This means no confirmed swap order needed a raw gas backfill; it does not mean gas is fully represented in the ledger.
- The BSC USDC item matched exactly, which validates the swap-accounting path and the reconciliation math.
- All 30 unsupported imported assets had zero ledger balance. They are master-data gaps (chain/contract mapping), not balance differences, and do not block balance reconciliation.

The run used the watch-only address auto-seeded from swap orders, and the same address was returned for both chains. It was verified against public RPC: native and token balances match the run items exactly. A second address from an old UI note has zero balances on both chains and is not the active wallet.

The mismatches are data divergence between the current ledger/import and the on-chain wallet, not a reconciliation code failure. Public explorer history shows recent POP/USDC swap activity on 2026-11-03 through 2026-11-05, and the resulting balances are not fully reflected in the ledger. The watched BSC address also has no BSC-USD (USDT) transfer history, so the imported USDT cash balance is outside that wallet. No ledger corrections were applied automatically. Exact balances are intentionally not recorded in this document; they remain in the persisted run items.

## Discrepancy triage

The run is a report, not a correction. Each item needs evidence before any append-only correction. Exact deltas are in the persisted run items; the table records the likely category and the required evidence.

| Chain    | Asset | Status            | Direction         | Likely category                                                 | Required before correction                                                       |
| -------- | ----- | ----------------- | ----------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| BSC      | APR   | `MISMATCH`        | ledger > on-chain | Unrecorded disposal/outbound transfer or stale imported balance | On-chain transfer log plus the matching Notion/manual transaction or a new entry |
| BSC      | BASED | `MISMATCH`        | ledger > on-chain | Unrecorded disposal/outbound transfer or stale imported balance | On-chain transfer log plus the matching Notion/manual transaction or a new entry |
| BSC      | BNB   | `MISMATCH`        | ledger > on-chain | Unrecorded gas/native outbound transfer                         | Transaction receipts and fee evidence; do not invent USD gas                     |
| BSC      | LINK  | `MISSING_LEDGER`  | on-chain > ledger | Incoming transfer, airdrop, or dust not in the ledger           | On-chain transfer log; owner decision on cost basis or documented exception      |
| BSC      | POP   | `MISMATCH`        | ledger > on-chain | Unrecorded disposals; recent on-chain swaps are visible         | On-chain transfer log plus Notion/manual entries or new append-only entries      |
| BSC      | USDT  | `MISSING_ONCHAIN` | ledger > on-chain | Custody outside the watched wallet or unrecorded withdrawal     | Exchange/other-wallet evidence; add the watch address or record the withdrawal   |
| BSC      | XNY   | `MISMATCH`        | on-chain > ledger | Incoming transfers not in the ledger                            | On-chain transfer log plus the missing deposit/acquisition evidence              |
| Ethereum | ETH   | `MISMATCH`        | on-chain > ledger | Unrecorded deposit or opening-balance/fee difference            | Native transaction history and the opening-balance entry                         |
| Ethereum | USDC  | `MISMATCH`        | on-chain > ledger | Pre-existing dust or unrecorded incoming transfer               | Token transfer log; record the deposit or document an exception                  |
| Ethereum | USDT  | `MISSING_LEDGER`  | on-chain > ledger | Incoming transfer not in the ledger                             | Token transfer log; record the deposit or document an exception                  |

Custody is the main open question. The Phase 4 Notion import maps all `Source` assets and USDT transactions to the `Tangem BSC` wallet account, regardless of the asset's real chain or custody location. Assets held on another wallet, another chain, or an exchange cannot reconcile against one watched address. The owner must decide whether to add those addresses, record the transfers, or mark the affected items as explicit exceptions.

## Acceptance status

- **Phase 10 implementation and live execution: accepted.** The runs completed, persisted summaries/items, and produced the expected comparison. The BSC USDC exact match and the address verification confirm the RPC, decimal, asset, and persistence path.
- **Phase 10 data reconciliation: open.** Ten non-zero supported assets are not `MATCH`. Phase 10 is not claimed as a clean reconciliation. Data acceptance closes when every non-zero supported asset is `MATCH` or a documented, owner-approved exception, or when the missing custody addresses are added and the runs are repeated.
- **Unsupported assets:** all 30 have zero ledger balance. Mapping them to verified contracts or excluding them is master-data cleanup, not a balance blocker.

## Next owner actions

1. Confirm the watched address is the Tangem wallet that holds the ledger positions. The auto-seeded address is the active one; the old UI address is empty.
2. Decide the custody model for the imported assets: watched wallet, other wallet, another chain, or exchange. Add watch addresses where applicable.
3. Export the ledger wallet balances/transactions and compare them with the on-chain transfer history for the ten items above.
4. Record corrections only as new append-only transactions with evidence; do not edit or delete ledger rows.
5. Map or exclude the 30 zero-balance unsupported assets as master-data cleanup.
6. Re-run BSC and Ethereum, attach the new run IDs, and close data acceptance only when the non-zero set is `MATCH` or explicitly excepted.

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
- Live reconciliation: completed 2026-11-08 on BSC and Ethereum; see the run IDs and triage above. Data reconciliation remains open.

## Acceptance

For each chain, a reconciliation run must complete and all non-zero assets must be `MATCH` (or a documented, owner-approved exception). A mismatch is not auto-corrected; it is investigated and corrected with a new append-only ledger transaction.

- **Implementation and live execution:** accepted. Both runs completed and persisted correct comparisons.
- **Data reconciliation:** open. Ten non-zero supported assets are not `MATCH`; see the triage. A clean acceptance is not claimed.

## Residuals

- Ledger/import data remediation and custody/chain mapping for the ten non-zero differences.
- Reconciliation UI and scheduled reports.
- Automatic discovery/validation of arbitrary ERC-20 tokens held by watched addresses.
- Historical indexing from genesis (current indexer starts from the configured lookback).
- Indexer reorg rewinds/parent-hash checks; reconciliation itself uses live balances, so transfer history can lag after a reorg.
- Automated post-accounting reorg compensation and manual attach-hash recovery.
- Gas backfill for non-swap/imported transactions.
