# Phase 4 — Notion Import Report

Date: 2026-11-03

Status: **implementation complete; pending independent review and acceptance.**

## Scope completed

- ADR `0007-notion-import.md`.
- Migration `0007_wild_leper_queen.sql`:
  - `imports` and `import_rows` staging tables;
  - `assets.source_id`, `assets.data_quality`;
  - `transactions.import_id`, `transactions.data_quality`;
  - `prices.import_id`;
  - import indexes and unique source-hash constraint.
- Notion parser:
  - Source/Orders/Transactions normalization;
  - status mapping (`Активна`, `Закрыта`, `В продажу`, `Резерв`);
  - relation resolution through Notion page ids;
  - date-only close normalization to end of day UTC;
  - positive amount/rate validation, duplicate detection, unsupported-row errors;
  - full-precision totals and per-order 8-decimal ledger values;
  - 429-order control reconstruction with known post-2026-10-31 changes.
- Import service:
  - preview staging with row-level existing-row detection;
  - idempotent commit with deterministic source ids;
  - new orders, existing active orders, and active→closed updates;
  - per-order trade groups and lots, direct lot consumption for closed orders;
  - imported `source=notion` prices for non-cash assets with `import_id`;
  - final wallet-balance check;
  - narrow rollback for the newest committed import with no later activity;
  - audit entries for preview, commit, and rollback;
  - shared per-user advisory lock with manual ledger writes.
- Import API:
  - `GET /api/v1/imports`;
  - `GET /api/v1/imports/:id`;
  - `GET /api/v1/imports/:id/reconciliation`;
  - `POST /api/v1/imports/notion/preview`;
  - `POST /api/v1/imports/:id/commit`;
  - `POST /api/v1/imports/:id/rollback`.
- `/import` UI:
  - three-file upload;
  - preview, totals, control table, current deltas, warnings/errors;
  - commit/rollback confirmation;
  - import history and reopening;
  - compact post-commit accounting summary.
- API request body limit raised to 10 MiB for the 1.7 MiB `orders.json`.
- Docs: ADR, accounting/API specs, decisions, runbook, README, AGENTS, this report.

## Control reconciliation

Current Notion export: **431 orders** (412 closed, 19 active), 9 transactions, 36 source assets.

The Phase 3 control is a **429-order snapshot**. The preview reconstructs it by:

- excluding new orders `465` and `466`;
- treating `450` and `463` as still active (they closed after the snapshot).

Reconstructed baseline:

| Metric          | Value                |
| --------------- | -------------------- |
| Orders          | 429                  |
| Closed / active | 410 / 19             |
| Deposits        | 2519.80 USD          |
| Withdrawals     | 57.00 USD            |
| Buy             | 54955.30 USD         |
| Sell            | 52508.0139345416 USD |
| Realized        | 69.8139345416 USD    |
| Cash            | 15.5139345416 USD    |
| Active cost     | 2517.10 USD          |

The transaction-based baseline (counts, deposits, withdrawals, buy, sell, realized, cash) and active cost match the Phase 3 control within ±$0.01. The Phase 3 snapshot also contains price-dependent metrics: active value 2060.42365438, equity 2075.937588921603, unrealized -456.67634561999995, total P&L -386.86241107839714. Those were calculated at audit-time prices; the current export carries current Source `Курс [1]` prices. The preview reports current valuation separately and does not gate commit on price-dependent metrics. Current 431 totals:

| Metric                        | Value                           |
| ----------------------------- | ------------------------------- |
| Buy                           | 55293.10 USD                    |
| Sell                          | 52846.0362995416 USD            |
| Realized (full / ledger 8 dp) | 55.6362995416 / 55.63629954 USD |
| Cash (full / ledger 8 dp)     | 15.7362995416 / 15.73629954 USD |
| Active cost                   | 2502.70 USD                     |
| Positions value               | 1829.88804762 USD               |
| Equity                        | 1845.62434716 USD               |
| Net deposits                  | 2462.80 USD                     |
| Unrealized                    | -672.81195238 USD               |
| Total P&L                     | -617.17565284 USD               |

`equity − netDeposits = totalPnl` holds exactly at ledger scale.

## Verification

- `pnpm typecheck` — pass.
- `pnpm lint` — pass.
- `pnpm format:check` — pass.
- `pnpm build` — pass.
- API tests — **51 passed, 1 skipped** with the disposable PostgreSQL test database. The skipped test is the opt-in real 431-row import test.
- Synthetic import e2e — preview/commit/dashboard/re-import/active→closed update/status-only rollback/stale-preview re-detect/manual-FIFO conflict/later-activity block/auth+CSRF/audit all pass.
- Real 431-row import e2e (`NOTION_EXPORT_DIR`) — raw lossless JSON content type, preview, 429 baseline match including active cost, reconciliation endpoint, commit, 852 transactions, 431 lots, 412 consumptions, 431 groups, 35 notion prices, current valuation equals the post-commit dashboard, and rollback all pass. Commit about 7 s, preview under 1 s locally.
- Playwright — 2 tests pass: existing auth flow and the new `/import` UI flow (upload, preview, stale-preview clearing, commit, dashboard preview, rollback, history).
- Migration applies cleanly to a fresh PostgreSQL 17 database (`nexter_p4` was recreated from scratch for the final run).

