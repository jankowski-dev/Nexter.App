# Phase 8 — Swap Execution Report

Date: 2026-11-04

Status: **in progress — execution backend, WalletConnect/Tangem, calldata verification, tracking, and confirmed-swap accounting implemented; execution UI/signing, final review, and live Tangem acceptance pending.**

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
- CSP now allowlists the WalletConnect relay/AppKit origins (`connect-src` and `frame-src`); without them the QR modal opens but never receives a pairing URI.
- `GET /swap/config` exposes `walletConnectProjectId` and `buildEnabled` (requires wallet + selector allowlists).
- Router-level calldata decoding with viem: verifies tokens, recipient, input amount, minimum output, executor, approve target, source receivers, fees, permit and partial-fill flags before `BUILT`.
- Correct selector mapping: `0xe21fd0e9` = `swap`, `0x59e50fed` = `swapGeneric`; both are supported and must be allowlisted.
- `SWAP_EXECUTOR_ALLOWLIST` with the BSC AggregationExecutorProxy default.
- Simple-mode calldata is rejected until `firstPools`/`destTokenFeeData` can be validated; standard routes use the server-enforced order deadline and submit rejects after expiry.
- API-hosted tracking poller: `eth_getTransactionByHash` verification, receipt/confirmations, replaced/dropped, pre-accounting reorg handling, actual gas capture, and actual spent/return amounts from the router `Swapped` event.
- Confirmed-swap accounting through the existing ledger: trade/swap transaction, postings, FIFO consumption, output lot, gas posting, trade group, `source=kyberswap`, idempotent by tx hash, using the actual on-chain amounts rather than quote amounts.
- Accounting prerequisites: the wallet must already hold the input token and BNB for gas in the ledger; negative balances fail closed and retry after reconciliation.

- Migrations `0010` + `0011` (execution/approvals) and `0012` (executed amounts), all additive:
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

Tracking/accounting review: **FAIL** — one High: cash-equivalent output USD from the quote could mismatch the actual amount after rounding, leaving USDC-output swaps unaccounted. Fixed by deriving cash-leg USD from actual on-chain amounts; USDC-output regression test added. Re-review pending.

Calldata slice review: **PASS WITH CHANGES** — simple-mode pool/fee validation gap and deadline upper bound fixed by rejecting simple mode; selector/executor docs corrected; real-tx fixture and swapGeneric e2e added. Zero-allowance approval sequencing remains an execution-slice gate.

First slice review: **FAIL** — one High (step-up failed open on missing/numeric USD) and Mediums (approval DELETE privilege, hardcoded threshold, unpersisted deadline, allowlist re-check, unverified tx hashes/uniqueness, test gaps). Fixes applied: fail-closed centralized step-up helper with stored `amount_in_usd`, configurable threshold, deadline persistence, wallet/router re-checks, unique tx/approval indexes, token_approvals DELETE revoke, duplicate-approval handling, and expanded tests. Re-review: **PASS**; merged as `9d57f43`. Unverified tx-hash/correction remains a tracking-slice gate.

## Deferred until execution slice

- Client-submitted tx hashes are now verified against `eth_getTransactionByHash`; a user-facing correction path for a mistyped hash remains a later slice (tracking marks a mismatch `FAILED` and never creates accounting).
- Balance/gas caps and `APPROVAL_REQUIRED`/`READY` transitions remain before signing.
- Zero-allowance ERC-20 builds currently fail simulation before an approval can be built; the execution slice must set `APPROVAL_REQUIRED`/allowance gates before signing.
- WalletConnect/Tangem connection and tracking/accounting are implemented; signing and the execution UI are not enabled yet.

## Not yet implemented

- Tangem signing and the full execution UI (connection is implemented; signing disabled).
- Post-accounting reorg compensation (append-only correction), if a deep reorg occurs.
- Step-up/approval/sign prompts and a mistyped-tx correction flow.
- Live Tangem signing acceptance and final Phase 8 security review.

## Verification

- Typecheck, lint, format:check, build — pass.
- API suite — **102 passed, 1 skipped** (adds step-up, exact approval, approval submission, order submission, fail-closed USD, allowlist re-checks, duplicate approval handling, deadline persistence, calldata decode/validation, tracking/confirmation/replaced/reorg paths, accounting idempotency, and step-up unit coverage).
- Playwright — **5 passed** (swap connection/quote UI included).
- Migrations 0010/0011/0012 apply cleanly to the disposable PostgreSQL database. The app role denies DELETE on `token_approvals` (verified locally).

## Next

1. Implement balance/gas gates and the `APPROVAL_REQUIRED`/`READY` transitions.
2. Add the execution UI (build preview, approval, step-up prompt, signing) on top of the existing WalletConnect connection.
3. Run live Tangem signing acceptance and the final Phase 8 security review.
4. Security review, live small-value Tangem acceptance, then Phase 8 acceptance.
