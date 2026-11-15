# ADR 0053 — Read-only data quality report

## Status

Accepted for UI-61/W4 on 2026-11-15. No migration.

## Context

The old `dashboard/data-quality` endpoint loaded every transaction into memory and the UI page was removed in UI-49. The owner needed a current, actionable report covering the failures that appeared in practice: orphan orders/lots, negative balances, unaccounted swaps and stale background data.

## Decision

Add owner-only `GET /api/v1/settings/data-quality` and `Настройки → Качество данных`.

The report groups checks into:

- **Учёт** — negative wallet balances, unbalanced postings, transactions without postings, wallet balance vs lots.
- **Ордера и лоты** — groups without lots, non-cash lots without a group, invalid lot remainders, group status drift.
- **Свопы** — confirmed without an accounting transaction, stuck states, swap accounting error codes.
- **Рынок** — missing and stale/non-positive quotes.
- **Роботы** — stale running bots, orphan positions (expected after token removal), negative bot cash.
- **Сеть** — latest reconciliation mismatches.
- **Импорт** — stale previews.
- **Метаданные** — unverified assets, missing gas and unreconciled transactions in the last 30 days.

Each check returns a severity, count, hint, up to five samples and a relative link. Queries are owner-scoped, indexed where possible and capped; the existing 15s statement timeout remains the hard ceiling.

The report is read-only. It does not rewrite postings, delete transactions, recalculate lots or auto-fix ledger data. Any correction remains a new transaction/audit action.

## Consequences

- The owner can see whether “bad numbers” come from missing prices, ledger/lot drift, stale swaps, imports or bot state.
- Legacy `missing gas`/`unreconciled` rows are limited to the last 30 days so the report stays actionable.
- Orphan bot positions are informational by design after a token is removed.
- The old `dashboard/data-quality` endpoint remains for compatibility; the new page uses the richer report.
- No schema change.

## Verification

- API e2e checks owner-only access and seeds a trade group without lots, asserting the `group_without_lots` check and its `/trades/:id` sample link.
- Complex queries were run read-only against production data before release.
- `format:check`, `typecheck`, `lint`, web tests, API tests and build pass.
- No migration.
