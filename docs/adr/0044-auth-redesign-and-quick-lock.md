# ADR 0044 — Auth redesign and quick app lock

## Status

Accepted for UI-53 on 2026-11-14. No migration, no server API change.

## Context

The owner supplied a standalone login concept (`design-auth/CRM Nexter`, outside the repository) and asked to adapt it to the real Nexter flow: email + password, then a TOTP code. The existing auth pages used a centered white card on a light background, while the reference is a full-screen graphite stage with a 12-ray logo, a single dark field and a lime accent.

The owner also asked for a quick “step away” lock: a `Заблокировать` action next to `Выйти`, then a 6-digit numeric code to unlock. The purpose is privacy from people physically near the screen, not a replacement for password + 2FA.

## Decision

- **Auth shell.** All `/login`, `/setup`, `/setup-2fa`, `/2fa`, `/recovery` and `/reset-password` pages share a dark `#484848` stage. The 12-ray logo is a React SVG with `lit` and `idle|ok|error` states; the accent is `#C2E32F`; the Exo variable font is served from `apps/web/public/fonts/exo-latin-var.woff2`. The white card is removed.
- **Progressive logo.** Login lights one ray per password character; the 2FA screen lights two rays per digit (six digits reach all 12). Errors turn all rays red and shake the form; successful password/2FA submissions turn them green briefly before navigation.
- **Real flow preserved.** Login still submits email/password to the existing `/auth/login` and routes to `/2fa`, `/setup-2fa` or `/dashboard` as before. TOTP, recovery codes, setup and reset forms keep their existing API calls and validation; only the visual shell changed.
- **Quick lock is client-side.** `LockProvider` stores a PBKDF2-SHA256 hash (210,000 iterations, random 16-byte salt) of the 6-digit PIN and a `locked` flag in `localStorage`. The PIN never leaves the browser and is not stored on the server. A 6-digit PIN is intentionally a privacy code, not a cryptographic login secret; PBKDF2 only slows offline guessing of a copied browser profile.
- **Lock surface.** The overlay is opaque graphite with the same logo and field language. It covers the app at `z-index: 100`, locks body scroll, marks the app subtree `inert`/`aria-hidden`, and supports only the PIN or “reset and exit”. Five failed attempts trigger a 30-second client-side cooldown.
- **PIN management.** First `Заблокировать` opens setup (code + confirmation); later presses lock immediately. `Настройки → Безопасность` has a `Быстрая блокировка` card to set/change/remove the PIN or lock now. Removing the PIN unlocks; “Забыли код? Сбросить и выйти” removes the local PIN, logs out through the existing API and requires password + 2FA to return. The normal `Выйти` keeps the configured PIN for the next session.
- **No server changes.** There is no lock endpoint, migration, audit event or session change. The server continues to authenticate the real session exactly as before.

## Consequences

- Anyone who can clear browser storage can remove the lock; this is explicitly a privacy screen. Real access control remains the HttpOnly session, password, TOTP and step-up.
- Content behind the overlay is already loaded and background queries may continue; the overlay hides it visually and makes the app subtree inert. A browser-level attacker is out of scope.
- The PIN does not sync across browsers or devices. Each browser profile configures its own code.
- Losing the PIN is recoverable only through “reset and exit” (password + 2FA) or clearing local storage; there is no server-side PIN recovery.
- No migration, ledger, swap, signing, or accounting behavior changes.

## Verification

- Unit tests cover PIN validation, salted hashing, correct/wrong verification and unique salts (`apps/web/src/lib/app-lock-crypto.test.ts`).
- A Playwright smoke check covers setup, wrong PIN, unlock, direct second lock and reset-and-exit; the lock and login screens were visually checked at desktop and mobile widths.