## Known limitations

- Phase 4 does not call the Notion API; the user uploads the three JSON files.
- Notion `Statistics` is not imported.
- Imported assets have no contract/chain verification beyond BSC-by-assumption.
- Fees and gas are not invented; `network_fee_included=false`.
- Rollback is only for the newest committed import with no later non-import activity.
- Manual FIFO can consume active imported lots. A later Notion close for the same order is rejected as `IMPORT_CONFLICT` rather than double-counting the disposal. Choose Notion import or manual entry for a given sale.
- Source watchlist theses/tags (`Описание`, `Топ`, `Дашборд`, `П-Мкап`) are not imported; the watchlist table/UI is Phase 5. Descriptions remain in staging.
- The staging tables are the Phase 4 raw-archive boundary; R2/encrypted archival is deferred.
- Import POSTs do not use a separate `Idempotency-Key`; source hash/status/row ids and the per-user lock provide idempotency, and retrying a committed import returns `409`.
- A zero-amount Notion deposit is imported as a no-op transaction to preserve the source row.
- Order `Н` notes and the `ORD-<id>` external ref are not stored as dedicated fields; the generated import notes identify the Notion order number.
- Full dashboard, portfolio, trades, trade detail, watchlist, export, and settings UI are Phase 5.
- Import commit is one transaction and takes several seconds for 431 orders; the UI shows a loading state.
- The temporary Notion view `Nexter Import` used for the 431-row export must be deleted manually.

## Accepted scope deviations (pending Phase 4 sign-off)

The original mega-prompt contains three broader requirements that Phase 4 intentionally narrows. These follow the owner's Phase 4 scope decisions and are documented in ADR 0007:

- **431 current orders, not only the 429 audit snapshot.** The 429 control is reconstructed from the current export with the four known order changes.
- **Per-order lots for closed Notion orders + global FIFO for manual flows.** Historical Notion cost basis is preserved for closed orders; imported active lots remain in the manual global-FIFO pool.
- **Transaction-based control plus active cost are gated.** Price-dependent Phase 3 snapshot metrics (active value, equity, unrealized/total P&L, ROI, win rate, profit factor, XIRR) were calculated at audit-time prices and cannot be reconstructed from current Source prices without inventing historical prices; they are reported for context, not gated.
- **Source watchlist theses/tags are deferred to Phase 5.** Assets are imported; descriptions stay in staging.

These deviations need explicit acceptance at Phase 4 sign-off or a later contract update.

## Production import

The API/worker are deployed on Railway. The production import path is the `/import` UI:

1. Take a PostgreSQL backup.
2. Deploy the Phase 4 migration through the normal pre-deploy command.
3. Sign in at the production URL.
4. Open `/import`, upload the three export files, and confirm the preview matches the control numbers above.
5. Commit; verify the post-commit summary and `/api/v1/dashboard/summary`.
6. Keep the import record and audit log.

Do not upload real export files to the repository or to a shared chat.

## Review history

First independent review returned **FAIL** with three High findings:

- imported active lots were claimed to be isolated but manual FIFO could consume them and mutate imported groups;
- commit trusted stale preview statuses, so a preview → rollback → commit sequence could silently skip rows;
- control reconciliation did not cover price-dependent metrics and the report overstated the match.

All High findings and the actionable Medium findings were addressed:

- the ADR/spec now document the hybrid per-order/global-FIFO model and the resulting `IMPORT_CONFLICT` rule;
- commit re-runs existing-row detection under the user lock and re-opens skipped rows;
- active cost is reconciled, current valuation is reported separately, and the price-dependent snapshot difference is documented;
- rollback restores status-only and `for_sale`/`reserve` updates from import-row metadata;
- the import body is parsed losslessly with a route-specific 10 MiB limit;
- `GET /imports/:id/reconciliation` exists;
- `IMPORT_CONFLICT` is preserved by the error filter;
- selecting new files clears the preview;
- tests cover stale previews, status-only rollback, manual-FIFO conflicts, lossless numbers, and the reconciliation endpoint.

A second review returned **PASS WITH CHANGES** with no Critical/High findings. Remaining Medium items were:

- the 10 MiB lossless parser was globally registered rather than route-scoped;
- the preview still accepted `application/json`, reintroducing JS-number precision loss;
- preview-detected conflicts surfaced as `VALIDATION_ERROR` at commit rather than `IMPORT_CONFLICT`;
- hybrid FIFO and price-dependent control are explicit acceptance deviations;
- the UI valuation note attributed the whole difference to prices.

Fixes:

- a `preParsing` hook rejects the import content type outside `POST /api/v1/imports/notion/preview`, and the controller requires `application/x-notion-import+json`;
- preview-detected conflict rows now return `409 IMPORT_CONFLICT` on commit;
- the UI note mentions both price movement and the four known order changes;
- accepted scope deviations are listed above and in ADR 0007;
- docs use the actual migration filename and include the reconciliation endpoint, status restoration, and the new error code.

A third review verified the content-type case-normalization fix and returned **PASS** with no remaining code blockers. Phase 4 is ready for owner sign-off on the documented scope deviations.
