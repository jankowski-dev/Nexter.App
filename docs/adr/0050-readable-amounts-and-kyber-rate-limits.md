# ADR 0050 — Readable amounts and Kyber rate-limit handling

## Status

Accepted for UI-60 on 2026-11-15. No migration.

## Context

Two production issues remained:

- token quantities in the manual order form displayed raw database precision (`17648.000000000000000000 XNY`);
- on-chain buy/sell previews often failed with `Не удалось получить котировку` or a provider rate-limit message.

Production `external_api_calls` showed Kyber `routes` responses at 200/429 and, around two user actions, seven requests in a few seconds. The client retried each 429 up to three times with short backoff, while the UI polled preview every 15 seconds and refetched on window focus.

## Decision

### Amount formatting

- USD amounts use the existing `formatUsd` two-decimal display.
- Token prices keep `formatPrice` precision (for example `0.000406`).
- Token quantity inputs and summaries trim trailing zeros from raw decimal strings via `normalizeDecimalInput`; the display uses `formatTokenAmount` with a maximum of eight fraction digits.
- The manual sell form no longer inserts `17648.000000000000000000` into the amount input. It inserts `17648`, while retaining meaningful small fractions.

### Kyber requests

- A 429 is no longer retried by the Kyber client. Retrying a rate limit immediately amplified one user request into three provider requests.
- Kyber `routes` calls are serialized through a per-process queue with at least 1.5 seconds between starts. Build requests are not throttled.
- The preview cache TTL increased from 5 to 15 seconds.
- The web preview query polls every 30 seconds, has a 10-second stale time, and does not refetch on window focus.
- `SWAP_RATE_LIMITED`, `SWAP_QUOTE_FAILED`, `SWAP_PROVIDER_ERROR`, `SWAP_PROVIDER_UNAVAILABLE` and `SWAP_PRICE_IMPACT_TOO_HIGH` now have concrete Russian messages.
- A failed preview offers `Обновить котировку` and `Ручной ввод`.

The public Kyber aggregator is used when `KYBERSWAP_API_KEY` is not configured; its rate limit is external to the app. The client changes reduce our own burst amplification but cannot remove provider-side limits.

## Consequences

- Purchase/sell previews return fewer provider errors and explain the remaining ones.
- A route request may wait up to 1.5 seconds behind another route request; this is acceptable for a personal trading UI and avoids provider bursts.
- Manual amounts remain precise in the form while summaries are readable.
- No schema, ledger or execution-path changes.

## Verification

- Kyber client unit tests cover the no-retry 429 behavior.
- `format:check`, `typecheck`, `lint`, web tests, API tests and build pass.
- E2E manual buy/sell flows continue to use the embedded form and fixed footer.

## Production release (2026-11-15)

PR #147 merged as `65a94dda`; deployment `79c922b3-dcb1-42dd-a30f-3ffcb7887017`; bundle `assets/index-De_jjhCd.js`; `/health` and `/ready` 200. No migration.
