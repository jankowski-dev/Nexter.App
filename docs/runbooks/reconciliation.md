# On-chain Reconciliation Runbook (Phase 10)

Watch-only reconciliation compares the ledger wallet balances with on-chain balances. It never signs, never holds keys, and never edits the ledger automatically.

## Configuration

```text
RECONCILIATION_ENABLED=false
RECONCILIATION_INDEX_INTERVAL_SECONDS=60
RECONCILIATION_LOOKBACK_BLOCKS=100
RECONCILIATION_MAX_BLOCKS_PER_TICK=50
```

`BSC_RPC_URL` and `ETHEREUM_RPC_URL` are used for balances, transfer logs, and receipts. The RPC chain ID is validated by `EvmRpcService`.

## Enable and add addresses

1. Deploy migration `0014` (additive).
2. Set `RECONCILIATION_ENABLED=true` and redeploy the API.
3. Add the watch-only address (owner session, CSRF required):

```http
POST /api/v1/reconciliation/addresses
{"chain":"bsc","address":"0x…","label":"Tangem BSC"}
```

Repeat for Ethereum. A reconciliation run also auto-adds wallet addresses seen on swap orders (audited).

## Run

```http
POST /api/v1/reconciliation/run
{"chain":"bsc"}
```

The run persists `reconciliation_runs` and `reconciliation_items`. Read them with:

```http
GET /api/v1/reconciliation/runs?chain=bsc
GET /api/v1/reconciliation/runs/:id
GET /api/v1/reconciliation/indexer
```

## Interpreting results

- `MATCH` — ledger and on-chain balances agree.
- `MISMATCH` — both non-zero but different; investigate transfers, gas, and missing ledger entries.
- `MISSING_ONCHAIN` — ledger has a positive balance but the watched addresses do not.
- `MISSING_LEDGER` — the watched addresses hold an asset the ledger does not.

A mismatch is **not** auto-corrected. Do not edit or delete ledger rows. Record the cause and create a new append-only correction transaction (or fix the indexer/asset registry and rerun).

## Gas backfill

For confirmed swap orders with a tx hash and missing `network_fee_wei`, a run fetches the receipt and fills the raw fee with `swap.gas_backfilled` audit. It does not invent USD gas values or rewrite accounting.

## Indexer

The API-hosted indexer uses a Postgres advisory lock, so multiple API replicas are safe. It scans a bounded range per tick and advances `watched_addresses.last_indexed_block`; a failure leaves the cursor unchanged for retry. It indexes ERC-20 `Transfer` logs and non-zero native transfers.

## Rollback

- Set `RECONCILIATION_ENABLED=false` and redeploy; the indexer stops, and persisted watch addresses/transfers/runs remain.
- Do not delete reconciliation rows; they are audit evidence.
- Migration `0014` is additive; no destructive rollback is required.
