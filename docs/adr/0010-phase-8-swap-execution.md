# ADR 0010 — Phase 8 swap execution

## Status

Accepted for Phase 8.

## Context

Phase 7 delivered the non-custodial quote/build/simulate foundation. Phase 8 adds the execution path: WalletConnect/Tangem signing, exact ERC-20 approvals, step-up TOTP, transaction submission/tracking, and accounting integration.

The server still never stores seed phrases, private keys, or signing keys. The browser wallet (Tangem via WalletConnect) signs every transaction; the server builds, validates, and tracks it.

## Decision

### Scope

Phase 8 delivers:

- WalletConnect v2 connection from the web app to Tangem on BSC;
- exact-amount ERC-20 approval build and submission tracking;
- step-up TOTP for swaps whose input USD value exceeds $500;
- `POST /swap/orders/:id/submitted` and worker tracking;
- confirmed-swap accounting: transaction, postings, FIFO consumption, new lot, gas, and trade-group link;
- failure/replaced/dropped handling with no accounting transaction;
- kill switch and the Phase 7 allowlists remain mandatory.

Out of scope: Ethereum, unattended trading, hot wallets, seed phrases, and tax logic beyond the accepted FIFO accounting.

### Execution state machine

`QUOTED → BUILT → APPROVAL_REQUIRED → READY → AWAITING_SIGNATURE → SUBMITTED → PENDING → CONFIRMED | FAILED | REPLACED | DROPPED | EXPIRED | CANCELLED`

- `BUILT` means calldata is validated and simulated.
- `APPROVAL_REQUIRED` is used only when the token allowance is insufficient.
- `READY` means allowance and balance are sufficient and the order is ready to sign.
- `AWAITING_SIGNATURE` is set by the client immediately before opening the wallet.
- `SUBMITTED` is set after a tx hash is recorded; `PENDING` after the worker sees a receipt; `CONFIRMED` after 15 BSC confirmations.
- `FAILED`/`REPLACED`/`DROPPED` never create accounting transactions.

### Wallet and signing

- Frontend uses WalletConnect v2 with `VITE_WALLETCONNECT_PROJECT_ID`; no Project ID means the connect/build/sign UI is disabled.
- The client requests chainId 56 and refuses to sign on any other chain.
- The device must display and confirm the router, recipient, amount, and minimum output. The server does not sign.
- `SWAP_WALLET_ALLOWLIST` must contain the connected address; server-side build rejects any other address.
- Full calldata decoding (recipient, deadline, minOut) is implemented before `READY`; Phase 7 only validated router/selector/value/amount/minOut/simulation.

### Step-up TOTP

- Add `sessions.step_up_until`.
- `POST /auth/step-up` accepts a current TOTP code, verifies it with the existing TOTP service, and sets a 5-minute step-up window on the current session.
- Build and submit require a fresh step-up when the order's `amountInUsd > 500`; the threshold is configurable (`SWAP_STEP_UP_THRESHOLD_USD`, default 500).
- Step-up attempts use the existing 2FA throttle; every success/failure is audited.
- The UI prompts for a TOTP code only when the threshold is crossed.

### Approvals

- Add `token_approvals` with owner, chain, wallet, token, spender, exact base-unit amount, status, tx hash, block, timestamps.
- `POST /swap/approvals/build` accepts an order id; native-token inputs do not need approval.
- The server emits `approve(spender, exactAmount)` calldata, validates the spender is the allowlisted router, simulates it, and never emits an unlimited approval.
- `POST /swap/approvals/:id/submitted` records a tx hash and moves the approval to `SUBMITTED`; the worker tracks it.
- USDT-style allowance-reset behavior is handled by approving the exact required amount; a zero-then-exact flow is only used if the provider/contract requires it and is recorded as two events.

### Submission and tracking

- `POST /swap/orders/:id/submitted` accepts a BSC tx hash, verifies order ownership/state/allowlists/step-up, and records `SUBMITTED` + event + audit.
- Worker job `swap-track` polls the receipt with backoff, waits for 15 confirmations, records actual gas, and detects replaced/dropped txs.
- Mempool replacement: a different tx hash for the same nonce marks `REPLACED`; dropped nonce marks `DROPPED`.
- Reorgs: confirmation count is recomputed; a reorged tx returns to `PENDING`.
- A failed receipt marks `FAILED`; no accounting.
- Confirmation creates exactly one accounting transaction; retries are idempotent by `swap_order_id`/tx hash.

### Accounting

On confirmed swap:

- transaction type `trade`, subtype `swap`, source `kyberswap`, `sourceId = tx hash`;
- postings: wallet tokenIn −amount, External +amount, wallet tokenOut +amount, External −amount, gas BNB −fee/External +fee;
- consume FIFO lots for tokenIn (if non-cash);
- create a trade group and a lot for tokenOut (if non-cash) with cost basis = tokenIn USD + gas (subject to `includeGasInCostBasis`);
- record `network_fee_wei`/`network_fee_usd`, `accounting_transaction_id`, `trade_group_id`;
- link `swap_orders` to the transaction; idempotency by order id.

Failure/replaced/dropped never creates a transaction.

### Persistence

Migration `0010` adds:

- `sessions.step_up_until`;
- `token_approvals`;
- swap execution fields: `account_id`, `tx_hash`, `nonce`, `deadline`, `submitted_at`, `confirmed_at`, `block_number`, `confirmations`, `network_fee_wei`, `network_fee_usd`, `accounting_transaction_id`, `trade_group_id`.

Additive only.

### Security gates

- exact approvals; no unlimited;
- full calldata decode/recipient/deadline/minOut before READY;
- chain 56 and wallet allowlist;
- quote TTL and fee/gas caps;
- step-up TOTP over $500;
- kill switch;
- no private keys/seed phrases server-side;
- idempotent submission/tracking/accounting;
- all mutations audited;
- provider/RPC errors bounded and never include secrets.

### Rollback

- Disable `SWAP_KILL_SWITCH=true`; no new build/submit.
- Existing submitted transactions continue to be tracked by the worker; do not delete orders or accounting rows.
- If accounting is wrong, append a compensating transaction; never edit the ledger.
- Revert the application image to the previous release; migration 0010 is additive.

## Consequences

- Phase 8 is split into reviewable slices: step-up/approvals/submit, tracking, accounting, and WalletConnect UI.
- Tangem manual acceptance is required for the final exit.
- No server component can move funds without a device signature.
