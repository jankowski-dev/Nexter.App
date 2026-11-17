# ADR 0064 — TOTP replay protection and immutable audit log

## Status

Accepted. 2026-11-17. Migration `0043` requires a verified backup and a restore-check before production.

## Context

The independent audit found two data/security gaps:

1. A valid TOTP code could be replayed inside the ±30-second verification window. The code was checked for validity but the consumed time step was not persisted, so the same six digits could be used for login, step-up, or a retry.
2. `audit_log` is protected from the application role (`nexter_app` has no `UPDATE`/`DELETE`), but the owner/migration role could still edit or delete rows. The ledger is append-only by design, and the audit log should be as well.

The audit also recommended an index on `audit_log(user_id)` for per-user queries.

## Decision

### TOTP replay protection

- Add nullable `users.last_totp_step` (integer). Existing users keep `NULL` and accept the first valid code after the migration.
- `TotpService.verify` returns the matched time step (`epoch / 30`) instead of a boolean and accepts an `afterTimeStep` value, which is passed to otplib as a pre-check.
- Every TOTP flow (TOTP enable, login verification, step-up) consumes the step with a single conditional update inside the same transaction as the action it authorizes:
  `UPDATE users SET last_totp_step = $step WHERE id = $id AND (last_totp_step IS NULL OR last_totp_step < $step)`.
- If the update returns no row, the request is rejected with `TOTP_REPLAY` (401) and audited as `auth.totp_replay_rejected` with the flow name. The transaction has no effect.
- The same code therefore cannot authorize two operations or two concurrent requests in the same 30-second period. A user who logs in and immediately needs step-up must wait for the next code.
- Recovery codes are not TOTP and are unchanged.

### Audit log

- Add `audit_log_user_id_idx` on `audit_log(user_id)`.
- Add a `BEFORE UPDATE OR DELETE` row trigger on `audit_log` that raises an exception. This is defense-in-depth for the owner/migration role; the application role already lacks those grants.
- `TRUNCATE` is intentionally not blocked because the test suites and restore drill truncate/drop tables. Production rows are still append-only in normal operation.
- Corrections to audit history must be new rows with an explanation, never edits.

### Migration and rollback

Migration `0043` is additive:

- `ALTER TABLE users ADD COLUMN last_totp_step integer;`
- `CREATE INDEX audit_log_user_id_idx ON audit_log (user_id);`
- `CREATE FUNCTION prevent_audit_log_mutation()` and `CREATE TRIGGER audit_log_no_mutation BEFORE UPDATE OR DELETE ON audit_log`.

Rollback (forward-fix preferred): drop the trigger and function, drop the index, and drop the column. Dropping the column loses replay state only; no ledger data is affected. Take an encrypted backup, restore it into a scratch database, run the migration there, and verify auth tests before applying it in production.

## Consequences

- Replay of an intercepted TOTP code is rejected across all flows.
- TOTP verification fails closed if the replay-state update cannot be written.
- Audit history is protected even from the schema owner while the trigger exists.
- Deleting a user would fail because the audit log FK uses `ON DELETE SET NULL`; users are never deleted by the application. Any future user-deletion feature must archive instead.
- No change to session, ledger, swap, bot, or AI tables.
