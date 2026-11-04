# Swap Foundation Runbook (Phase 7)

Phase 7 is read-only: quotes and calldata building only. The server never signs, submits, connects a wallet, or stores private keys/seed phrases.

## Enable quotes

1. Set `SWAP_ENABLED=false` while configuring.
2. Set the provider:
   - `KYBERSWAP_API_KEY` and optionally `KYBERSWAP_BASE_URL=https://api.kyberswap.com/swap` (gateway), or
   - leave the key empty to use the public `https://aggregator-api.kyberswap.com` fallback.
3. Set `BSC_RPC_URL` for build/simulation (quotes work without it).
4. Set `SWAP_WALLET_ALLOWLIST` to the Tangem BSC address(es). An empty allowlist disables builds.
5. Set `SWAP_SELECTOR_ALLOWLIST` to the reviewed Kyber router selectors. An empty allowlist disables builds.
6. Set `SWAP_STEP_UP_THRESHOLD_USD=500` unless a stricter local policy is required.
7. Optionally override `SWAP_ROUTER_ALLOWLIST`; the default is the Kyber MetaAggregationRouterV2 address.
8. Run `pnpm swap:live-check` with the production RPC/key (or against an Anvil BSC fork) and confirm chain id 56, router bytecode presence (not router identity), and a read-only quote.
9. Set `SWAP_ENABLED=true`, deploy/redeploy, and verify `GET /swap/config` plus one quote. The UI shows a disabled state until this is done.

## Kill switch

Set `SWAP_KILL_SWITCH=true` in Railway and redeploy (or restart) the API. New quotes/builds return `SWAP_DISABLED`; existing orders remain readable and can be cancelled. Do not delete orders or edit events.

## Provider outage / rate limit

- `429` and `5xx` are retried twice. A 429 maps to `SWAP_RATE_LIMITED`; network/provider exhaustion maps to `SWAP_PROVIDER_UNAVAILABLE`; other provider failures map to `SWAP_QUOTE_FAILED`/`SWAP_BUILD_FAILED`.
- If the provider is degraded, enable the kill switch. Quotes are short-lived (15 s) and no funds can move in Phase 7.
- Check `external_api_calls` for status/latency; it contains no secrets or response bodies.

## Key rotation

- Rotate `KYBERSWAP_API_KEY` in Railway only; never commit it.
- `BSC_RPC_URL` may contain a provider token; rotate it in Railway and keep it out of logs/screenshots.
- The server has no signing keys. There is nothing to rotate for wallet custody.

## Allowlist changes

- Token addresses are code-owned and require review; do not add arbitrary tokens in production.
- Wallet/router/selector allowlists are environment-owned. Changing them requires a redeploy and a new quote/build check. The application role must not have DELETE on swap tables, approvals, or events.
- Step-up TOTP is required above the configured threshold; the session window is five minutes. Missing/invalid provider USD fails closed.
- Phase 8 must add full calldata decoding, exact approvals, step-up TOTP above $500, submission/tracking, and accounting integration before any signing is enabled.

## Execution slice (Phase 8a)

- `POST /auth/step-up` sets a five-minute step-up window; builds/submissions/approvals above `SWAP_STEP_UP_THRESHOLD_USD` require it.
- Exact approvals use the router/spender allowlist; native inputs do not need approval; already-sufficient allowance returns 409.
- `POST /swap/orders/:id/submitted` and approvals/:id/submitted only record hashes in this slice; on-chain verification and confirmation tracking land in the tracking slice.
- All execution endpoints remain disabled until `SWAP_ENABLED=true`, wallet/router/selector allowlists are set, and the remaining Phase 8 slices are reviewed. No signing UI exists yet.

## Verification

```bash
pnpm swap:live-check
```

The check prints only chain id, router bytecode size, and quote amounts; it never prints the RPC URL or API key. Never enable `SWAP_ENABLED=true` without a successful check and a reviewed allowlist.
