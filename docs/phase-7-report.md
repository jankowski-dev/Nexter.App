# Phase 7 — Swap Foundation Report

Date: 2026-11-04

Status: **accepted on 2026-11-04.** Security review PASS; BSC live quote verified through the public fallback; production quote-only deployment is live. Build/sign remain disabled until Phase 8.

## Scope

Phase 7 is scoped by ADR `0009-phase-7-swap-foundation.md`:

- KyberSwap Aggregator client with gateway/fallback, retries, and call observability.
- Static, verified BSC token registry (USDC, XNY, BASED, APR, POP, LINK, native BNB).
- Quote, build, router/calldata/amount/value validation, and RPC simulation.
- Persisted swap orders, events, and pre-signing state transitions.
- Kill switch (`SWAP_ENABLED`, `SWAP_KILL_SWITCH`).
- Read-only BSC quote UI.

Not in Phase 7: WalletConnect/Tangem, approvals, signing, submission, step-up TOTP, accounting integration, Ethereum.

## Data model

Migration `0009_daily_champions.sql` adds:

- `swap_orders` — owner, chain, wallet, tokens, decimal amounts, slippage, price impact, route summary, router, calldata, transaction value, gas, status, errors, quote expiry, timestamps.
- `swap_events` — order events with JSON payload.
- `external_api_calls` — provider/endpoint/status/latency, no secrets or response bodies.

The migration is additive and does not rewrite ledger data.

## Backend

- `GET /swap/config` — effective enabled state, kill switch, provider/RPC/allowlist status, BSC tokens, quote TTL, price-impact and slippage limits. Never returns keys, RPC URLs, or wallet allowlist contents.
- `POST /swap/quote` — token allowlist, amount conversion, slippage gate, Kyber route call, and a price-impact gate that treats the provider field as a fraction and cross-checks it against `amountInUsd`/`amountOutUsd`; order/event/audit persistence.
- `POST /swap/build` — wallet allowlist, quote freshness, router/selector/amount/value/minOut checks, RPC chain id, `eth_call`, and `eth_estimateGas`; returns `BUILT` only on success. `sender`/`recipient`/`deadline` are requested from Kyber but their ABI encoding is not decoded until Phase 8.
- `GET /swap/orders`, `GET /swap/orders/:id`, `POST /swap/orders/:id/cancel`.
- `SWAP_SELECTOR_ALLOWLIST` is required before build is enabled; full ABI decoding remains Phase 8.
- Every persisted quote/build/cancel mutation is audited; every failed build adds a bounded `build_failed` event and `swap.build_failed` audit row. Provider messages are not written to audit payloads. Expiry is audited as `swap.order_expired`.

## Frontend

- `/swap` read-only BSC quote page with token selectors, amount, wallet allowlist field, slippage, quote result, price impact, gas, route id, expiry, and disabled/kill-switch states.
- The navigation and Russian copy are updated; build/sign controls are intentionally absent.
- No wallet connection, seed phrase, private key, approval, or transaction submission.

## Verification

- `pnpm typecheck` — pass.
- `pnpm lint` — pass.
- `pnpm format:check` — pass.
- `pnpm build` — pass.
- API tests — **79 passed, 1 skipped** (includes swap API, Kyber client, RPC, token registry, price-impact units, failure audit, RPC outage, and concurrent build).
- Playwright — **5 passed** (auth, import, manual flows, Phase 5 UI, read-only swap UI).
- Migration `0009` applies cleanly to the disposable PostgreSQL database; restore drill covers 21 tables. The app role provisioning denies DELETE on `swap_orders`, `swap_events`, and `external_api_calls` while retaining INSERT.
- No live Kyber API or BSC RPC credentials were used; provider/RPC calls are covered by deterministic fixtures/fakes.

## Live/fork check

`pnpm swap:live-check` is opt-in and requires `BSC_RPC_URL`; with `KYBERSWAP_API_KEY` it also requests one read-only quote. It verifies chain id 56 and router bytecode, prints no secrets, and never signs or submits. It is intended for a Railway/Anvil fork or a live RPC before enabling quotes.

## Known limitations

- No signing, WalletConnect, approvals, submission, tracking, step-up TOTP, or accounting integration (Phase 8).
- The build response is not ABI-decoded for recipient/deadline; these are mandatory Phase 8 gates before signing.
- Recipient/deadline ABI decoding is a mandatory Phase 8 gate before any signature request; Phase 7 only requests them from Kyber and validates router/selector/amount/minOut/value/simulation.
- `SWAP_SELECTOR_ALLOWLIST` must be configured before build is enabled; full calldata ABI decoding is Phase 8.
- Live Kyber/BSC fork validation is opt-in and not run in this environment. The real provider returned 403 without a gateway key; a production API key/RPC URL is required for live quotes.
- The public fallback is subject to Kyber rate limits; the gateway is preferred when `KYBERSWAP_API_KEY` is set.
- `SWAP_ENABLED=false` is the safe default; the owner must enable quotes after configuring the provider.

## Production deployment

- PR #9 merged to `main` as `4226ebe` after independent security review **PASS**.
- Railway `@nexter/api` deployment `b20524aa` succeeded on 2026-11-04; pre-deploy applied migration `0009` (21 tables total).
- `/ready` and `/login` return 200; `GET /api/v1/swap/config` is registered and returns 401 without a session.
- Quote-only mode is enabled (`SWAP_ENABLED=true`, public Kyber fallback, public BSC RPC). Build/sign remain disabled (`SWAP_SELECTOR_ALLOWLIST`/`SWAP_WALLET_ALLOWLIST` empty). The application role provisioning denies DELETE on the swap tables.
- Public BSC RPC check passed (chain id 56, router bytecode present). A live BSC quote from the production Railway deployment succeeded through the public Kyber fallback without an API key: `100 USDC → 2,027.636378 BASED`, with execution rate, USD value, price impact, gas, and route ID. The owner confirmed the quote UI.

## Review history

First independent review: **FAIL**, no Critical, two High (price-impact unit bypass; unaudited failed builds) and material Mediums. Fixes applied: fraction price-impact with USD cross-check, audit/event for every build failure, conditional build/cancel/expiry transitions, RPC-outage handling, response-size cap, redirect rejection, stricter env bounds, swap-table privilege revokes, expected-5xx telemetry filtering, and expanded tests. Re-review: **PASS**, no Critical/High/Medium code blockers.

## Acceptance notes

- Live BSC quote and RPC chain/router validation passed. Anvil fork execution tests are deferred to Phase 8 because Phase 7 cannot sign or submit; the owner accepted the quote-only foundation on 2026-11-04.
- Build/sign stay disabled until Phase 8 adds full calldata decoding, recipient/deadline verification, exact approvals, step-up TOTP, and accounting.

## Next

Phase 8 — Swap execution, only after its scope is started and reviewed.
