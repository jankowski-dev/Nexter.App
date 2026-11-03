# Auth & Security Spec

## Scope

Phase 2 implements the single-owner authentication and security layer.

In scope:

- first-run setup with a server-side setup token;
- password login;
- TOTP 2FA;
- one-time recovery codes;
- password reset via recovery code;
- server-side sessions and session listing/revocation;
- CSRF protection;
- database-backed auth rate limits/lockout;
- audit logging for auth events;
- login, setup, 2FA, recovery, reset, and security settings UI;
- API integration tests and a Playwright browser auth flow.

Out of scope:

- passkeys/WebAuthn;
- email delivery and email password reset;
- multi-user and invitations;
- step-up TOTP for swaps (MVP-2);
- Cloudflare Access policy (optional deployment layer).

## Data model

- `users`: email, Argon2id password hash, encrypted TOTP secret, TOTP enabled flag, hashed recovery codes, role, timestamps. A unique expression index on `((true))` enforces exactly one owner.
- `sessions`: hashed session token, hashed CSRF token, 2FA-verified flag, IP, user agent, expiry, last seen, revocation.
- `rate_limits`: key, points, window start, blocked-until, updated time.
- `audit_log`: actor, action, entity, before/after JSON, IP, user agent, timestamp.

See [ADR 0005](../adr/0005-auth-sessions-and-rate-limits.md).

## Crypto

- Password hashing: Argon2id, 64 MiB, 3 iterations, parallelism 1.
- Session token: 32 random bytes, hex; only SHA-256 hash stored.
- CSRF token: 32 random bytes, hex; only SHA-256 hash stored in the session.
- TOTP secret: AES-256-GCM encrypted at rest with `AUTH_ENCRYPTION_KEY` (32-byte base64 or 64-char hex). The format is validated at startup and before first-run setup.
- Recovery codes: 10 random codes, SHA-256 hashed; one-time use, consumed atomically.

## Flows

### First run

1. `POST /auth/setup` with setup token, email, password.
2. Server refuses if a user already exists or the setup token is invalid.
3. Setup runs in a transaction with a PostgreSQL advisory lock; the single-owner index is the database backstop. A concurrent loser receives `409`.
4. Creates user + settings, generates 10 recovery codes, creates a pending session.
5. Returns recovery codes once; client must save them.
6. Client completes TOTP setup: `POST /auth/2fa/setup` → QR/secret, `POST /auth/2fa/enable` with code.
7. Session is rotated to a 2FA-verified session.

The setup token is **not** a recovery mechanism. Break-glass recovery is documented in [`docs/runbooks/auth-recovery.md`](../runbooks/auth-recovery.md).

### Login

1. `POST /auth/login` with email/password.
2. Invalid credentials are generic; unknown emails still pay an Argon2 verification against a dummy hash to reduce timing enumeration. Failures are rate-limited per IP and per hashed email, and audited.
3. On success, a pending session is created. The login throttle is not reset until 2FA completes.
4. If TOTP is enabled, client goes to `/2fa` and calls `POST /auth/2fa/verify`.
5. If TOTP setup is incomplete, client goes to `/setup-2fa`.
6. On successful 2FA, the session is rotated, marked verified, and login throttles are reset.

### Recovery

- `POST /auth/recovery/verify` with a recovery code; consumes it atomically under a row lock, rotates the session to verified.
- `POST /auth/password/reset` with email, recovery code, and new password; consumes the code atomically, revokes all sessions, and issues ten new recovery codes. The old codes are invalid.
- Recovery verification shares the per-user 2FA lockout with TOTP.

### Sessions

- `GET /auth/sessions` lists active sessions with IP, user agent, last seen, expiry, current flag.
- `DELETE /auth/sessions/:id` revokes a session; current session clears cookies. Unknown or already-revoked sessions return `404`.
- Password change rotates the current session and revokes all other sessions.
- Session lifetime is an absolute 30-day TTL. Activity updates `last_seen_at` but does not extend `expires_at` (documented deviation from sliding renewal).

## Guards

