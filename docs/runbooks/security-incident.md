# Security Incident Runbook

## Scope

Use for suspected credential compromise, session theft, unauthorized ledger changes, leaked secrets, suspicious login activity, or a dependency/supply-chain alert.

## Detect

- Sentry alert or 5xx spike.
- Repeated `auth.login_failed`, `auth.rate_limited`, `auth.password_reset_failed`, or `auth.recovery_verify_failed` audit entries.
- Unexpected `accounting.transaction_created`, `import.notion_committed`, `settings.updated`, or export events.
- User report of an unknown session or changed data.
- Secret-scan or dependency-audit alert in CI.

Useful read-only queries:

```sql
select created_at, action, entity_type, entity_id, ip, user_agent
from audit_log
where action like 'auth.%' or action like 'accounting.%' or action like 'import.%'
order by created_at desc
limit 100;

select id, ip, user_agent, created_at, last_seen_at, expires_at, revoked_at
from sessions
order by created_at desc;
```

## Contain

1. If the account may be compromised, revoke all sessions:
   - Settings → Security → revoke individual sessions, or
   - `update sessions set revoked_at = now() where user_id = '<owner-id>' and revoked_at is null;`
2. Change the owner password (this revokes other sessions and rotates the current one).
3. Regenerate recovery codes and store them offline.
4. If TOTP may be compromised, disable/re-enroll TOTP only through a controlled recovery procedure; record every step in `audit_log`.
5. If `AUTH_ENCRYPTION_KEY` may be leaked, treat TOTP secrets as compromised: rotate the key, re-encrypt `users.totp_secret_encrypted`, and force TOTP re-enrollment. Do not rotate the key without a tested re-encryption plan; an incorrect rotation locks out 2FA.
6. If `SETUP_TOKEN` leaked, rotate the Railway variable. Setup is already initialized and returns `409`, but rotate anyway.
7. If the database or backup credentials leaked, rotate Railway/R2 credentials, revoke the old tokens, and take a fresh verified backup.
8. If ledger data was changed outside the app, freeze writes (`@nexter/worker` stopped, API maintenance) and preserve the database and audit log before any repair. Corrections must be new transactions, never edits or deletes.

## Recover

- Restore from a verified backup/PITR if data integrity is in doubt (see `docs/runbooks/restore.md`).
- Redeploy the last known good image if the incident is application-related.
- Verify `/health`, `/ready`, login, 2FA, dashboard totals, and audit entries.
- Re-enable the worker and writes.

## Postmortem

Record: detection time, containment time, recovery time, data-loss window, root cause, affected data, and follow-up actions. Update `docs/specs/threat-model.md` and this runbook when the threat changes.

## Key rotation notes

- `AUTH_ENCRYPTION_KEY`: encrypts TOTP secrets. Rotation requires decrypt-with-old/encrypt-with-new inside a transaction; test on a restored copy first.
- `SETUP_TOKEN`: only used before initialization; rotate if leaked and keep it in Railway secrets.
- Session/CSRF tokens: rotate by revoking sessions; no server-wide secret.
- R2 credentials: use a dedicated write-only token for backups and a separate read token for restores.
- Sentry DSN: rotate if abused; it is not an authorization secret.

## Guardrails

- No private keys or seed phrases are ever stored or requested by the server.
- Never paste secrets, cookies, TOTP codes, recovery codes, or full export data into prompts, screenshots, issues, or logs.
- Do not delete audit records. If audit data must be corrected, add a new audited incident record.
