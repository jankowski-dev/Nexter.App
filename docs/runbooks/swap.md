# Swap Execution Runbook (Phase 8)

Phase 8 currently provides WalletConnect connection, quotes, router-level calldata verification, and exact approval build/submission. The server never signs, broadcasts, or stores private keys/seed phrases. There is no execution UI yet.

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
8. Set `SWAP_STEP_UP_THRESHOLD_USD=500` unless a stricter local policy is required.
9. Optionally override `SWAP_ROUTER_ALLOWLIST`; the default is the Kyber MetaAggregationRouterV2 address.
10. Run `pnpm swap:live-check` with the production RPC/key (or against an Anvil BSC fork) and confirm chain id 56, router bytecode presence (not router identity), and a read-only quote.
11. Set `SWAP_ENABLED=true`, deploy/redeploy, and verify `GET /swap/config` plus one quote. The UI shows a disabled state until this is done.

## Kill switch

Set `SWAP_KILL_SWITCH=true` in Railway and redeploy (or restart) the API. New quotes/builds return `SWAP_DISABLED`; existing orders remain readable and can be cancelled. Do not delete orders or edit events.

## Provider outage / rate limit

- `429` and `5xx` are retried twice. A 429 maps to `SWAP_RATE_LIMITED`; network/provider exhaustion maps to `SWAP_PROVIDER_UNAVAILABLE`; other provider failures map to `SWAP_QUOTE_FAILED`/`SWAP_BUILD_FAILED`.
- If the provider is degraded, enable the kill switch. Quotes are short-lived (15 s) and no signing UI exists yet, so the server cannot move funds.
- Check `external_api_calls` for status/latency; it contains no secrets or response bodies.

## Key rotation

- Rotate `KYBERSWAP_API_KEY` in Railway only; never commit it.
- `BSC_RPC_URL` may contain a provider token; rotate it in Railway and keep it out of logs/screenshots.
- The server has no signing keys. There is nothing to rotate for wallet custody.

## Allowlist changes

- Token addresses are code-owned and require review; do not add arbitrary tokens in production.
- Wallet/router/executor/selector allowlists are environment-owned. Changing them requires a redeploy and a new quote/build check. The application role must not have DELETE on swap tables, approvals, or events.
- Step-up TOTP is required above the configured threshold; the session window is five minutes. Missing/invalid provider USD fails closed.
- Calldata is decoded at router level before a build is accepted. Simple mode is rejected; standard aggregator routes use the server-enforced order deadline, which the execution UI must display before signing. Submission is rejected after the deadline.

## Execution slice (Phase 8a)

- `POST /auth/step-up` sets a five-minute step-up window; builds/submissions/approvals above `SWAP_STEP_UP_THRESHOLD_USD` require it.
- Exact approvals use the router/spender allowlist; native inputs do not need approval; already-sufficient allowance returns 409.
- `POST /swap/orders/:id/submitted` and approvals/:id/submitted only record hashes; on-chain verification and confirmation tracking land in the tracking slice.
- Builds reject calldata whose recipient, tokens, amount, minOut, executor, approve target, receivers, fees, permit or partial-fill flags do not match the quote.
- Simple mode (`flags & 0x20`) is rejected until `firstPools`/`destTokenFeeData` can be validated. Some Kyber routes using pool `srcReceivers` may also be rejected; this is intentional fail-closed behavior.
- A first-time ERC-20 swap with zero allowance currently fails simulation before approval build; the execution slice must add the allowance/`APPROVAL_REQUIRED` gate before signing is enabled.
- All execution endpoints remain disabled until `SWAP_ENABLED=true`, wallet/router/selector allowlists are set, and the remaining Phase 8 slices are reviewed. No signing UI exists yet.

## Verification

```bash
pnpm swap:live-check
```

The check prints only chain id, router bytecode size, and quote amounts; it never prints the RPC URL or API key. Never enable `SWAP_ENABLED=true` without a successful check and a reviewed allowlist.
