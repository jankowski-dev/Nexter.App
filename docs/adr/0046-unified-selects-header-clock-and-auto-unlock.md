# ADR 0046 — Unified selects, header clock, and auto-unlock

## Status

Accepted for UI-55 on 2026-11-15. No migration.

## Context

The owner asked for a final consistency pass after UI-54:

- every dropdown should use the same custom presentation as the stablecoin selector in the token buy drawer;
- the dashboard’s inner metric boxes should be transparent instead of gray;
- the auth/lock green should match the emerald used by the rest of the app;
- the header subtitle should become a live date/time;
- the lock screen should unlock automatically when the sixth digit is entered, without a button.

## Decision

- **One custom Select.** The shared `components/ui/select.tsx` now renders a styled visual button and a custom option list. A transparent native `<select>` remains over the button, preserving form semantics, keyboard access, labels and existing E2E `selectOption` calls; `mousedown` is prevented so the native menu does not open and the custom list is shown instead. This applies to every existing `Select` usage. `StablecoinSelect` keeps its richer balance rows but uses the same visual language.
- **Transparent metric boxes.** Dashboard `SummaryMetric` cards use a transparent background with a subtle border so the parent gradient remains visible.
- **Emerald auth/lock accent.** The auth and quick-lock shell no longer uses the lime `#C2E32F` accent. Logo rays, primary buttons, focus rings, links and success tints use the app’s emerald (`#34D399` / `#059669`).
- **Header clock.** The app header replaces `Личный финансовый учет` with a live Russian date, separator and `HH:mm:ss` time, updating every second on every authenticated page.
- **Auto-unlock.** The lock screen no longer has a `Разблокировать` button. The sixth digit submits automatically; the input shows `Проверяем…`, errors still clear the code, and the five-attempt/30-second cooldown remains.
- **No execution or schema changes.** No server lock endpoint, session change, ledger change or migration.

## Consequences

- The native select is visually hidden (opacity 0) but still reachable by assistive technology and test automation; the custom list is the visible interaction.
- A custom list can be clipped by a very short scroll container, though current dialogs/drawers have enough space near the top.
- The header clock uses the browser’s local timezone and updates once per second; it is hidden on very small screens where the header already carries multiple controls.
- Auto-unlock improves speed but keeps the same client-side privacy limitations as the existing PIN screen.

## Verification

- Existing E2E `selectOption` flows continue to work against the native overlay; manually checked a finance account dropdown opening the custom list.
- Auto-unlock was smoke-tested with a real lock setup and a correct six-digit code.
- `format:check`, `typecheck`, `lint`, web tests and build pass.

## Production release (2026-11-15)

PR #137 merged as `4aa08ce`; deployment `70eeff01-8c6f-47bc-a14a-fb92ff9f9642`; bundle `assets/index-B289aDL0.js`; `/health` and `/ready` 200. No migration.
