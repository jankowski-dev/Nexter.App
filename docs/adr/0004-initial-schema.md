# ADR 0004 — Initial schema

## Status

Accepted.

## Context

Phase 1 needs a minimal schema for the future auth/session layer and audit log. Accounting tables are intentionally deferred to Phase 3.

## Decision

Create four tables in the initial schema:

- `users` — owner account, password hash, encrypted TOTP secret, TOTP enabled flag, hashed recovery codes, role, timestamps.
- `sessions` — hashed session token, user, IP, user agent, expiry, last seen, revocation.
- `audit_log` — actor, action, entity, before/after JSON, IP, user agent, timestamp.
- `settings` — per-user base currency, display currency, tax method, gas capitalization, timezone.

Use UUID primary keys with `gen_random_uuid()`. `gen_random_uuid()` is built into PostgreSQL 13+, so no `pgcrypto` extension is required.

The initial schema is split into two migrations:

- `0000` creates the tables and indexes.
- `0001` adds `users.totp_enabled` and `sessions.last_seen_at` for Phase 2 auth.

## Consequences

- Auth can be implemented in Phase 2 without an additional schema migration unless new requirements appear.
- Accounting tables remain a separate, reviewed migration in Phase 3.
- The schema is intentionally minimal; no business data is stored before its phase.
