# ADR 0004 — Initial schema

## Status

Accepted.

## Context

Phase 1 needs a minimal schema for the future auth/session layer and audit log. Accounting tables are intentionally deferred to Phase 3.

## Decision

Create four tables in the initial migration:

- `users` — owner account, password hash, encrypted TOTP secret, hashed recovery codes, role, timestamps.
- `sessions` — hashed session token, user, IP, user agent, expiry, revocation.
- `audit_log` — actor, action, entity, before/after JSON, IP, user agent, timestamp.
- `settings` — per-user base currency, display currency, tax method, gas capitalization, timezone.

Use UUID primary keys with `gen_random_uuid()`. `gen_random_uuid()` is built into PostgreSQL 13+, so no `pgcrypto` extension is required.

## Consequences

- Auth can be implemented in Phase 2 without a new schema migration.
- Accounting tables remain a separate, reviewed migration in Phase 3.
- The schema is intentionally minimal; no business data is stored before its phase.
