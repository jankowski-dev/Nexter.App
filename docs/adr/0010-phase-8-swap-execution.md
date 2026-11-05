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
- `POST /swap/orders/:id/submitted` and API-hosted tracking;
- confirmed-swap accounting: transaction, postings, FIFO consumption, new lot, gas, and trade-group link;
- failure/replaced/dropped handling with no accounting transaction;
- kill switch and the Phase 7 allowlists remain mandatory.

Out of scope: Ethereum, unattended trading, hot wallets, seed phrases, and tax logic beyond the accepted FIFO accounting.

### Execution state machine

`QUOTED → BUILT → APPROVAL_REQUIRED → READY → AWAITING_SIGNATURE → SUBMITTED → PENDING → CONFIRMED | FAILED | REPLACED | DROPPED`; `EXPIRED → SUBMITTED` is allowed for a signed hash recovery; `CANCELLED` from pre-submit states.

- `BUILT` means calldata is validated and simulated.
- `APPROVAL_REQUIRED` is used only when the token allowance is insufficient.
- `READY` means allowance and balance are sufficient and the order is ready to sign.
- `AWAITING_SIGNATURE` is set by the client immediately before opening the wallet.
- `SUBMITTED` is set after a tx hash is recorded; `PENDING` after the API tracker sees a receipt; `CONFIRMED` after 15 BSC confirmations.
- `FAILED`/`REPLACED`/`DROPPED` never create accounting transactions.

### Wallet and signing

- Frontend uses WalletConnect v2 with the public `WALLETCONNECT_PROJECT_ID` returned by `GET /swap/config`; no Project ID means the connect/build/sign UI is disabled.
- The client requests chainId 56 and refuses to sign on any other chain.
- The device must display and confirm the router, recipient, amount, and minimum output. The server does not sign.
- `SWAP_WALLET_ALLOWLIST` must contain the connected address; server-side build rejects any other address.
- Router-level calldata decoding is implemented before `BUILT`: source/destination tokens, recipient, input amount, minimum output, executor, approve target, source receivers, fees, permit and partial-fill flags are verified against the quote. Phase 7 only validated router/selector/value/amount/minOut/simulation.

### Step-up TOTP

- Add `sessions.step_up_until`.
- `POST /auth/step-up` accepts a current TOTP code, verifies it with the existing TOTP service, and sets a 5-minute step-up window on the current session.
- Build, approval build, ready, and signing require a fresh step-up when the order's `amountInUsd > SWAP_STEP_UP_THRESHOLD_USD` (default 500). A missing/invalid USD value fails closed and requires step-up; quotes require a valid provider `amountInUsd` and store it on the order. Submit only records a hash for an already-signed order and does not require a fresh step-up.
- Step-up attempts use the existing 2FA throttle; every success/failure is audited.
- The UI prompts for a TOTP code only when the threshold is crossed.

### Approvals

- Add `token_approvals` with owner, chain, wallet, token, spender, exact base-unit amount, status, tx hash, block, timestamps.
- `POST /swap/approvals/build` accepts an order id; native-token inputs do not need approval.
- The server emits `approve(spender, exactAmount)` calldata, validates the spender is the allowlisted router, simulates it, and never emits an unlimited approval.
- `POST /swap/approvals/:id/submitted` records a tx hash and moves the approval to `SUBMITTED`; the API tracker confirms/fails it.
- USDT-style allowance-reset behavior is handled by approving the exact required amount; a zero-then-exact flow is only used if the provider/contract requires it and is recorded as two events.

### Calldata verification and selectors

Kyber MetaAggregationRouterV2 exposes two reviewed functions with the same tuple shape:

- `swap` — selector `0xe21fd0e9` (the function used by the aggregator API);
- `swapGeneric` — selector `0x59e50fed` (whitelisted-executor variant).

Both selectors must be in `SWAP_SELECTOR_ALLOWLIST`; an allowlist containing only `0x59e50fed` rejects normal Kyber builds. The decoder verifies `srcToken`/`dstToken`, `dstReceiver` (must equal the connected wallet), `amount` (must equal the quoted base-unit input), `minReturnAmount` (must be between the quoted minimum and quoted output), `callTarget` (executor allowlist), `approveTarget` (zero, router, or executor), source receivers/amounts (must total the input and point only at the allowed executor), empty fee arrays, empty permit, and no partial-fill flag.

`SWAP_EXECUTOR_ALLOWLIST` defaults to the BSC AggregationExecutorProxy `0x8F10B468b06c6FD214B65F87778827F7D113f996`.

Simple mode (`flags & 0x20`) is rejected: its `firstPools` and `destTokenFeeData` would require a pool allowlist or recursive executor decoding, so accepting it would let a malicious provider divert input/output within the slippage bound. Standard `swap`/`swapGeneric` routes are supported.

Deadline handling is explicit:

- normal aggregator calldata has no router-level deadline (the deadline lives inside nested executor/DEX calls), so the server-enforced `swap_orders.deadline` is authoritative for new signing; an already-signed hash can still be recorded after it;
- the execution UI must show this deadline and the wallet must confirm before signing; a transaction already signed by the wallet cannot be invalidated server-side.

This is a deliberate limit: the server verifies the fields that determine recipient and minimum output and relies on the allowlisted executor for nested route semantics. Full recursive decoding of every DEX executor call is out of scope.

### Execution UI and allowance gate

