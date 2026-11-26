# ADR 0093 — Recover a swap when the wallet loses the transaction response

Status: accepted, 2026-11-26.

## Context

A production POP buy broadcast successfully (`0xfc69a3…9eb1`, status `0x1`, exact order calldata) but WalletConnect never resolved `eth_sendTransaction`. The API never received the hash, so order `fa105e26…` stayed in `AWAITING_SIGNATURE` with `tx_hash = null`; the UI stayed on “Ожидаю ответ кошелька” / “Подписываю…”.

The transaction and the order matched exactly: same wallet, router, calldata, block and token movements. Only the JSON-RPC response was lost. WalletConnect has a known failure mode where a request can hang after the wallet has already approved and broadcast it.

The existing `POST /swap/orders/:id/submitted` endpoint already accepts a hash for `AWAITING_SIGNATURE` and built `EXPIRED` orders, verifies it through tracking and writes the audit/event chain. The missing part was a UI that survives a lost response and a way to reach an order after the drawer is closed.

## Decision

1. Track every wallet transaction request with a 90-second stall signal. The wallet request is **not cancelled** and the order is **not** returned to `READY`; a late wallet response still wins.
2. On a stall, both trade drawers show a manual transaction-hash field. A valid `0x` + 64 hex hash is passed to the existing submit path; for an approval, the flow continues through approval submission, receipt wait, `ready` and swap signing.
3. Add a compact `Незавершённые свопы` panel to `Крипта → Ордера`. It lists `AWAITING_SIGNATURE` orders without a hash from the last 7 days, links to the wallet history in BscScan/Etherscan and lets the owner attach the hash.
4. Do not auto-retry, re-sign or create a second transaction. Do not create ledger rows from a pasted hash; tracking verifies the on-chain transaction first.
5. The close/exchange drawer now also sends the buffered `gasLimit` returned by the API. That path was missed by ADR 0092.

## Consequences

- A lost WalletConnect response no longer blocks the UI forever; the owner can recover a broadcast swap from the wallet history.
- The order remains `AWAITING_SIGNATURE` until a hash is attached, so it is visible in the recovery panel.
- A hash that arrives late is still submitted automatically. Once a manual hash settles the request, a late wallet response is ignored, so only one submit path runs.
- No schema migration. Existing orders remain readable. Rollback is the previous image.
- The recovery panel only looks back 7 days; older stalled orders remain in the database and can be handled by a separate audited operation if needed.
