# Trade hardening plan — policy, observability, data quality, TradeIntent

Status: accepted 2026-11-15. Owner approved the default order and constraints.

## Progress

- W1 completed: PR #149, merge `b1ce42e1`, deployment `eee5f492-5344-4b17-b8b1-bfd125e0f499`, bundle `assets/index-CtjhSgZd.js`.
- W2 partial: server policy API test and fixture seeding landed with W1; the remaining P0/P1 matrix is still open.
- W3 completed: PR #150, merge `bc713d9d`, deployment `d54fc068-2f6f-4463-9c62-8d69fb809c64`, bundle `assets/index-DYL4XPtC.js` (ADR 0052).
- W2 next: tab-state E2E is merged (PR #151); remaining P0/P1 matrix is still open.
- W4 completed: read-only data-quality report (ADR 0053).
- W5A implemented: canonical trade intent audit metadata without schema (ADR 0054).
  Baseline: `main` at `e835511`, UI-60 deployed (`assets/index-De_jjhCd.js`).
  Working branch: `trade-hardening-phase-1`.

## Goal

Harden the trading system in five workstreams without breaking the existing ledger:

1. server-side policy/invariants for every trade write;
2. a focused test-hardening sprint;
3. read-only observability for quotes, indexers, bots and provider limits;
4. a read-only data-quality/reconciliation report;
5. a unified `TradeIntent` layer, first without schema, then optionally with a table.

The ledger remains append-only. No automatic rewriting of financial history.

## Non-goals

- no private keys or signing on the server;
- no new on-chain execution path;
- no automatic ledger corrections in the first data-quality phase;
- no backfill of old orders into `trade_intents` unless explicitly approved;
- no change to the accounting rules, FIFO logic, tax logic or bot strategies.

## Order of work

1. **W1 Policy layer** — 1–2 days.
2. **W2 Test hardening** — starts with W1, continues with every later task.
3. **W3 Observability** — 2 days, can run in parallel with W1/W2.
4. **W4 Data quality** — 3 days, after W3 schema/query patterns are known.
5. **W5A TradeIntent service** — 3–4 days, after W1 and W4.
6. **W5B TradeIntent table** — +3–4 days, only if W5A shows a real need; requires ADR, backup and migration.

Each workstream gets its own PR. W1 and W2 may be one PR; W3 and W4 may be separate PRs. No long-lived branch.

## W1 — Server-side trade policy

### Objective

One server-side policy service used by manual transactions, swap order creation/build and close-order flows. The UI is not the source of truth.

### Proposed files

- `apps/api/src/modules/accounting/trade-policy.service.ts` (new)
- `apps/api/src/modules/accounting/accounting.module.ts` (provide/export)
- `apps/api/src/modules/accounting/ledger.service.ts` (call policy before writes)
- `apps/api/src/modules/swap/swap.service.ts` (call policy for quote/close groups/build)
- `apps/api/src/modules/trading-bots/trading-bots.service.ts` (reuse asset/group helpers if applicable)
- `packages/contracts/src/accounting.ts` / `trading-bots.ts` only if error details need new optional fields (prefer no contract change)

### Rules to enforce

**Asset and account**

- Asset exists.
- Asset is not a cash-only operation where a trade asset is required.
- Account belongs to the authenticated user.
- Account is a wallet account.
- Account chain matches the asset chain (or the swap chain).

**Buy**

- The asset is an active entry in the user's default `Основная` watchlist group.
- The asset is not archived.
- The quote asset is an active cash-equivalent asset on the same chain.
- The amount and quote amount are positive decimals.
- The existing manual-buy and swap allowlist checks stay in place.

**Sell / close order**

- `tradeGroupId` is present for the UI sell path.
- The group belongs to the user.
- The group is not closed.
- The group's asset matches the requested asset.
- The requested amount is positive and does not exceed `remainingAmount`.
- The proceeds asset is cash-equivalent and on the same chain.
- Close-group ids for swaps are unique, belong to the user, are active, and refer to the same asset.
- A partially closed group may be closed again while remaining > 0.

**State and idempotency**

- The order/group state permits the operation (`QUOTED`, `READY`, etc.).
- A retried idempotency key returns the original result; a changed payload with the same key is rejected with a clear error.
- Step-up TOTP remains required above the configured threshold.

**Bot-specific**

- Removing a bot token with an open position is allowed, but the runner only manages exits for it.
- Adding a bot token requires an active default-group watchlist entry.
- These rules remain in the trading-bots service unless they are moved into the shared policy by a follow-up.

### Error contract

Use existing codes where possible. New codes only if necessary:

- `TRADE_ASSET_NOT_ALLOWED` — asset outside the default group.
- `TRADE_GROUP_NOT_FOUND` / `TRADE_GROUP_CLOSED` / `TRADE_GROUP_ASSET_MISMATCH`.
- `TRADE_AMOUNT_EXCEEDS_REMAINING`.
- `TRADE_ACCOUNT_CHAIN_MISMATCH`.
- `TRADE_IDEMPOTENCY_CONFLICT`.

Frontend messages go to `apps/web/src/lib/error-messages.ts`. Existing `SWAP_*` codes stay unchanged.

### Acceptance criteria

- A manual buy for a token outside `Основная` is rejected by the API even if the request bypasses the UI.
- A manual sell for another user's group is rejected.
- A manual sell above the remaining amount is rejected server-side.
- A swap close-group request with a closed/foreign/mismatched group is rejected.
- Existing legitimate buy/sell/swap flows still pass.
- Every rejection is audited or leaves no partial write.
- No schema change.

### Tests

- Unit tests for `TradePolicyService` with a real test DB or focused mocks.
- API e2e: outside-group buy, foreign group, oversell, archived asset, chain mismatch, duplicate idempotency payload.
- Existing API tests updated only where their setup bypassed the new policy.

## W2 — Test hardening

### Objective

Catch the failure modes that caused the recent UI and provider bugs.

### Scenarios

| Scenario                                | Layer                  | Proves                                      |
| --------------------------------------- | ---------------------- | ------------------------------------------- |
| Double-click manual buy/sell save       | E2E                    | one transaction, idempotency                |
| Double-click on-chain execute           | E2E                    | one order, button disabled                  |
| Wallet rejection / cancel wait          | E2E with mocked wallet | clean state, no duplicate order             |
| Stale/expired quote                     | API + E2E              | clear error and retry path                  |
| Kyber 429                               | API unit               | no retry storm, `SWAP_RATE_LIMITED`         |
| Manual sell above remaining             | API + E2E              | server rejects, UI error                    |
| Tab switch on-chain ↔ manual            | E2E                    | input preserved, no lost form               |
| Buy button absent outside main list     | E2E                    | asset drawer has no buy                     |
| Four operation tabs                     | E2E                    | exchange/deposit/withdrawal/adjustment only |
| Add/remove bot token with open position | API                    | orphan position managed exit-only           |
| Cross-user order access                 | API                    | 404/403, no data leak                       |
| Idempotency replay                      | API                    | same response, no second write              |

### Test infrastructure

- Reuse the existing `apps/api/test` setup and `apps/e2e` helpers.
- Add deterministic swap preview/quote fixtures for the UI tests.
- Avoid real wallet signatures; mock the wallet boundary.
- Keep E2E database cleanup scoped to the test database.

### Prioritized tests from the coverage audit

Highest value and cheapest first:

1. `accounting.e2e.spec.ts` — manual sell above the selected group remaining → `INSUFFICIENT_LOTS`, no drift.
2. `accounting.e2e.spec.ts` — trade-group sell with the same idempotency key twice → one transaction, one remaining reduction, one audit row.
3. `accounting.e2e.spec.ts` — same idempotency key with a changed payload → documented first-write-wins behavior.
4. `auth.e2e.spec.ts` — CSRF matrix for `/transactions`, `/trade-groups/:id/sells`, `/swap/quote`, `/swap/build`, `/swap/orders/:id/submitted`.
5. `swap.e2e.spec.ts` — provider 429 maps to `SWAP_RATE_LIMITED`, provider called once, failures are not cached.
6. `swap.e2e.spec.ts` — repeated preview is served from the 15s cache; different amount/wallet reaches the provider.
7. `swap.spec.ts` (E2E) — on-chain ↔ manual tab switch preserves amount/account/notes.
8. `manual-flows.spec.ts` (E2E) — manual sell above remaining shows an inline error and writes nothing.
9. New portfolio E2E — a token in a second watchlist group has no `Купить` in `Основной список`.

Then:

- cancel signature returns `READY` and allows re-sign;
- executed output below `minOut` is accounted as executed, not quoted;
- `/portfolio/token-summaries` HTTP e2e;
- foreign/unknown group and swap order return 404;
- double-click manual save creates one transaction;
- all four operation tabs submit, including `Вывод`;
- first bot E2E: create from `Основная`, start, journal, stop/reset;
- `/swap/balances` RPC failure fallback.

### Helper work

Before adding many E2E tests, extract:

- `apps/api/test/helpers/owner.ts` — `csrfFrom` + `setupOwner`;
- `apps/api/test/helpers/swap-harness.ts` — Kyber/RPC mocks, `makeBuildData`, `swappedLog`;
- `apps/e2e/tests/helpers/owner.ts` — UI setup + CSRF + truncate;
- `apps/e2e/tests/helpers/seed.ts` — price, deposit, buy, group, watchlist, row count;
- `apps/e2e/tests/helpers/swap-mocks.ts` — config/preview/quote routes.

Also reset the swap preview cache in `beforeEach` so a 15s cached preview cannot leak between API tests.

## W3 — Observability

### Objective

Answer “is the system actually working?” without reading Railway logs.

### Proposed API

`GET /api/v1/settings/system-status` (owner-only, no caching).

Response groups:

```ts
{
  generatedAt: string;
  database: {
    ok: boolean;
    latencyMs: number;
  }
  quotes: {
    enabled: boolean;
    lastRefreshAt: string | null;
    ageSeconds: number | null;
    assetCount: number;
    staleCount: number;
    sources: Record<string, number>;
  }
  indexer: {
    lastRunAt: string | null;
    lastSuccessAt: string | null;
    lastError: string | null;
    pendingTransfers: number;
  }
  bots: {
    running: number;
    lastTickAt: string | null;
    failedBots: Array<{ id: string; name: string; error: string | null }>;
  }
  snapshots: {
    lastRunAt: string | null;
    lastError: string | null;
  }
  reconciliation: {
    lastRunAt: string | null;
    status: string | null;
    issues: number;
  }
  provider: {
    kyberRequests1h: number;
    kyber4291h: number;
    kyber5xx1h: number;
    lastErrorCode: string | null;
  }
}
```

### Data sources

- `market_quotes`, `assets`, `chains` for quote freshness.
- `external_api_calls` for Kyber 1h/24h counts.
- `trading_bots.last_tick_at`, `started_at`, `status`, `bot_events` for bot health.
- `portfolio_snapshots` for the last snapshot.
- `reconciliation_runs` / `reconciliation_items`.
- `indexed_transfers` / `watched_addresses`.
- `pg` health query.

If a field is missing in a table, return `null` and add a follow-up; do not block the page on a schema change.

### UI

Add `Settings → Состояние системы` (owner-only) or a compact “Система” card on the dashboard. Recommended first version: settings page with status cards and a refresh button. No external analytics.

Alerts:

- start with in-app notifications for repeated failures (e.g., quotes stale > 15 min, indexer error, bot stopped unexpectedly);
- no email/Telegram without a separate owner decision.

### Acceptance criteria

- Status page works when some subsystems are disabled.
- Freshness fields match production data within one interval.
- No secrets, RPC URLs or raw provider bodies are exposed.
- Endpoint is owner-only and not public like `/health`.

## W4 — Data quality / reconciliation

### Objective

Replace the hidden `dashboard/data-quality` fragment with a useful read-only report and a queue of concrete records.

### Proposed API

Extend `GET /api/v1/dashboard/data-quality` or add `GET /api/v1/settings/data-quality`. Prefer extending the existing endpoint to avoid a second source of truth.

Issue shape:

```ts
{
  code: string;
  label: string;
  severity: 'info' | 'warning' | 'error';
  count: number;
  details: string[];
  sampleIds?: string[];
  href?: string;
}
```

### Checks for the first version

- trade group without lots;
- lot without trade group;
- lot remaining amount > original amount;
- group remaining amount mismatch vs lots;
- negative wallet balance;
- confirmed swap without accounting transaction;
- failed swap with accounting transaction;
- duplicate import row / duplicate source id;
- transaction without postings;
- orphan bot position (asset no longer in `bot_tokens`);
- missing/stale price;
- unverified asset or unknown chain/contract;
- unreconciled transaction.

### UI

`Settings → Качество данных` or `Dashboard → Качество данных`:

- severity summary;
- grouped issues;
- first 20 examples with links to the order/transaction/bot;
- “Проверить снова” button;
- no auto-fix in phase 1.

### Later safe actions

Only if approved:

- relink a swap to an accounting transaction;
- mark a duplicate import row;
- recalculate a cached remain value.

Never rewrite ledger postings or delete transactions. Any correction is a new transaction with an audit reason.

### Acceptance criteria

- Read-only queries do not mutate data.
- Empty state is clear.
- Query cost is bounded (indexes, limits, counts).
- Owner-only access.

## W5 — TradeIntent

### W5A — service layer without schema

Create a `TradeIntentService` in the accounting module that wraps:

- manual buy/sell → `LedgerService.createManual`;
- swap quote/build/submit/close → `SwapService`;
- common policy validation;
- common idempotency key;
- common audit metadata: `kind`, `channel`, `source`, `intentId`.

Existing tables remain the storage:

- `swap_orders` for on-chain;
- `transactions`/`trade_groups` for manual.
- The audit log and `swap_events` get the shared metadata.

Acceptance:

- both channels produce the same validation result for the same asset/group/amount;
- a single request id is traceable across UI → API → audit → swap/transaction;
- no schema change.

### W5B — `trade_intents` table (optional)

Only if W5A needs cross-channel resumable state, a unified journal, or a single status endpoint.

Proposed columns:

- `id`, `user_id`, `kind`, `channel`, `source`,
- `status`, `asset_id`, `trade_group_id`,
- `amount`, `quote_asset_id`, `quote_amount`,
- `idempotency_key` (unique per user),
- `swap_order_id`, `transaction_id`,
- `error_code`, `error_message`, `metadata jsonb`,
- `created_at`, `updated_at`, `expires_at`.

State machine:
`draft → quoted → submitted → confirmed | failed | cancelled`.

This requires:

- ADR;
- additive migration with `nexter_app` grants;
- encrypted backup + restore check;
- no backfill of historical rows by default;
- a feature flag to write intents while old flows remain readable.

## Production safety

- Every schema change: ADR, additive migration, verified backup, rollback SQL.
- Every PR: format, typecheck, lint, tests, build, CI E2E.
- No production data mutation without explicit owner approval.
- Feature flags for W5B and any new write path.
- No secrets in code, logs or status payloads.

## Definition of done

- W1: policy rules covered by API tests; UI error messages mapped.
- W2: the scenario matrix above is green in CI.
- W3: owner-only status page with quote/indexer/bot/provider health.
- W4: read-only data-quality report with actionable examples.
- W5A: unified validation/audit path without schema.
- W5B: only if approved, with ADR, migration, backup and rollback.

## Open decisions

1. W1: should `sell` without `tradeGroupId` be rejected for all new API calls, or only for the UI? Recommended: reject for new manual sells; keep an explicit import/admin path if needed.
2. W3: alerts only in-app for now? Recommended: yes.
3. W4: confirm no auto-fixes in phase 1. Recommended: yes.
4. W5B: start with W5A and decide on the table after seeing the gaps. Recommended: yes.