- Build checks the wallet balance and token allowance. Insufficient balance fails closed with `SWAP_INSUFFICIENT_BALANCE`.
- For an ERC-20 input with insufficient allowance, build stores the validated calldata and enters `APPROVAL_REQUIRED` instead of failing simulation; the response exposes `approvalRequired`, `allowance`, and a null `simulation`.
- `POST /swap/orders/:id/ready` re-checks balance, allowance, deadline, wallet/router allowlists, step-up and simulation; it moves `APPROVAL_REQUIRED`/`BUILT` to `READY` or returns `SWAP_APPROVAL_REQUIRED`. It does not clear `AWAITING_SIGNATURE`.
- Submit accepts `BUILT`, `READY`, `AWAITING_SIGNATURE`, or a built `EXPIRED` order as signed-hash recovery. `POST /signing` sets the short-lived signing lock; `/signing/cancel` releases it without requiring the kill switch.
- Signing is browser-side through WalletConnect/Tangem. The UI builds, prepares an exact approval, waits for the approval receipt, calls `ready`, marks `AWAITING_SIGNATURE`, signs the swap, and submits the hash. Approval submission is tracked server-side (confirmed/failed/timeout).
- `SWAP_EXECUTION_ENABLED` (default false) is exposed as `executionEnabled`; the UI hides signing until the owner enables it after review/manual acceptance. Build and approval preparation remain available for verification.

### Submission and tracking

- `POST /swap/orders/:id/submitted` accepts a BSC tx hash for an already-signed `BUILT`/`READY`/`AWAITING_SIGNATURE`/`EXPIRED` order, verifies ownership/state, and records `SUBMITTED` + event + audit. It is a recovery path and is allowed during a kill switch/execution disable; tracking verifies the tx.
- An API-hosted `SwapTrackingService` poller (in-process tick guard, conditional status updates) polls the receipt, waits for the configured confirmations, records actual gas, and detects replaced/dropped txs. The ledger's per-user advisory lock and `source/sourceId` idempotency prevent duplicate accounting. The worker remains reserved for future decoupling.
- Mempool replacement: a different tx hash for the same nonce marks `REPLACED`; dropped nonce marks `DROPPED`.
- Reorgs before accounting are detected by re-checking the receipt and confirmation count; the order returns to `PENDING` (or `FAILED` if the receipt reverted). A reorg after accounting is outside this slice; 15 confirmations make it unlikely, and any correction must be an append-only compensating transaction in a later slice.
- A failed receipt marks `FAILED`; no accounting.
- Confirmation creates exactly one accounting transaction; retries are idempotent by `(user, source=kyberswap, sourceId=tx hash)` under the ledger's per-user advisory lock. Tracking starts whenever `BSC_RPC_URL` is configured, independent of `SWAP_ENABLED`.
- Cash-equivalent legs derive USD from the actual on-chain amount; non-cash legs scale the quote USD by actual `Swapped` amounts. Confirmed orders are retried with a 60-second accounting backoff and no 24-hour cutoff.

### Accounting

On confirmed swap:

- transaction type `trade`, subtype `swap`, source `kyberswap` (contract enum), `sourceId = tx hash`;
- postings: wallet tokenIn −amount, External +amount, wallet tokenOut +amount, External −amount, gas BNB −fee/External +fee;
- consume FIFO lots for tokenIn (if non-cash);
- create a trade group and a lot for tokenOut (if non-cash) with cost basis = tokenIn USD + gas (subject to `includeGasInCostBasis`);
- record `network_fee_wei`/`network_fee_usd`, `accounting_transaction_id`, `trade_group_id`;
- link `swap_orders` to the transaction; idempotency by `(user, source=kyberswap, sourceId=tx hash)`.

Failure/replaced/dropped never creates a transaction.

### Persistence

Migrations `0010`, `0011`, and `0012` add:

- `sessions.step_up_until`;
- `token_approvals`;
- swap execution fields: `account_id`, `tx_hash`, `amount_in_usd`, `executed_amount_in`, `executed_amount_out`, `nonce`, `deadline`, `submitted_at`, `confirmed_at`, `block_number`, `confirmations`, `network_fee_wei`, `network_fee_usd`, `accounting_transaction_id`, `trade_group_id`;
- unique partial indexes on non-null tx hashes and active approvals.

Additive only.

### Security gates

- exact approvals; no unlimited;
- router-level calldata decode/recipient/amount/minOut before BUILT;
- chain 56 and wallet allowlist;
- quote TTL and fee/gas caps;
- step-up TOTP over $500;
- kill switch and `SWAP_EXECUTION_ENABLED`; gas cap (`SWAP_MAX_GAS_USD`);
- no private keys/seed phrases server-side;
- idempotent submission/tracking/accounting;
- all mutations audited;
- provider/RPC errors bounded and never include secrets.

### Rollback

- Disable `SWAP_KILL_SWITCH=true`; no new build/submit.
- Existing submitted transactions continue to be tracked by the API `SwapTrackingService`; do not roll back to a pre-Phase-8 image until active/unaccounted orders are drained, or keep a Phase 8 image running. Do not delete orders or accounting rows.
- If accounting is wrong, append a compensating transaction; never edit the ledger.
- Revert the application image to the previous release; migration 0010 is additive.

## Consequences

- Phase 8 is split into reviewable slices: step-up/approvals/submit, tracking, accounting, and WalletConnect UI.
- Tangem manual acceptance is required for the final exit.
- No server component can move funds without a device signature.
