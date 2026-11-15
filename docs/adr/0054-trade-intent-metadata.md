# ADR 0054 — Trade intent metadata without schema

## Status

Accepted for UI-61/W5A on 2026-11-15. No migration.

## Context

Manual trades and on-chain swaps wrote different audit shapes. A manual transaction had `source`/`sourceId` and an idempotency key; an on-chain swap had `swap_order.id` and `swap_events`, but there was no common intent identifier or channel/source vocabulary. A full cross-channel state machine needs a `trade_intents` table (W5B), but we can add a canonical trace layer first without schema.

## Decision

Add `TradeIntentService` in the accounting module, exported for the swap module.

- It produces a canonical context: `{ intentId, channel, kind, source }`.
- Manual transactions use `x-intent-id` when supplied, otherwise the idempotency key, otherwise a generated UUID. `x-trade-source` records the UI entry point (`main-list`, `order`, `operations`).
- `accounting.transaction_created` audit entries include `intentId`, `channel: 'manual'`, `kind` (buy/sell/swap/...), and `tradeSource`.
- On-chain swap audit entries include `intentId: swap_order.id`, `channel: 'onchain'`, `kind: 'swap'`, and `tradeSource: null` for now. The order id is the stable intent reference across quote/build/ready/signing/submit/cancel.
- `ManualOrderForm` sends `main-list` for buys and `order` for sells; `ManualOperationDialog` sends `operations`.

This is traceability and metadata only. It does not add persistent cross-channel state, reservations or a unified order table.

## Consequences

- Every audited manual transaction and swap has a compact intent envelope.
- The owner can follow a manual transaction by idempotency key or an on-chain order by its id.
- W5B remains the place for a `trade_intents` table, cross-channel status, expiry and resumable state. No schema change is made prematurely.
- Existing API contracts, ledger behavior and swap execution are unchanged.

## Verification

- Unit test for context creation/audit mapping.
- API e2e asserts `intentId`, `channel`, `kind` and `tradeSource` on a manual buy audit entry.
- `format:check`, `typecheck`, `lint`, web tests, API tests and build pass.
- No migration.
