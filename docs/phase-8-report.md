# Phase 8 — Swap Execution Report

Date: 2026-11-04

Status: **in progress — execution backend slice implemented; WalletConnect/Tangem, tracking, accounting, and security review pending.**

## Scope

Phase 8 is scoped by ADR `0010-phase-8-swap-execution.md`:

- WalletConnect v2 + Tangem signing;
- exact ERC-20 approvals;
- step-up TOTP over $500;
- submission and worker tracking;
- confirmed-swap accounting;
- failure/replaced/dropped handling.

## Implemented slice

- WalletConnect v2 connection UI on `/swap` using the public `WALLETCONNECT_PROJECT_ID` (QR/modal, BSC chain check, address display, disconnect). Signing remains disabled until the remaining gates.
- `GET /swap/config` exposes `walletConnectProjectId` and `buildEnabled` (requires wallet + selector allowlists).

- Migration `0010_careless_pet_avengers.sql` plus hardening migration `0011_closed_namor.sql` (additive):
  - `sessions.step_up_until`;
  - `token_approvals`;
  - swap execution fields: `account_id`, `tx_hash`, `amount_in_usd`, `nonce`, `deadline`, `confirmations`, `block_number`, `network_fee_wei`, `network_fee_usd`, `accounting_transaction_id`, `trade_group_id`, submitted/confirmed timestamps;
  - unique partial indexes on tx hashes and active approvals.
- `POST /auth/step-up` — verifies a current TOTP, sets a 5-minute `stepUpUntil` on the session, uses the existing 2FA throttle, and audits success/failure. The step-up helper fails closed when the input USD value is missing/invalid; quotes now require a valid provider `amountInUsd` and store it on the order.
- `POST /swap/build` now requires a fresh step-up when the quote input value exceeds `SWAP_STEP_UP_THRESHOLD_USD` (default $500).
- `POST /swap/orders/:id/submitted` — validates ownership, `BUILT` state, tx hash, and step-up; records `SUBMITTED`, event, and audit.
- `POST /swap/approvals/build` — exact-amount ERC-20 approval calldata, spender/router allowlist, allowance check, deadline check, wallet allowlist, RPC simulation, audit; native token and already-sufficient allowance paths rejected.
- `GET /swap/approvals` and `POST /swap/approvals/:id/submitted`.
- Storage of an optional wallet account on quotes for future accounting.

## Review history

First slice review: **FAIL** — one High (step-up failed open on missing/numeric USD) and Mediums (approval DELETE privilege, hardcoded threshold, unpersisted deadline, allowlist re-check, unverified tx hashes/uniqueness, test gaps). Fixes applied: fail-closed centralized step-up helper with stored `amount_in_usd`, configurable threshold, deadline persistence, wallet/router re-checks, unique tx/approval indexes, token_approvals DELETE revoke, duplicate-approval handling, and expanded tests. Re-review pending. Unverified tx-hash/correction remains a tracking-slice gate.

## Deferred until tracking slice

- Client-submitted tx hashes are format/owned/state checked and unique, but on-chain `eth_getTransactionByHash` verification and a correction path are implemented in the tracking slice before signing is enabled.
- Full calldata ABI decoding (recipient/deadline/minOut), balance/gas caps, and `APPROVAL_REQUIRED`/`READY` transitions remain before signing.
- WalletConnect/Tangem UI, worker tracking, and accounting are not enabled yet.

## Not yet implemented

- Tangem signing and the full execution UI (connection is implemented; signing disabled).
- Full calldata ABI decoding for recipient/deadline/minOut before signing.
- Worker `swap-track` receipt/confirmation/replaced/dropped handling.
- Confirmed-swap accounting, FIFO consumption, gas postings, and trade-group links.
- Execution UI, step-up prompt, and approval/sign flows.
- Live Tangem acceptance and security review for this slice.

## Verification

- Typecheck, lint, format:check, build — pass.
- API suite — **85 passed, 1 skipped** (adds step-up, exact approval, approval submission, order submission, fail-closed USD, allowlist re-checks, duplicate approval handling, deadline persistence, and step-up unit coverage).
- Playwright — **5 passed** (Phase 7 read-only UI unaffected).
- Migrations 0010/0011 apply cleanly to the disposable PostgreSQL database. The app role denies DELETE on `token_approvals` (verified locally).

## Next

1. Implement full calldata decoding and allowance/balance gates.
2. Implement worker tracking and confirmed-swap accounting.
3. Add WalletConnect/Tangem UI (requires `VITE_WALLETCONNECT_PROJECT_ID`).
4. Security review, live small-value Tangem acceptance, then Phase 8 acceptance.
