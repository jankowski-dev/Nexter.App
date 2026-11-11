# Notion import runbook

Use this runbook for the Phase 4 Notion journal import. The import is destructive only through its explicit rollback path; preview is always non-destructive.

## 1. Preconditions

- Phase 4 migration `0007_wild_leper_queen.sql` has been applied.
- The owner account exists, TOTP is enabled, and the owner can sign in.
- A PostgreSQL backup exists:

  ```bash
  pg_dump "$DATABASE_URL" --format=custom \
    --file "nexter-before-notion-import-$(date +%Y%m%dT%H%M%S).dump"
  ```

- No other ledger writes are in progress.
- The Notion export contains `source.json`, `orders.json`, and `transactions.json` as JSON arrays.

## 2. Export from Notion

Export the current `Source`, `Orders`, and `Transactions` data sources as JSON arrays. Do not export `Statistics`; it is recomputed.

Expected current counts:

- 431 orders (412 closed, 19 active);
- 9 transactions;
- 36 source assets.

The export must not be committed to the repository or pasted into logs/screenshots.

## 3. Preview

1. Sign in at the production URL.
2. Open `/import`.
3. Select the three JSON files.
4. Click `Предпросмотр`.

Verify:

- no errors;
- orders: 431, closed 412, active 19;
- the 429-order control table says `Сходится`;
- known adjustments: new `465`, `466`; closed after snapshot `450`, `463`;
- current buy: 55293.10 USD;
- current sell: 52846.0362995416 USD;
- current realized: 55.6362995416 USD (full precision);
- current cash: 15.7362995416 USD;
- current active cost: 2502.70 USD;
- current valuation at Source prices: positions 1829.88804762, equity 1845.62434716, unrealized -672.81195238, total P&L -617.17565284 USD;
- the Phase 3 snapshot valuation is shown separately and is expected to differ because it used audit-time prices;
- assets: 36, 30 new and 6 reused.

If the applicable 429 baseline is outside ±$0.01, commit is blocked. Do not bypass the error; compare the export and the control snapshot first.

## 4. Commit

1. Click `Подтвердить импорт`.
2. Confirm the dialog.
3. Wait for `Импорт применён к учёту` (the commit takes several seconds for 431 orders).

Expected post-commit summary:

- cash: 15.73629954 USD;
- positions value: 1829.88804762 USD;
- equity: 1845.62434716 USD;
- net deposits: 2462.80 USD;
- realized P&L: 55.63629954 USD;
- unrealized P&L: -672.81195238 USD;
- total P&L: -617.17565284 USD;
- no missing prices.

The accounting identity `equity − netDeposits = totalPnl` must hold.

## 5. Verify

- `GET /api/v1/dashboard/summary` returns the values above.
- `GET /api/v1/imports` shows one committed import.
- The import created 852 transactions (824 closed-order legs + 19 active buys + 9 cash), 431 lots, 412 lot consumptions, 431 trade groups, and 35 notion prices.
- `/api/v1/assets` shows the 30 newly created assets as unverified, BSC, no contract.
- `prices` rows created by the import have `source='notion'` and `import_id` set.

## 6. Rollback

Rollback is allowed only while this is the newest committed import and there are no later non-import transactions.

1. Open the import in `/import`.
2. Click `Откатить импорт` and confirm.
3. The API removes the import's transactions, postings, lots, consumptions, groups, and prices; restores lots for active→closed updates; and restores the previous group status/closedAt from `import_rows.metadata` for status-only and `for_sale`/`reserve` updates.
4. The import status becomes `rolled_back`; the audit log records the rollback. Skipped/error row history is preserved.

If the API returns `409`, later activity exists. Do not delete rows manually; design a compensating reversal instead.

## 7. Re-import

Re-preview the same export after rollback. The existing `rolled_back` import is reset to `preview`; commit re-creates its ledger effects.

To add new Notion rows, export again. Preview detects existing source ids and skips them. An active order that has since closed is scheduled as an update: commit adds the sell and consumes the existing lot.

## 8. Troubleshooting

- **413 / body too large**: the import preview accepts 10 MiB; other routes keep 1 MiB. Confirm the reverse proxy/edge also allows the 1.7 MiB `orders.json` for `/api/v1/imports/notion/preview`.
- **`IMPORT_CONFLICT`**: an existing lot amount/cost basis differs, a sell exists without a buy, a lot was partially consumed by a manual trade, or another import changed the state after preview. Do not force the import; compare the existing import and the new export. If a manual sell consumed the same order, choose one source of truth for that disposal.
- **`NEGATIVE_BALANCE`**: the final wallet balance would be negative. Check deposits/withdrawals and previous imports.
- **Control mismatch**: the export is not the expected 429 baseline plus the four known order changes. Do not commit until the difference is explained.
- **Rollback 409**: later manual activity or a later import exists. Keep the import and prepare a compensating reversal.

## Incremental refresh after the legacy baseline

Use this path when the owner wants current Notion orders after the original 431-order import and a full rollback is blocked by later ledger activity.

1. Read the current `Source`, `Orders`, and `Transactions` data through the `notion` MCP. Do not export `Statistics`.
2. Keep the three raw JSON arrays in a temporary directory outside the repository.
3. Preview through `/import` and verify:
   - source assets 36, orders 436, closed 417, active 19, transactions 9;
   - `newOrders` is 5, `updatedOrders` is 5, `skippedOrders` is 421, `skippedTransactions` is 9;
   - no errors; the control warning says the 429-order baseline is not applicable;
   - the preview valuation is plausible and all 19 active assets have prices.
4. Confirm the later manual ledger activity is untouched (BNB/ETH opening lots and the small USDC→BNB swap).
5. Commit only after the owner reviews the preview. Rollback follows the normal import rollback path while no later activity exists; otherwise a compensating reversal or the clean cutover is required.
6. The legacy control is intentionally skipped for exports with order ids above 466. This is documented in ADR 0032; do not treat the warning as a reason to edit the hard-coded snapshot.
