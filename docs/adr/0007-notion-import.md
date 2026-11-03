# ADR 0007 — Notion import staging, control reconciliation, and rollback

## Status

Accepted for Phase 4.

## Context

Phase 3 provides the append-only ledger, lots, and reconciliation. Phase 4 imports the existing Notion crypto journal: `Source`, `Orders`, and `Transactions`. The import must be previewable, auditable, idempotent, and reversible without inventing financial values.

At the time of implementation, the Notion workspace contained 431 orders (412 closed, 19 active), 9 USDT transactions, and 36 source assets. The Phase 3 control snapshot contains 429 orders (410 closed, 19 active). The difference is fully explained by four known orders:

- orders `465` and `466` were opened after the snapshot;
- orders `450` and `463` were still active in the snapshot and were closed afterwards.

## Decision

### Import staging

- `imports` stores one attempt per source file hash: user, source, status (`preview`, `committed`, `rolled_back`, `failed`), raw summary, timestamps.
- `import_rows` stores normalized rows: entity type, source id, source hash, status, normalized data, resulting transaction id, and error.
- Source JSON files are never committed to the repository. The preview API accepts the exported arrays; the UI reads the three files locally and sends the raw JSON to the API.
- The import preview requires `application/x-notion-import+json` and uses a 10 MiB body limit. A `preParsing` hook rejects that content type outside `POST /api/v1/imports/notion/preview`, and the controller rejects `application/json` with `415`; other routes keep the default 1 MiB. A lossless JSON parser keeps every numeric literal as its original string lexeme, so amounts and rates reach the decimal parser without a JS number/float conversion.
- The preview response is a compact summary plus row statuses, not the raw rows.

### Mapping

- `Source` → BSC assets. Existing seeded assets are reused by symbol. Unknown assets are created unverified, with `contractAddress = null`, `decimals = 18`, `coingeckoId` from the Notion `Символ [P]` property, and `chain_known=false`.
- USDT is already seeded as a BSC cash equivalent. Imported USDT prices are ignored because stablecoins are valued at $1.
- `Orders` → one trade group per order.
  - Buy transaction: `USDT → token`, using `Сумма-источника [1]` as USD cost and `Сумма-назначения` as token amount.
  - Closed order sell transaction: `token → USDT`, using the full destination amount and `proceeds = amount × Фактический курс [2]`.
  - A closed order's group lot is consumed directly at import time, preserving the historical Notion cost basis for that order.
  - Imported active lots remain part of the normal global FIFO pool. A later manual sell may consume them and update the imported trade group to `partial`/`closed`, because manual trades use the Phase 3 global-FIFO policy. A later Notion close for an order whose lot was partially consumed by a manual sell is rejected as `IMPORT_CONFLICT`: the same disposal must not be recorded twice.
  - Active orders create a buy and an open lot. Notion `Активна`, `В продажу`, and `Резерв` map to `open`, `for_sale`, and `reserve`.
  - Notion date-only close values are normalized to `23:59:59.999Z` on that date, capped at preview time, so a same-day close is not ordered before its buy and a today close is not future-dated.
- `Transactions` → USDT deposit/withdrawal. The amount is `Сумма пополнения` or `Сумма вывода`; the Notion account must resolve to USDT.
- Notion has no gas/fee data in these rows. Fees are not invented. Every imported transaction carries `network_fee_included=false`.

### Data quality

Imported assets and transactions store:

- `chainKnown=false`
- `contractKnown=false`
- `networkFeeIncluded=false`
- `priceSource=notion`
- `reconciled=false`
- `assetVerified=false` for newly created assets

Prices from `Source` are stored for non-cash assets at commit time with `source=notion` and `import_id` set. USDT prices are ignored. Missing prices are reported by the existing `missingPrices` dashboard field.

### Idempotency and incremental imports

Every imported transaction uses `source=notion` and a deterministic `source_id`:

- `notion:order:<orderId>:buy`
- `notion:order:<orderId>:sell`
- `notion:transaction:<pageId>`

Preview detects existing rows:

- both buy and sell exist → row skipped;
- neither exists → new row;
- buy exists and the order is still open with an unchanged, fully open lot → row skipped;
- buy exists and the order is now closed → row scheduled for update; commit adds the sell transaction, consumes the existing lot, and closes the group;
- buy exists and the order status changed (open ↔ for_sale/reserve) → row scheduled for update; commit reconciles the group status;
- sell exists without buy, or an existing lot amount/cost basis differs from the export → error, and commit is blocked.

A different export with the same rows is therefore safe: already imported rows are skipped. A committed identical export returns `409`. A rolled-back import can be re-previewed and re-committed.

### Commit and rollback

