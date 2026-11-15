# ADR 0051 — Server-side trade policy

## Status

Accepted for UI-61/W1 on 2026-11-15. No migration.

## Context

UI-59 established the product rule that a buy order is created only from `Купить` in the main token list and a close order only from an active order. That rule lived in React; the API still accepted manual buys for any asset and manual sells without a trade group.

The policy audit found:

- manual buys had no default-watchlist check;
- manual sells without `tradeGroupId` used global FIFO and could consume unrelated groups;
- closed/foreign groups were checked in different places with different codes;
- oversell was only detected later by `INSUFFICIENT_LOTS`;
- account/asset chain mismatch was detected after posting planning.

## Decision

Add `TradePolicyService` in the accounting module and call it from `LedgerService` before any write:

- **buy** (manual user path): the base asset must be an active entry in the user's default `Основная` watchlist group; otherwise `TRADE_ASSET_NOT_ALLOWED`. The quote must remain cash-equivalent. Internal on-chain accounting passes `sourceOverride` and keeps the swap allowlist path.
- **sell** (manual user path): `tradeGroupId` is required (`TRADE_GROUP_REQUIRED`). The group must belong to the user (`TRADE_GROUP_NOT_FOUND`), match the asset (`TRADE_GROUP_ASSET_MISMATCH`), be open (`TRADE_GROUP_CLOSED`), and the amount must not exceed the sum of lot remainders (`TRADE_AMOUNT_EXCEEDS_REMAINING`).
- **account/asset chain**: a wallet and both trade assets must be on the same chain (`TRADE_ACCOUNT_CHAIN_MISMATCH`).
- **on-chain tracking**: internal ledger writes with `sourceOverride` may omit `tradeGroupId`; swap close-group validation remains in `SwapService`.

New codes are added to the exception filter’s contract-code whitelist and to the Russian frontend error map.

## Consequences

- The API now enforces the main-list entry rule for manual buys, not only the UI.
- Existing internal/import flows can still use explicit system paths; the rule is for user-facing manual trades.
- Tests that created manual buys/sells now seed the default watchlist or attach a trade group.
- The global-FIFO manual sell remains only as an internal/system path; the UI always sends a group.
- No schema change.

## Verification

- New API test: buy from a second watchlist group is rejected; moving the asset to the default group allows it; oversell, missing group, unknown group and closed group are rejected.
- Existing accounting, swap and import flows remain green.
- `format:check`, `typecheck`, `lint`, web tests, API tests and build pass.

## Production release (2026-11-15)

Production release on 2026-11-15: PR #149 merged as `b1ce42e1`, deployment `eee5f492-5344-4b17-b8b1-bfd125e0f499`, bundle `assets/index-CtjhSgZd.js`, `/health` and `/ready` 200. No migration.
