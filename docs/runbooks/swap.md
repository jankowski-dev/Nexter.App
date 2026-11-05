# Swap Execution Runbook (Phase 9)

Phase 9 provides BSC and Ethereum WalletConnect connection, quotes, router-level calldata verification, exact approval build/submission, an execution UI, and tracking/accounting. The server never signs, broadcasts, or stores private keys/seed phrases. BSC signing is gated by `SWAP_EXECUTION_ENABLED`; Ethereum signing additionally requires `SWAP_ETHEREUM_EXECUTION_ENABLED=true`.

## Enable quotes

1. Set `SWAP_ENABLED=false` while configuring.
2. Set `WALLETCONNECT_PROJECT_ID` (public Reown/WalletConnect project id) for the `/swap` connection UI. The API CSP must keep the WalletConnect relay/AppKit origins in `connect-src`/`frame-src`; if the QR modal opens empty, check the browser console for CSP violations and the relay/WebSocket requests.
3. Set the provider:
   - `KYBERSWAP_API_KEY` and optionally `KYBERSWAP_BASE_URL=https://api.kyberswap.com/swap` (gateway), or
   - leave the key empty to use the public `https://aggregator-api.kyberswap.com` fallback.
4. Set `BSC_RPC_URL` and/or `ETHEREUM_RPC_URL` for build/simulation (quotes work without them). Prefer a private/MEV-protected Ethereum RPC for reads/simulation.
5. Set `SWAP_WALLET_ALLOWLIST` to the Tangem wallet address(es). An empty allowlist disables builds.
6. Set `SWAP_SELECTOR_ALLOWLIST=0xe21fd0e9,0x59e50fed` (`swap`, `swapGeneric`). An empty allowlist disables builds.
7. Optionally set per-chain `SWAP_BSC_*`/`SWAP_ETHEREUM_*` router/executor allowlists. Empty lists use the chain-specific Kyber defaults; the legacy `SWAP_ROUTER_ALLOWLIST`/`SWAP_EXECUTOR_ALLOWLIST` remain BSC-only.
8. Keep `SWAP_EXECUTION_ENABLED=false` until review and manual acceptance; BSC uses it as its execution gate. Ethereum also requires `SWAP_ETHEREUM_EXECUTION_ENABLED=true` after its own live acceptance. Set `SWAP_MAX_GAS_USD=5` (or a stricter cap).
9. Set `SWAP_STEP_UP_THRESHOLD_USD=500` unless a stricter local policy is required; set `SWAP_CONFIRMATIONS=15` (BSC default), `SWAP_ETHEREUM_CONFIRMATIONS=12`, `SWAP_TRACK_INTERVAL_SECONDS=15`, and `SWAP_DROP_TIMEOUT_SECONDS=1800` if a different policy is required.
10. Optionally override `SWAP_ROUTER_ALLOWLIST`; the default is the Kyber MetaAggregationRouterV2 address.
11. Run `node scripts/swap-live-check.mjs bsc` and/or `node scripts/swap-live-check.mjs ethereum` with the production RPC/key and confirm the chain id, router bytecode presence (not router identity), and a read-only quote.
12. Set `SWAP_ENABLED=true`, deploy/redeploy, and verify `GET /swap/config` plus one quote. The UI shows a disabled state until this is done.

## Kill switch

Set `SWAP_KILL_SWITCH=true` in Railway and redeploy (or restart) the API. New quotes/builds return `SWAP_DISABLED`; existing orders remain readable; `QUOTED`, `BUILT`, `APPROVAL_REQUIRED`, and `READY` orders can be cancelled, while an in-flight signature uses `signing/cancel`. Do not delete orders or edit events.

## Provider outage / rate limit

- `429` and `5xx` are retried twice. A 429 maps to `SWAP_RATE_LIMITED`; network/provider exhaustion maps to `SWAP_PROVIDER_UNAVAILABLE`; other provider failures map to `SWAP_QUOTE_FAILED`/`SWAP_BUILD_FAILED`.
- If the provider is degraded, enable the kill switch. Quotes are short-lived (15 s); `SWAP_EXECUTION_ENABLED` can also be disabled to hide signing. Submit remains available to record an already-signed hash; tracking verifies it. Use `POST /swap/orders/:id/signing/cancel` to release an in-flight signing lock.
- Check `external_api_calls` for status/latency; it contains no secrets or response bodies.

## Key rotation

- Rotate `KYBERSWAP_API_KEY` in Railway only; never commit it.
- `BSC_RPC_URL` may contain a provider token; rotate it in Railway and keep it out of logs/screenshots.
- The server has no signing keys. There is nothing to rotate for wallet custody.