- Preview writes only `imports`/`import_rows`; it never touches the ledger.
- Commit validates the preview, applies all pending rows and ledger entries in one database transaction, writes an audit entry, and marks the import committed.
- Import write paths use the same per-user PostgreSQL advisory lock as manual ledger writes, so imports and manual transactions cannot race.
- A committed import can be rolled back only while it is the newest committed import and no later non-import transaction exists. Rollback removes the import's transactions, postings, lots, consumptions, trade groups, and prices in one transaction, restores lots for active→closed updates, restores the previous group status/closedAt for status-only and close updates from `import_rows.metadata`, preserves skipped/error row history, and records an audit entry.
- Commit re-runs existing-row detection inside the same transaction and under the user lock. Preview statuses are advisory: if another import was rolled back or committed, skipped rows are re-opened or re-skipped before any ledger write. A stale preview can never silently commit an empty import.
- If preview itself detected row conflicts (for example a partially consumed lot), the rows have status `error`; commit returns `409 IMPORT_CONFLICT` with those row errors. Parser/validation errors without conflict rows remain `400 VALIDATION_ERROR`.
- Rollback is an explicit import-admin exception to ordinary append-only behavior. Ordinary ledger mutations still never delete.
- If later manual activity or a later import exists, rollback returns `409`; a compensating reversal must be designed separately.
- Assets created by the import remain after rollback; they are master data and may be reused by a later import.

### Negative balances

Commit checks final wallet balances and rejects a negative final balance. It does not reject chronological negative balances during backfill: the Notion journal starts buying before the first recorded USDT deposit, so the recorded capital flows are not a complete chronological cash history. Enforcing interim non-negativity would require inventing an opening balance.

### Control reconciliation

Preview computes current totals and reconstructs the 429-order Phase 3 baseline using the four known adjustments. It compares:

- order, closed, and active counts exactly;
- deposits, withdrawals, buy, sell, realized P&L, cash, and active cost within ±$0.01.

If the baseline is applicable and outside tolerance, the preview has an error and commit is blocked. Current 431-row totals are also shown, with deltas against the 429 snapshot; these deltas are informational because the user explicitly chose to import all 431 rows.

The Phase 3 control also contains price-dependent metrics (active value, equity, unrealized P&L, total P&L, ROI, win rate, profit factor, XIRR). Those were calculated at audit-time prices, while the current export contains current Source `Курс [1]` prices. The preview therefore reports current valuation separately and does not use it for commit gating. The 429 snapshot valuation is shown for context. For the current data, the active cost (2517.10) matches exactly; the current valuation at current prices differs from the audit-time valuation and that difference is expected, not a transaction or cost-basis error.

### Lossless numbers

The import content type is parsed with `lossless-json` and a number parser that returns the original lexeme as a string. The decimal parser then uses `decimal.js` for all amounts. The browser sends the raw file text without `JSON.parse`, so no numeric literal passes through a JS number.

### Reconciliation endpoint

`GET /api/v1/imports/:id/reconciliation` returns the stored control, current deltas, and valuation for a preview/committed/rolled-back import. It is read-only and does not recompute against changed prices.

### UI

The `/import` page supports:

- uploading `Source.json`, `Orders.json`, and `Transactions.json`;
- preview with totals, control reconciliation, current valuation, warnings, and errors;
- commit and rollback with confirmation;
- import history, reopening a previous preview, and the reconciliation endpoint;
- a compact post-commit accounting summary.

The UI is Russian, dark, and uses the existing design primitives. It does not persist uploaded files in browser storage. Selecting a new file clears the previous preview, so the commit button can never target an old preview after files change or a preview fails.

Source `Описание`/watchlist theses and tags are not imported in Phase 4; the watchlist table/UI is Phase 5. The source descriptions remain in staging data.

## Consequences

- Imports are repeatable, auditable, and reversible while they are the newest activity.
- Historical Notion cost basis is preserved per order via trade-group lots rather than global FIFO mixing.
- Unknown chain/contract data is visible as data quality, not silently guessed as verified.
- Active→closed Notion updates can be imported without creating duplicate buys.
- Committed rollback is deliberately narrow; once later ledger activity exists, a compensating reversal is required.
- The hard-coded control adjustments are a one-time migration fingerprint. New exports that do not contain those four orders show the control snapshot as not applicable.
- Phase 4 does not sync directly with the Notion API, import `Statistics`, calculate taxes, or invent gas/fee values.
- Manual FIFO can consume active imported lots by design; a later Notion close for the same order then conflicts instead of double-counting the disposal.
- The staging tables are the accepted raw-archive boundary for Phase 4. R2/encrypted archival is a later operational enhancement.
- Import POSTs do not require a separate `Idempotency-Key`; the source hash, import status, row source ids, and the per-user lock provide idempotency. A retry of a committed import returns `409`.