- `AuthGuard`: requires a valid session cookie; attaches user/session to the request.
- `TwoFactorGuard`: requires `twoFactorVerified` for all protected routes, except `@Public()` and `@AllowPending2fa()` auth endpoints. Failure code is `TOTP_REQUIRED`.
- `CsrfGuard`: requires `X-CSRF-Token` matching the CSRF cookie and the session hash for state-changing requests. Non-safe requests with a mismatched `Origin`/`Referer` are rejected, including public setup/login/reset requests.
- `@Public()`: setup, login, auth status, password reset.
- `@AllowPending2fa()`: me, csrf, TOTP setup/enable/verify, recovery verify, logout.

## Cookies

- `nexter_session`: httpOnly, Secure in staging/production, SameSite=Lax, path `/`, 30-day TTL.
- `nexter_csrf`: readable by the SPA, Secure in staging/production, SameSite=Lax, path `/`.
- CSRF header: `X-CSRF-Token`.
- Auth responses are sent with `Cache-Control: no-store`.

## Rate limits

- Login: 10 attempts / 15 minutes per IP+email pair and per IP; 15-minute block. A global per-email lockout is intentionally avoided to prevent unauthenticated denial of service against the single owner.
- Setup: 5 attempts / 15 minutes per IP.
- TOTP/recovery: 5 attempts / 5 minutes per user (shared counter, checked before verification); 15-minute block.
- Password change/recovery-code regeneration: 5 attempts / 15 minutes per user.
- Password reset: 5 attempts / 15 minutes per IP and per email hash.
- Successful password reset/password change clears the per-user 2FA lockout and login counters so recovery is not blocked by a prior attack.
- Process-local request limiter: 10/min auth attempts, 60/min other mutations, 300/min reads per IP. Database counters are authoritative for auth lockout.

## Audit

- Credential and session mutations (`setup`, `totp_enabled`, `totp_verified`, `recovery_code_used`, `logout`, `session_revoked`, `password_changed`, `password_reset`, `recovery_codes_regenerated`, `totp_setup_started`) write audit rows in the same transaction as the mutation. Audit failure rolls the mutation back.
- Failed logins/setup/2FA/recovery attempts and rate-limit blocks are audited best-effort.

## Environment

- `SETUP_TOKEN` required in production/staging and for first-run setup.
- `AUTH_ENCRYPTION_KEY` required in production/staging; 32-byte base64 or 64-char hex. Invalid values fail startup.
- `SESSION_TTL_DAYS` default 30.
- `TOTP_ISSUER` default `Nexter`.
- No email sending.

## UI routes

- `/setup`
- `/login`
- `/setup-2fa`
- `/2fa`
- `/recovery`
- `/reset-password`
- `/settings/security`

Server error messages are mapped to Russian UI copy in `apps/web/src/lib/error-messages.ts`; raw 5xx/config messages are not shown.

## Tests

- Destructive auth tests require `NEXTER_TEST_DB=1` and a disposable database; they truncate auth tables.
- `apps/api/test/auth.e2e.spec.ts` covers setup single-owner/concurrency, invalid setup token, TOTP enable/login, pending-session isolation, CSRF missing/mismatch/session-hash/origin, cookie flags, audit entries, TOTP lockout including a valid code while blocked and after re-login, recovery-code consumption/reuse and concurrency, password reset, reset-after-lockout, session revocation, password change rotation with a live session, and old-password rejection.
- `apps/e2e/tests/auth.spec.ts` is a Playwright browser flow: setup → recovery codes → TOTP setup → dashboard → logout → login + TOTP → security settings → password change → re-login.

## Acceptance criteria

- First-run setup works exactly once with a valid setup token, including under concurrent requests.
- Password login + TOTP flow works end-to-end.
- A valid TOTP code is rejected while the per-user lockout is active.
- Recovery code login consumes the code and cannot be reused.
- Password reset revokes all sessions and issues new recovery codes.
- Password change rotates the current session and revokes other sessions.
- Session list shows IP, user agent, last seen, and current session.
- CSRF token and same-origin checks are required for authenticated mutations.
- Auth failures are rate-limited and audited.
- No email is sent.
- No private keys or seed phrases are requested.
