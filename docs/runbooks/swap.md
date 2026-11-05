# Swap Execution Runbook (Phase 8)

Phase 8 provides WalletConnect connection, quotes, router-level calldata verification, exact approval build/submission, an execution UI, and tracking/accounting. The server never signs, broadcasts, or stores private keys/seed phrases. Signing is gated by `SWAP_EXECUTION_ENABLED`.

## Enable quotes

1. Set `SWAP_ENABLED=false` while configuring.
2. Set `WALLETCONNECT_PROJECT_ID` (public Reown/WalletConnect project id) for the `/swap` connection UI. The API CSP must keep the WalletConnect relay/AppKit origins in `connect-src`/`frame-src`; if the QR modal opens empty, check the browser console for CSP violations and the relay/WebSocket requests.
3. Set the provider:
   - `KYBERSWAP_API_KEY` and optionally `KYBERSWAP_BASE_URL=https://api.kyberswap.com/swap` (gateway), or
   - leave the key empty to use the public `https://aggregator-api.kyberswap.com` fallback.
4. Set `BSC_RPC_URL` for build/simulation (quotes work without it).
5. Set `SWAP_WALLET_ALLOWLIST` to the Tangem BSC address(es). An empty allowlist disables builds.
6. Set `SWAP_SELECTOR_ALLOWLIST=0xe21fd0e9,0x59e50fed` (`swap`, `swapGeneric`). An empty allowlist disables builds.
7. Optionally set `SWAP_EXECUTOR_ALLOWLIST`; the default is the BSC AggregationExecutorProxy `0x8F10B468b06c6FD214B65F87778827F7D113f996`.
8. Keep `SWAP_EXECUTION_ENABLED=false` until final review and a successful manual Tangem acceptance; after acceptance, set it to `true` to enable signing. Set `SWAP_MAX_GAS_USD=5` (or a stricter cap).
9. Set `SWAP_STEP_UP_THRESHOLD_USD=500` unless a stricter local policy is required; set `SWAP_CONFIRMATIONS=15` (default), `SWAP_TRACK_INTERVAL_SECONDS=15`, and `SWAP_DROP_TIMEOUT_SECONDS=1800` if a different policy is required.
10. Optionally override `SWAP_ROUTER_ALLOWLIST`; the default is the Kyber MetaAggregationRouterV2 address.
11. Run `pnpm swap:live-check` with the production RPC/key (or against an Anvil BSC fork) and confirm chain id 56, router bytecode presence (not router identity), and a read-only quote.
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

## Execution slice (Phase 8a)

- `POST /auth/step-up` sets a five-minute step-up window; builds, approval builds, ready, and signing above `SWAP_STEP_UP_THRESHOLD_USD` require it. Submit is recovery-only.
- Exact approvals use the router/spender allowlist; native inputs do not need approval; already-sufficient allowance returns 409.
- `POST /swap/orders/:id/submitted` records an already-signed hash even during a kill switch/execution disable; the API tracking poller verifies the swap transaction, tracks confirmations, and creates accounting on confirmation.
- `POST /swap/approvals/:id/submitted` records the approval hash; the tracker confirms/fails it. Approval-only hash recording is allowed while execution is disabled because it cannot move funds.
- Builds reject calldata whose recipient, tokens, amount, minOut, executor, approve target, receivers, fees, permit or partial-fill flags do not match the quote.
- Native gas preflight (`gasEstimate × eth_gasPrice`) fails closed when BNB is insufficient.
- `ready` re-decodes stored calldata against current allowlists. A missing original hash with an advanced nonce triggers a recent-block search for a matching same-nonce replacement; matching replacements are adopted, other txs mark `REPLACED`.
- Insufficient ERC-20 allowance moves the order to `APPROVAL_REQUIRED`; `POST /swap/orders/:id/ready` re-checks allowance/simulation and moves it to `READY`. Signing is controlled by `SWAP_EXECUTION_ENABLED` and the kill switch.
- `POST /swap/orders/:id/submitted` records an already-signed hash even during a kill switch/execution disable; it does not create accounting, and tracking verifies the tx.
- The tracker is API-hosted and production must run a single API replica (or add a future leader lock). Do not roll back to a pre-Phase-8 image while orders are active/unaccounted.
- Simple mode (`flags & 0x20`) is rejected until `firstPools`/`destTokenFeeData` can be validated. Some Kyber routes using pool `srcReceivers` may also be rejected; this is intentional fail-closed behavior.
- A first-time ERC-20 swap with zero allowance enters `APPROVAL_REQUIRED`; after the exact approval, `POST /swap/orders/:id/ready` re-checks and moves it to `READY`.
- Confirmed-swap accounting requires the wallet's input token and BNB gas balance to exist in the ledger. A negative balance is recorded as `SWAP_ACCOUNTING_NEGATIVE_BALANCE` and retried every 60 seconds after reconciliation; it is never silently forced.
- Cash-equivalent legs derive USD from the actual on-chain amount; non-cash legs scale the quote USD by the actual `Swapped` amounts.
- Tracking starts whenever `BSC_RPC_URL` is configured, even if `SWAP_ENABLED=false`, so in-flight transactions continue to confirm and account during a rollback.
- Speed-up/replacement transactions are detected as `REPLACED` but are not adopted automatically; a same-nonce replacement that actually executed is a known limitation for the execution slice.
- The tracking poller verifies sender, router, calldata, and value before confirming. Replaced/dropped/failed transactions never create accounting. Reorgs before accounting return the order to `PENDING`; post-accounting reorg compensation is a later slice.
- Execution is enabled in production after the 2026-11-05 live acceptance. `SWAP_EXECUTION_ENABLED` and the kill switch remain rollback controls; `signing/cancel` works even during a kill switch.

## Verification

```bash
pnpm swap:live-check
```

The check prints only chain id, router bytecode size, and quote amounts; it never prints the RPC URL or API key. Never enable `SWAP_ENABLED=true` without a successful check and a reviewed allowlist.

## Rollback / incident

1. Prefer `SWAP_KILL_SWITCH=true` / `SWAP_EXECUTION_ENABLED=false`; these stop new execution but keep the Phase 8 tracker running.
2. Do not roll back to a pre-Phase-8 image while any `SUBMITTED`/`PENDING` order or `CONFIRMED` order with null `accounting_transaction_id` exists. Drain or account those orders first, or roll back only to a Phase 8 image.
3. Attach a signed hash via `POST /swap/orders/:id/submitted` even if execution is disabled; tracking will verify it.
4. Never delete orders, approvals, events, or ledger rows. Corrections are append-only.
5. Post-accounting reorg policy: 15 confirmations are final for accounting; a deeper reorg requires disabling execution and a manual append-only compensating transaction. Automatic compensation is a Phase 9 prerequisite.
