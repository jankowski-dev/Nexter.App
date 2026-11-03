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
- login, setup, 2FA, recovery, reset, and security settings UI.

Out of scope:

- passkeys/WebAuthn;
- email delivery and email password reset;
- multi-user and invitations;
- step-up TOTP for swaps (MVP-2);
- Cloudflare Access policy (optional deployment layer).

## Data model

- `users`: email, Argon2id password hash, encrypted TOTP secret, TOTP enabled flag, hashed recovery codes, role, timestamps.
- `sessions`: hashed session token, hashed CSRF token, 2FA-verified flag, IP, user agent, expiry, last seen, revocation.
- `rate_limits`: key, points, window start, blocked-until, updated time.
- `audit_log`: actor, action, entity, before/after JSON, IP, user agent, timestamp.

## Crypto

- Password hashing: Argon2id, 64 MiB, 3 iterations, parallelism 1.
- Session token: 32 random bytes, hex; only SHA-256 hash stored.
- CSRF token: 32 random bytes, hex; only SHA-256 hash stored in the session.
- TOTP secret: AES-256-GCM encrypted at rest with `AUTH_ENCRYPTION_KEY` (32-byte base64 or 64-char hex).
- Recovery codes: 10 random codes, SHA-256 hashed; one-time use.

## Flows

### First run

1. `POST /auth/setup` with setup token, email, password.
2. Server refuses if a user already exists or the setup token is invalid.
3. Creates user + settings, generates 10 recovery codes, creates a pending session.
4. Returns recovery codes once; client must save them.
5. Client completes TOTP setup: `POST /auth/2fa/setup` → QR/secret, `POST /auth/2fa/enable` with code.
6. Session is rotated to a 2FA-verified session.

### Login

1. `POST /auth/login` with email/password.
2. Invalid credentials are generic; failures are rate-limited and audited.
3. On success, a pending session is created.
4. If TOTP is enabled, client goes to `/2fa` and calls `POST /auth/2fa/verify`.
5. If TOTP setup is incomplete, client goes to `/setup-2fa`.
6. On successful 2FA, the session is rotated and marked verified.

### Recovery

- `POST /auth/recovery/verify` with a recovery code; consumes it, rotates the session to verified.
- `POST /auth/password/reset` with email, recovery code, and new password; revokes all sessions and issues new recovery codes.

### Sessions

- `GET /auth/sessions` lists active sessions with IP, user agent, last seen, expiry, current flag.
- `DELETE /auth/sessions/:id` revokes a session; current session clears cookies.
- Password change revokes all other sessions.

## Guards

- `AuthGuard`: requires a valid session cookie; attaches user/session to the request.
- `TwoFactorGuard`: requires `twoFactorVerified` for all protected routes, except `@Public()` and `@AllowPending2fa()` auth endpoints.
- `CsrfGuard`: requires `X-CSRF-Token` matching the CSRF cookie and the session hash for state-changing requests.
- `@Public()`: setup, login, auth status, password reset.
- `@AllowPending2fa()`: me, TOTP setup/enable/verify, recovery verify, logout.

## Cookies

- `nexter_session`: httpOnly, Secure in staging/production, SameSite=Lax, path `/`, 30-day default.
- `nexter_csrf`: readable by the SPA, Secure in staging/production, SameSite=Lax, path `/`.
- CSRF header: `X-CSRF-Token`.

## Rate limits

- Login: 10 attempts / 15 minutes per IP; 15-minute block.
- Setup: 5 attempts / 15 minutes per IP.
- TOTP/recovery: 5 attempts / 5 minutes per session; 15-minute block.
- Password change/recovery-code regeneration: 5 attempts / 15 minutes per user.
- Password reset: 5 attempts / 15 minutes per IP.

## Environment

- `SETUP_TOKEN` required in production/staging and for first-run setup.
- `AUTH_ENCRYPTION_KEY` required in production/staging; 32-byte base64 or 64-char hex.
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

## Acceptance criteria

- First-run setup works exactly once with a valid setup token.
- Password login + TOTP flow works end-to-end.
- Recovery code login consumes the code.
- Password reset revokes all sessions and issues new recovery codes.
- Session list shows IP, user agent, last seen, and current session.
- CSRF token is required for authenticated mutations.
- Auth failures are rate-limited and audited.
- No email is sent.
- No private keys or seed phrases are requested.
