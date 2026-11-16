# ADR 0057 — Interface preferences and idle auto-lock

## Status

Accepted for UI-62 on 2026-11-16. No migration.

## Context

Theme, wallet chain and the quick-lock PIN were already stored per browser, but the lock never engaged automatically and there was no single place to change UI behaviour. The owner asked for a 5-minute idle lock and a dedicated settings section.

## Decision

- Add `Настройки → Интерфейс и поведение`.
- Store UI preferences in `localStorage` under the existing keys and a new `nexter-idle-lock-minutes` key.
- Default idle timeout: 5 minutes. Options: never, 1, 3, 5, 10, 15, 30 or 60 minutes.
- The lock provider listens for mouse, keyboard, touch, scroll and wheel activity. While a PIN exists and the app is unlocked, an idle timer locks the app after the configured interval. The timer is disabled without a PIN.
- `ClientValidationError` carries user-facing Russian validation messages from the trade and operation forms; `toRussianError` returns them instead of the generic fallback.
- The chain toggle now states explicitly that it selects the wallet/execution network and does not filter the portfolio.
- The chain toggle is also exposed on the interface page.

Preferences are per browser/device because the PIN and theme are local by design. The server timezone and gas setting remain on the main Settings page.

## Consequences

- New page and route `/settings/interface`.
- No server API, schema or migration changes.
- Cross-tab changes propagate through the `storage` event; same-tab changes use a custom `nexter-ui-preference` event.
- A locked app still requires the existing reset-and-logout recovery.

## Verification

- Web typecheck, lint, tests and build pass.
- The idle logic is client-side; manual verification is required for timing.
