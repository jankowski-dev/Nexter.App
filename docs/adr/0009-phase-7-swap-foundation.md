# ADR 0009 — Phase 7 swap foundation

## Status

Accepted for Phase 7.

## Context

MVP-1 is complete. Phase 7 is the first swap phase. The accounting, auth, import, and UI foundations are accepted. Swaps must remain non-custodial: the server never stores seed phrases, private keys, or signing keys, and Phase 7 must not submit or sign transactions.

The KyberSwap Aggregator API is the routing source. Routes are short-lived (about 15–30 seconds), route summaries must be passed back verbatim to the build endpoint, and the returned calldata must be validated before it is ever shown to a signer. BSC is the first chain; Ethereum remains Phase 9.

## Decision

### Scope

Phase 7 delivers:

- a server-side KyberSwap client with the gateway and public fallback;
- a static, verified BSC token registry;
- quote and build endpoints, calldata/router/amount validation, and RPC simulation;
- persisted swap orders and a state machine for the pre-signing states;
- a kill switch and an authenticated `GET /swap/config`;
- a read-only quote UI on BSC.

Phase 7 explicitly does **not** deliver:

- WalletConnect/Tangem integration;
- approval building/submission;
- transaction signing or submission;
- step-up TOTP (Phase 8);
- accounting integration (Phase 8);
- Ethereum (Phase 9);
- unattended trading.

### Token registry

- The registry is code-owned, not user-editable in Phase 7.
- Only the BSC tokens listed in `docs/mega-prompt.md` are included: USDC, XNY, BASED, APR, POP, LINK, and native BNB.
- Addresses and decimals are committed constants; arbitrary token addresses are rejected.
- The native BNB sentinel is `0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE`.
- Ethereum entries are not exposed until Phase 9.

### KyberSwap client

- Primary base URL: `KYBERSWAP_BASE_URL` (default gateway `https://api.kyberswap.com/swap`), optional `KYBERSWAP_API_KEY` sent as `X-Api-Key`.
- Fallback: `https://aggregator-api.kyberswap.com` with `X-Client-Id: nexter` when no gateway key is configured.
- Endpoints: `GET /{chain}/api/v1/routes` and `POST /{chain}/api/v1/route/build`.
- The complete `routeSummary` is stored and passed back verbatim.
- Requests have a timeout, bounded retries for 429/5xx, and record an `external_api_calls` row without secrets or raw response bodies.
- User input never controls the base URL or chain slug.

### Swap order state machine

Phase 7 uses the pre-signing subset:

`QUOTED → BUILT → CANCELLED | EXPIRED | FAILED`

The full MVP-2 state machine (`DRAFT`, `APPROVAL_REQUIRED`, `READY`, `AWAITING_SIGNATURE`, `SUBMITTED`, `PENDING`, `CONFIRMED`, `REPLACED`, `DROPPED`) is reserved for Phase 8 and later. Unknown transitions are rejected.

### Validation gates

Quote:

- kill switch off;
- chain `bsc` only;
- both tokens in the registry, distinct;
- positive decimal amount within 80 characters, converted to base units;
- slippage within the configured range (default 50 bps, max 200);
- optional wallet address well-formed and, when the allowlist is configured, allowed;
- Kyber response `code === 0`, route summary present, amountIn matches, amountOut > 0;
- price impact present and within 2% when the provider supplies it;
- quote TTL 15 seconds.

Build:

- order belongs to the owner, status `QUOTED`, not expired;
- kill switch off;
- wallet address well-formed and in `SWAP_WALLET_ALLOWLIST` (empty allowlist disables builds);
- Kyber build response has calldata, router, transaction value, amountIn, amountOut;
- router is in `SWAP_ROUTER_ALLOWLIST`;
- `to` equals the router;
- calldata is hex, bounded in size, and its selector is in `SWAP_SELECTOR_ALLOWLIST` when configured;
- native value equals the quoted/expected native amount;
- recipient is the allowed wallet;
- deadline is at most 5 minutes ahead;
- output meets the quoted minimum;
- RPC chain id is BSC;
- RPC `eth_call` and `eth_estimateGas` succeed with the built transaction;
- any mismatch rejects the build and records a `build_failed` event.

Full ABI decoding and a complete selector allowlist are Phase 8 work; Phase 7 enforces a configured selector allowlist and otherwise relies on router/value/amount/simulation checks. This limitation is documented and reviewed.

### Persistence

Migration `0009` adds:

- `swap_orders` — owner, chain, wallet, tokens, decimal amounts, slippage, price impact, route id/summary, router, calldata, transaction value, gas estimate, gas USD, status, errors, quote expiry, timestamps;
- `swap_events` — order events with JSON payload;
- `external_api_calls` — provider, endpoint, status, latency; no secrets or bodies.

`token_approvals` and accounting links are deferred to Phase 8.

All mutations are audited. Build and cancel add both a domain event and an audit entry. Quote creation is audited as `swap.quote_created`; quote/build failures are audited only with bounded error codes, never raw provider bodies.

### Kill switch

- `SWAP_ENABLED` defaults to `false`; the owner must explicitly enable quotes.
- `SWAP_KILL_SWITCH=true` immediately disables new quotes and builds. Reads and cancels remain available so an operator can inspect and close existing orders.
- `GET /swap/config` returns the effective enabled state, chains, tokens, limits, and whether a wallet allowlist is configured; it never returns API keys or RPC URLs.

### UI

- `/swap` is a read-only BSC quote page: token selectors, amount, quote result, price impact, gas, route summary, and expiry.
- Build/sign controls are not exposed in Phase 7.
- If swaps are disabled or the provider is not configured, the page shows a Russian explanatory state.
- No seed phrase, private key, or wallet connection is requested.

### Testing

- Unit tests for the token registry, quote/build validation, state transitions, kill switch, and the Kyber client (recorded fixtures, mocked fetch).
- API tests with injected Kyber/RPC fakes; no live provider needed.
- Playwright quote UI with intercepted API responses.
- Opt-in live/fork checks (`SWAP_LIVE_TEST=1`, `BSC_RPC_URL`) are documented but not required in CI; CI must remain deterministic.

## Consequences

- Phase 7 is safe to deploy with `SWAP_ENABLED=false`.
- No transaction can be signed or submitted by the server.
- A compromised server can request quotes and build calldata, but cannot move funds; Phase 8 adds device confirmation and the remaining execution gates.
- The static registry intentionally rejects arbitrary tokens, reducing honeypot exposure.
- Full calldata decoding and selector completeness remain Phase 8 security work.