## Allowlist changes

- Token addresses are code-owned and require review; do not add arbitrary tokens in production.
- Wallet/router/executor/selector allowlists are environment-owned. Changing them requires a redeploy and a new quote/build check. The application role must not have DELETE on swap tables, approvals, or events.
- Step-up TOTP is required above the configured threshold; the session window is five minutes. Missing/invalid provider USD fails closed.
- Calldata is decoded at router level before a build is accepted. Simple mode is rejected; standard aggregator routes use the server-enforced order deadline, which the execution UI must display before signing. New signing is blocked after the deadline; a signed hash can still be recorded.

## Ethereum (Phase 9)

- `ETHEREUM_RPC_URL` is required for Ethereum build/simulation/tracking; it may be a private/MEV-protected endpoint. Quotes use KyberSwap and can work without an RPC.
- Ethereum tokens are USDC (6 decimals), LINK, BASED, APR, and native ETH. Router/executor defaults are the deterministic Kyber addresses; if `SWAP_ROUTER_ALLOWLIST`/`SWAP_EXECUTOR_ALLOWLIST` are set, they must include every enabled chain.
- Ethereum signing requires both `SWAP_EXECUTION_ENABLED=true` and `SWAP_ETHEREUM_EXECUTION_ENABLED=true`. The flag defaults to false and should be enabled only for acceptance/rollout. The kill switch remains global.
- Ethereum confirmations default to `SWAP_ETHEREUM_CONFIRMATIONS=12`; BSC uses `SWAP_CONFIRMATIONS` or `SWAP_BSC_CONFIRMATIONS`.
- WalletConnect/Tangem broadcasts the signed transaction through the wallet. The server cannot enforce MEV protection on that broadcast; use a wallet/device flow the owner trusts, and a private RPC for server-side reads/simulation.
- Run `node scripts/swap-live-check.mjs ethereum` before enabling execution.

## Execution slice (Phase 8a)

- `POST /auth/step-up` sets a five-minute step-up window; builds, approval builds, ready, and signing above `SWAP_STEP_UP_THRESHOLD_USD` require it. Submit is recovery-only.
- Exact approvals use the router/spender allowlist; native inputs do not need approval; already-sufficient allowance returns 409.
- `POST /swap/orders/:id/submitted` records an already-signed hash even during a kill switch/execution disable; the API tracking poller verifies the swap transaction, tracks confirmations, and creates accounting on confirmation.
- `POST /swap/approvals/:id/submitted` records the approval hash; the tracker confirms/fails it. Approval-only hash recording is allowed while execution is disabled because it cannot move funds.
- Builds reject calldata whose recipient, tokens, amount, minOut, executor, approve target, receivers, fees, permit or partial-fill flags do not match the quote.
- Native gas preflight (`gasEstimate × eth_gasPrice`) fails closed when the native balance (BNB/ETH) is insufficient. The check covers swap gas only; a first-time approval needs additional native gas and can still fail at the approval step.
- `ready` re-decodes stored calldata and re-checks the current router, selector, recipient, token, amount, minOut, executor, approve-target, receiver, fee, permit and partial-fill allowlists. The stored build output (`built_amount_out`) is the upper bound for calldata `minReturnAmount`; legacy orders without it fall back to the stored quote output.
- Signing requires `READY`. A `BUILT` order must pass `POST /swap/orders/:id/ready` first; the UI exposes “Проверить готовность” for that transition.
- Insufficient ERC-20 allowance moves the order to `APPROVAL_REQUIRED`; `POST /swap/orders/:id/ready` re-checks allowance/simulation and moves it to `READY`. Signing is controlled by `SWAP_EXECUTION_ENABLED` (and `SWAP_ETHEREUM_EXECUTION_ENABLED` for Ethereum) plus the kill switch.
- `POST /swap/orders/:id/submitted` records an already-signed hash even during a kill switch/execution disable; it does not create accounting, and tracking verifies the tx.
- The tracker is API-hosted and production must run a single API replica (or add a future leader lock). Do not roll back to a pre-Phase-9 image while any BSC or Ethereum order is active/unaccounted.
- Simple mode (`flags & 0x20`) is rejected until `firstPools`/`destTokenFeeData` can be validated. Some Kyber routes using pool `srcReceivers` may also be rejected; this is intentional fail-closed behavior.
- A first-time ERC-20 swap with zero allowance enters `APPROVAL_REQUIRED`; after the exact approval, `POST /swap/orders/:id/ready` re-checks and moves it to `READY`.
- Confirmed-swap accounting requires the wallet's input token and native gas balance (BNB/ETH) to exist in the ledger. A negative balance is recorded as `SWAP_ACCOUNTING_NEGATIVE_BALANCE` and retried every 60 seconds after reconciliation; it is never silently forced.
- Cash-equivalent legs derive USD from the actual on-chain amount; non-cash legs scale the quote USD by the actual `Swapped` amounts.
- Tracking starts whenever either `BSC_RPC_URL` or `ETHEREUM_RPC_URL` is configured, even if `SWAP_ENABLED=false`, so in-flight transactions continue to confirm and account during a rollback.
- Replacement/speed-up handling: when the original hash is missing and a nonce is known, the tracker searches for a same-nonce candidate in the last `SWAP_REPLACEMENT_LOOKBACK_BLOCKS` blocks (default 240). If none is found, the order stays active with `SWAP_REPLACEMENT_NOT_FOUND`; there is deliberately no content fallback to a different nonce, because a different nonce cannot be the same signed transaction. If the nonce is unknown, it searches only blocks at/after the submission time (minus a 2-minute grace) for sender + router + calldata + value; an exact external replay mined inside that short grace is an accepted residual, and the tx-hash/ambiguity guards still apply. A unique matching transaction is adopted (hash/nonce updated, event/audit written); a found-but-mismatched same-nonce transaction is marked `REPLACED` only after its receipt reaches the chain's confirmation threshold; a pending mismatched candidate records `SWAP_REPLACEMENT_PENDING` and stays active; terminal writes are guarded by the original tx hash, so a concurrent adoption cannot be overwritten. Ambiguous/no matches record `SWAP_REPLACEMENT_AMBIGUOUS` / `SWAP_REPLACEMENT_NOT_FOUND`. A missing replacement never terminally drops an executed swap.
- At current BSC sub-second block times, 240 blocks is only a few minutes, not hours. If the tracker was down longer than the lookback, keep the order active, use an independent explorer/RPC to locate the executed transaction, verify sender/router/calldata/value and nonce, and attach the verified hash through a reviewed operator action that updates only `tx_hash`/`nonce`, writes a `replacement_manually_attached` event and audit entry, and lets the tracker resume. Do not mark the order failed/dropped and do not create ledger rows manually. A first-class attach endpoint remains a Phase 9.x hardening item.
- The tracking poller verifies sender, router, calldata, and value before confirming. Replaced/dropped/failed transactions never create accounting. Reorgs before accounting return the order to `PENDING`; post-accounting reorg compensation is manual and append-only (below).
- BSC execution is enabled in production after the 2026-11-05 live acceptance. Ethereum remains behind `SWAP_ETHEREUM_EXECUTION_ENABLED` until its own live acceptance. `SWAP_EXECUTION_ENABLED` and the kill switch remain rollback controls; `signing/cancel` works even during a kill switch.

