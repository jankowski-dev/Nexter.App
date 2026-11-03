# Phase 2 — Auth & Security Report

Date: 2026-11-03

Status: implemented, independent review findings fixed, pending re-review

## Scope completed

- First-run setup with `SETUP_TOKEN`, transactional and protected by a database single-owner index plus an advisory lock.
- Argon2id password hashing (`@node-rs/argon2`), with dummy-hash verification for unknown emails to reduce timing enumeration.
- TOTP 2FA with encrypted secrets (`otplib`, AES-256-GCM).
- QR code generation for authenticator apps.
- Ten one-time recovery codes, SHA-256 hashed and consumed atomically.
- Password reset with recovery code; all sessions revoked and ten new codes issued.
- Password change rotates the current session and revokes all other sessions.
- Server-side sessions with hashed tokens, CSRF token hash, 2FA flag, IP, user agent, last seen, expiry, revocation.
- Database-backed auth rate limits (`rate_limits`) with atomic increments; per-IP and per-email login counters; per-user TOTP/recovery lockout checked before verification.
- Global process-local request limiter (10/min auth attempts, 60/min mutations, 300/min reads).
- CSRF protection via `nexter_csrf` cookie + `X-CSRF-Token`, session hash comparison, and same-origin check.
- Global `AuthGuard`, `TwoFactorGuard`, and `CsrfGuard`.
- Audit logging for setup, login, 2FA, recovery, logout, session revoke, password changes, recovery-code regeneration, and rate-limit blocks. Credential/session mutations audit in the same transaction and roll back if audit fails.
- Auth UI: setup, login, setup-2FA, 2FA, recovery, reset-password, security settings. Server errors are mapped to Russian copy.
- Security settings: active sessions, revoke, password change, recovery-code regeneration.
- Migrations `0002_whole_power_pack.sql` (session CSRF/2FA fields, `rate_limits`) and `0003_numerous_betty_ross.sql` (single-owner index).
- Shared auth contracts (Zod schemas/types) consumed by API and web.
- Playwright browser auth flow.

## Verification

- API auth e2e against a real PostgreSQL 18.6 instance (embedded Postgres), 6 test cases:
  - single-owner setup, invalid setup token, concurrent setup race;
  - setup → TOTP setup → TOTP enable → me → logout → login → TOTP verify → sessions → CSRF checks → audit checks;
  - TOTP lockout: four failures, blocked on the fifth, valid code rejected while blocked, success after clearing the block;
  - recovery-code consumption, reuse rejection, password reset, all-session revocation, old-password rejection;
  - two sessions, session revocation, `404` for unknown session, password-change rotation, old cookie rejection, old-password rejection.
- Full API test suite: 25 tests pass with database.
- Contracts, db, web, worker, and e2e typechecks pass.
- Playwright Chromium auth flow passes: setup → recovery codes → TOTP setup → dashboard → logout → login + TOTP → security settings → password change → re-login.
- `pnpm build` passes for API, web, and worker.
- `pnpm smoke:static` passes with auth env.
- `pnpm audit --prod` reports no vulnerabilities.
- Migrations apply cleanly in PostgreSQL 18.6. PostgreSQL 17 compatibility is exercised by CI.
- `pnpm format:check`, `pnpm lint`, `pnpm typecheck` pass.
- Local gitleaks 8.30.1 scan reports no leaks.

## Security notes

- Session and CSRF tokens are stored only as SHA-256 hashes.
- TOTP secrets are never stored in plaintext; `AUTH_ENCRYPTION_KEY` format is validated at startup and before owner creation.
- Recovery codes are one-time, hashed, and consumed under a row lock.
- Login errors are generic; unknown emails still perform an Argon2 verification.
- TOTP/recovery attempts are checked against a per-user lockout before code verification.
- CSRF is enforced for authenticated mutations, including origin checks.
- Pending-2FA sessions cannot access sensitive auth endpoints.
- Password change/reset revoke sessions as described above.
- Auth responses are `Cache-Control: no-store`.
- No email is sent. The setup token is not a recovery mechanism; break-glass recovery is an offline, audited runbook.

## Known limitations

- Passkeys/WebAuthn are deferred.
- No email reset by design.
- Session TTL is absolute 30 days; sliding renewal is deferred and documented in ADR 0005.
- Process-local request limiter is not shared across replicas; database auth counters are authoritative.
- No automated cleanup job yet for expired sessions or stale rate-limit rows.
- TOTP replay within the ±30s window is not prevented; it requires both the password/session and a live code.
- No encryption-key rotation/key-id support; rotating `AUTH_ENCRYPTION_KEY` requires re-enrolling TOTP.
- Break-glass recovery is a documented manual runbook, not an automated CLI.
- Step-up TOTP for swaps is deferred to MVP-2.
- Cloudflare Access remains an optional deployment layer.
- Auth UI is functional but intentionally minimal.
- Docker/CI execution of the new auth tests is pending the next push.

## Review history

Independent review returned **FAIL** with:

- Critical: TOTP lockout was recorded but not enforced; 2FA counter was per session; login throttle reset before 2FA.
- High: setup could create two owners under concurrency; security-test exit criterion not met.
- Medium: login timing enumeration, password-change session semantics, absolute TTL, non-atomic recovery consumption, best-effort audit, non-transactional mutations, missing key validation, no break-glass runbook, no ADR, English server messages in Russian UI, missing global/per-email limits.

All Critical and High findings and the actionable Medium findings were fixed in this revision. Remaining limitations are listed above and in ADR 0005.

## Next phase

Phase 3 — Accounting core, after Phase 2 re-review.
