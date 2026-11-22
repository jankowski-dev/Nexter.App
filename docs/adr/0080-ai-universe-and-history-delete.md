# ADR 0080 — Delete AI universe tokens and hide search history runs

Status: accepted, 2026-11-22.

## Context

The AI universe exposed an `Убрать` action that only set `ai_profile_tokens.enabled = false`. The owner expected add/delete semantics and saw the entry stay in the list, while the search history had no way to remove old terminal runs from the `Последние запуски` list.

The AI tables were created with `nexter_app` holding `SELECT, INSERT, UPDATE` and no `DELETE`; migration `0049` deliberately revoked `DELETE` to protect historical AI data. Search runs and their artifacts are audit evidence and must not be hard-deleted.

## Decision

1. **Universe token deletion is a real delete of the membership row.** `DELETE /api/v1/ai-trading/profile/tokens/:id` now deletes only the `ai_profile_tokens` row inside a transaction and writes `ai_trading.token_removed` with the removed configuration. No other table references `ai_profile_tokens`, so search runs, artifacts, candidates, market candles, bots and recommendations are untouched. The user can add the token again because the `(profile_id, asset_id)` unique row is gone.
2. **Migration `0051` grants `DELETE` on `ai_profile_tokens` only.** It does not grant or revoke anything on other AI tables. The migration is additive and contains no data change.
3. **Search history deletion is a soft hide.** `DELETE /api/v1/ai-trading/search/:runId` checks ownership, rejects `queued`/`running` runs with `409 AI_SEARCH_RUN_ACTIVE`, and sets `summary.hidden = true` plus `summary.hiddenAt` on the `ai_pipeline_runs` row. It writes `ai_trading.search_run_hidden`. `GET /ai-trading/search/runs` filters rows whose `summary.hidden` is `true`. Status, results, artifacts, candidates and audit remain readable by id and are never deleted.
4. **UI uses the shared confirmation flow.** The universe row gets a trash button and `ConfirmDialog` instead of `Убрать`; the enabled `Switch` remains for pausing a token in search. Terminal search runs get a trash button and `ConfirmDialog`; active runs show no delete action and the endpoint still enforces the rule.

## Consequences

- Positive: add/delete semantics match the owner's mental model; removed tokens no longer occupy the unique membership slot or the dashboard token count.
- Positive: historical search evidence and recommendations stay intact; hiding is reversible by removing the summary keys.
- Positive: active searches cannot disappear from under the worker.
- Neutral: hidden runs still count in direct id lookups (status/results/export) by design.
- Negative: a hidden run is not restored through the UI; recovery requires a database update.
- Rollback: `REVOKE DELETE ON ai_profile_tokens FROM nexter_app` restores the old grant. Hidden runs can be unhidden with `summary - 'hidden' - 'hiddenAt'`. Migration `0051` changes no data.