## Verification

```bash
node scripts/swap-live-check.mjs bsc
node scripts/swap-live-check.mjs ethereum
```

The check prints only chain id, router bytecode size, and quote amounts; it never prints the RPC URL or API key. Never enable `SWAP_ENABLED=true` without a successful check and a reviewed allowlist.

## Rollback / incident

1. Prefer `SWAP_KILL_SWITCH=true` / `SWAP_EXECUTION_ENABLED=false`; these stop new execution but keep the tracker running.
2. Do not roll back to a pre-Phase-9 image while any `SUBMITTED`/`PENDING` order or `CONFIRMED` order with null `accounting_transaction_id` exists. Drain or account those orders first. A Phase 8 image is BSC-only and cannot track or serve Ethereum orders; only roll back to it after every Ethereum order is terminal and accounted.
3. Attach a signed hash via `POST /swap/orders/:id/submitted` even if execution is disabled; tracking will verify it.
4. Never delete orders, approvals, events, or ledger rows. Corrections are append-only.
5. Post-accounting reorg policy: the per-chain confirmation threshold (`SWAP_CONFIRMATIONS`/`SWAP_BSC_CONFIRMATIONS` for BSC, `SWAP_ETHEREUM_CONFIRMATIONS` for Ethereum) is treated as final for accounting. The tracker stops watching `CONFIRMED` orders, so detect a deep reorg by periodically re-fetching the receipt/block for confirmed orders (or via an external chain monitor).
6. If a confirmed/accounted transaction is reorged out: set `SWAP_KILL_SWITCH=true`, preserve the order/events/tx hash, re-fetch the receipt and block, and do not edit or delete ledger rows. The owner/operator drafts an append-only compensating transaction through the accounting module and records the incident. Automatic compensation is a Phase 9 prerequisite.
7. If the receipt is still canonical and confirmations are at or above `SWAP_CONFIRMATIONS`, no correction is needed; record the check and resume execution.
