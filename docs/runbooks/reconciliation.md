# On-chain Reconciliation Runbook (Phase 10)

Watch-only reconciliation compares the ledger wallet balances with on-chain balances. It never signs, never holds keys, and never edits the ledger automatically.

## Configuration

```text
RECONCILIATION_ENABLED=false
RECONCILIATION_INDEX_INTERVAL_SECONDS=60
RECONCILIATION_LOOKBACK_BLOCKS=100
RECONCILIATION_MAX_BLOCKS_PER_TICK=50
RECONCILIATION_STALE_RUN_SECONDS=3600
```

Migration `0015` is a system data backfill of verified asset contract addresses/decimals; runtime repairs via `ensureForSwapToken` emit `accounting.asset_repaired` audit. `BSC_RPC_URL` and `ETHEREUM_RPC_URL` are used for balances, transfer logs, and receipts. The RPC chain ID is validated by `EvmRpcService`.

## Enable and add addresses

1. Deploy migration `0014` (additive).
2. Set `RECONCILIATION_ENABLED=true` and redeploy the API.
3. Add the watch-only address (owner session, CSRF required):

```http
POST /api/v1/reconciliation/addresses
{"chain":"bsc","address":"0x…","label":"Tangem BSC"}
```

Repeat for Ethereum. A reconciliation run also auto-adds wallet addresses seen on swap orders (audited).

## Owner console recipe (no UI yet)

After enabling `RECONCILIATION_ENABLED=true` and signing in, open `/swap` and run this in DevTools Console. It uses the existing session/CSRF cookies and prints only run results:

```js
(async () => {
  const csrf = document.cookie
    .split('; ')
    .find((c) => c.startsWith('nexter_csrf='))
    ?.split('=')[1];
  if (!csrf) return console.error('CSRF cookie not found');
  const headers = { 'content-type': 'application/json', 'x-csrf-token': csrf };
  const wallet = '0x…';
  for (const chain of ['bsc', 'ethereum']) {
    await fetch('/api/v1/reconciliation/addresses', {
      method: 'POST',
      headers,
      body: JSON.stringify({ chain, address: wallet, label: 'Tangem' }),
    });
    const run = await fetch('/api/v1/reconciliation/run', {
      method: 'POST',
      headers,
      body: JSON.stringify({ chain }),
    });
    console.log(chain, run.status, JSON.stringify(await run.json(), null, 2));
  }
})();
```

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
- `MISMATCH` — both non-zero but different; `delta = ledger − on-chain`. Investigate transfers, gas, and missing ledger entries.
- `MISSING_ONCHAIN` — ledger has a positive balance but the watched addresses do not.
- `MISSING_LEDGER` — the watched addresses hold an asset the ledger does not.
- `UNSUPPORTED` — the ledger has a balance for a non-native asset without a contract address. The run completes and the item is flagged; map the asset to a verified contract address or record an explicit owner-approved exception. Phase 4 imported assets may need this mapping.

A mismatch is **not** auto-corrected. Do not edit or delete ledger rows. Record the cause and create a new append-only correction transaction (or fix the indexer/asset registry and rerun).

## Imported assets

Assets created by the Notion import may not have contract addresses. They are reported as `UNSUPPORTED` when they have a ledger balance; they are never treated as native or silently matched. Map them to verified contract addresses (or record an owner-approved exception) before claiming a clean reconciliation.

## Gas backfill

For already-accounted confirmed swap orders with a tx hash and missing `network_fee_wei`, a run fetches the receipt and fills the raw fee with `swap.gas_backfilled` audit. It does not invent USD gas values or rewrite accounting.

## Indexer

The API-hosted indexer uses a Postgres advisory lock, so multiple API replicas are safe. It scans a bounded range per tick and advances `watched_addresses.last_indexed_block`; a failure leaves the cursor unchanged for retry. It indexes ERC-20 `Transfer` logs and non-zero native transfers. Cursor-only advances with no new transfers are system indexer state and do not write an audit row; data-bearing ticks are audited. The indexer does not yet rewind on reorg; reconciliation uses live balances, so a stale transfer history does not change the balance comparison.

## Rollback

- Set `RECONCILIATION_ENABLED=false` and redeploy; the indexer stops, and persisted watch addresses/transfers/runs remain.
- Do not delete reconciliation rows; they are audit evidence.
- Migrations `0014`/`0015` are additive; no destructive rollback is required.
