# Phase 10 — On-chain Reconciliation Report

Date: 2026-11-05 (live run: 2026-11-08)

Status: **implementation and live execution accepted 2026-11-08; data reconciliation deferred to the go-live clean cutover (ADR 0014).** PR #34 is merged and deployed (`4171140`, API/worker `SUCCESS`, `/ready` 200). Both live runs completed and persisted their items. Ten non-zero supported assets differ from the watched wallet; the owner chose not to migrate or correct the legacy Notion-derived ledger. No reconciliation code defect was found.

## First live run

The owner ran BSC and Ethereum reconciliation on 2026-11-08. Both runs completed:

- BSC run `9c7732bc-2aea-424b-8684-cef97d1886f5`, block `132414560`: 8 supported assets - 1 `MATCH`, 5 `MISMATCH`, 1 `MISSING_LEDGER`, 1 `MISSING_ONCHAIN`; 30 imported assets were `UNSUPPORTED`.
- Ethereum run `859ce00b-8e5c-4ec5-a406-0ca65b9ccff1`, block `26370976`: 3 supported assets - 0 `MATCH`, 2 `MISMATCH`, 1 `MISSING_LEDGER`; no unsupported assets.
- `gasBackfilled` was 0 on both chains. This means no confirmed swap order needed a raw gas backfill; it does not mean gas is fully represented in the ledger.
- The BSC USDC item matched exactly, which validates the swap-accounting path and the reconciliation math.
- All 30 unsupported imported assets had zero ledger balance. They are master-data gaps (chain/contract mapping), not balance differences, and do not block balance reconciliation.

The run used the watch-only address auto-seeded from swap orders, and the same address was returned for both chains. It was verified against public RPC: native and token balances match the run items exactly. A second address from an old UI note has zero balances on both chains and is not the active wallet.

The mismatches are data divergence between the current ledger/import and the on-chain wallet, not a reconciliation code failure. Public explorer history shows recent POP/USDC swap activity on 2026-11-03 through 2026-11-05, and the resulting balances are not fully reflected in the ledger. The watched BSC address also has no BSC-USD (USDT) transfer history, so the imported USDT cash balance is outside that wallet. No ledger corrections were applied automatically.

Under ADR 0014, the legacy Notion-derived data will not be migrated or corrected. When the service is ready for real use, the old database will be archived and a clean ledger epoch will start with opening balances at market value. The triage below is retained as evidence of why the legacy ledger is not the go-forward source of truth; exact deltas remain in the persisted run items.

## Discrepancy triage

The run is a report, not a correction. The table records the likely cause of each legacy difference. These items are not scheduled for correction; the clean cutover re-baselines the go-forward ledger instead.

| Chain    | Asset | Status            | Direction         | Likely category                                                 | Evidence if investigated                                                         |
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
- **Phase 10 data reconciliation: deferred to the go-live clean cutover.** Ten non-zero supported assets are not `MATCH`. They are expected legacy drift and are not a code defect. Under ADR 0014, the old ledger is archived and the go-forward ledger is re-baselined with opening balances instead of correcting legacy rows.
- **Unsupported assets:** all 30 have zero ledger balance. They are legacy master-data gaps and do not block the clean cutover.
- **Current production data:** left as-is until the cutover so the owner can inspect it. The known mismatches will remain visible; they are not a Phase 11/UI blocker.

## Next owner actions (at go-live, not now)

1. Finish Phase 11 and the UI redesign; freeze the cutover date.
2. Take and verify a full backup of the current production database.
3. Create the clean database/schema, run migrations, and bootstrap the owner.
4. Add the actual watched addresses and enter current holdings as `adjustment` opening balances at market value.
5. Run BSC and Ethereum reconciliation; record the cutover evidence and keep the old database as a read-only archive.
6. Decide the legacy Notion Import navigation/role during the UI redesign.

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

- Legacy data retirement via the ADR 0014 clean cutover: archive the old database, start a new ledger epoch, and enter opening balances. No legacy corrections are planned.
- Opening-balance onboarding UI and the final legacy-import navigation decision.
- Reconciliation UI and scheduled reports.
- Automatic discovery/validation of arbitrary ERC-20 tokens held by watched addresses.
- Historical indexing from genesis (current indexer starts from the configured lookback).
- Indexer reorg rewinds/parent-hash checks; reconciliation itself uses live balances, so transfer history can lag after a reorg.
- Automated post-accounting reorg compensation and manual attach-hash recovery.
- Gas backfill for non-swap/imported transactions.
