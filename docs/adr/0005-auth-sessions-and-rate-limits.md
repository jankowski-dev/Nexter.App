# ADR 0005 — Auth sessions, rate limits, and single-owner invariants

## Status

Accepted.

## Context

Phase 2 added authentication and security on top of the Phase 1 schema. The original schema already contained `users`, `sessions`, and `audit_log`, but it lacked CSRF state, a 2FA-verified flag, database-backed throttling, and a hard guarantee that Nexter has exactly one owner.

## Decision

### Sessions

- Sessions are server-side. The browser receives a random session token; the database stores only its SHA-256 hash.
- Each session also stores a hashed CSRF token and a `two_factor_verified` flag.
- A session created by setup or password login is pending until TOTP or a recovery code is verified. Pending sessions can only call `@AllowPending2fa()` auth endpoints.
- Password change rotates the current session: the old session is revoked, all other sessions are revoked, and a new verified session is issued.
- Password reset revokes every session for the owner.
- Session lifetime is an absolute 30-day TTL (`SESSION_TTL_DAYS`). Activity updates `last_seen_at` but does not extend `expires_at`. This is a deliberate MVP-1 simplification; sliding renewal would require refreshing both the session cookie and the CSRF cookie safely.

### CSRF

- State-changing requests require `X-CSRF-Token`, the `nexter_csrf` cookie, and a hash match against the session's `csrf_token_hash`.
- Every non-safe request with an `Origin`/`Referer` must match `APP_URL`, including public setup/login/reset requests.
- Public endpoints (setup, login, password reset) are exempt from the CSRF token check because they have no authenticated session; they are rate-limited and audited instead.

### Rate limits

- Throttle counters live in `rate_limits` so limits survive process restarts and work across instances.
- Login is limited per IP and per IP+email pair. The login counter is reset only after successful 2FA or a password reset/change, not after a correct password. A global per-email lockout is intentionally avoided to prevent unauthenticated denial of service against the single owner.
- Password reset uses the same composite IP+email and per-IP keys, avoiding a global recovery-email lockout.
- TOTP and recovery verification share a per-user counter (`2fa:<user_id>`). The counter is checked before decrypting or verifying a code, so a valid code cannot bypass an active block.
- Counters are updated with a single `INSERT … ON CONFLICT … DO UPDATE … RETURNING` statement to make increments atomic.
- Successful password reset or password change clears the per-user 2FA lockout and login counters, so recovery is not blocked by a prior attack.
- Auth endpoints also pass through a process-local request limiter in `main.ts` (10/min for auth attempts, 60/min for other mutations, 300/min for reads). The database counters are the authoritative auth lockout; the process-local limiter is defense in depth for a single instance.

### Single owner

- `users` has a unique expression index `users_singleton_unique` on `((true))`.
- First-run setup runs in a transaction holding a PostgreSQL advisory lock. The loser of a concurrent setup race receives `409 ALREADY_INITIALIZED`.
- `users_singleton_unique` is the database-level backstop; the advisory lock provides a clean error instead of a unique-constraint failure.

### Audit

- Credential and session mutations write audit rows in the same transaction as the mutation (`strict: true`). If the audit insert fails, the mutation rolls back.
- Failed login/setup/2FA attempts and rate-limit blocks are audited best-effort so a database outage does not turn an authentication rejection into a 500.

## Consequences

- TOTP brute force is bounded per user even if an attacker has the password and creates new pending sessions.
- Two owners cannot be created even under concurrent requests.
- A stolen session cookie does not survive a password change.
- Absolute session TTL means an active user is logged out after 30 days; this is documented and can be revisited with a cookie-refresh design.
- `rate_limits` and `sessions` grow over time and need periodic cleanup (deferred operational job).
- Process-local request limiter is not shared between replicas; database-backed auth limits remain correct.
