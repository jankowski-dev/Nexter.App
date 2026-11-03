# Phase 2 — Auth & Security Report

Date: 2026-11-03

Status: implemented, pending independent review

## Scope completed

- First-run setup with `SETUP_TOKEN`.
- Argon2id password hashing (`@node-rs/argon2`).
- TOTP 2FA with encrypted secrets (`otplib`, AES-256-GCM).
- QR code generation for authenticator apps.
- Ten one-time recovery codes, SHA-256 hashed.
- Password reset with recovery code and new recovery codes.
- Password change with revocation of other sessions.
- Server-side sessions with hashed tokens, CSRF token hash, 2FA flag, IP, user agent, last seen, expiry, revocation.
- Database-backed auth rate limits (`rate_limits`) and lockout.
- CSRF protection via `nexter_csrf` cookie + `X-CSRF-Token`.
- Global `AuthGuard`, `TwoFactorGuard`, and `CsrfGuard`.
- Audit logging for setup, login, 2FA, recovery, logout, session revoke, password changes, recovery-code regeneration.
- Auth UI: setup, login, setup-2FA, 2FA, recovery, reset-password, security settings.
- Security settings: active sessions, revoke, password change, recovery-code regeneration.
- Migration `0002_whole_power_pack.sql` adds session CSRF/2FA fields and `rate_limits`.
- Shared auth contracts (Zod schemas/types) consumed by API and web.

## Verification

- API auth e2e against a real PostgreSQL 18.6 instance (embedded Postgres):
  - setup → recovery codes → TOTP setup → TOTP enable → me → logout → login → TOTP verify → sessions → password change → login with new password.
- Full API test suite: 19 tests pass with database.
- Contracts, db, web, and worker tests pass.
- `pnpm build` passes for API, web, and worker.
- `pnpm smoke:static` passes with auth env.
- `pnpm audit --prod` reports no vulnerabilities.
- Migration applies cleanly in PostgreSQL 18.6 and PGlite.

## Security notes

- Session and CSRF tokens are stored only as SHA-256 hashes.
- TOTP secrets are never stored in plaintext.
- Recovery codes are one-time and hashed.
- Login errors are generic to avoid email enumeration.
- Auth endpoints are rate-limited.
- CSRF is enforced for authenticated mutations.
- Pending-2FA sessions cannot access sensitive auth endpoints.
- No email is sent; recovery is via recovery codes and server-side setup token.

## Known limitations

- Passkeys/WebAuthn are deferred.
- No email reset by design.
- Step-up TOTP for swaps is deferred to MVP-2.
- Cloudflare Access remains an optional deployment layer.
- Auth UI is functional but intentionally minimal.
- Docker/CI execution of auth tests is pending the next push.

## Next phase

Phase 3 — Accounting core, after independent Phase 2 review.
