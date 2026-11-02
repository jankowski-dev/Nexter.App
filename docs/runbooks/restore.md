# Restore Runbook

## Targets

- RPO: 1 hour (PITR).
- RTO: 4 hours.

## Sources

- Railway PostgreSQL PITR.
- Encrypted daily `pg_dump` in Cloudflare R2.
- Monthly encrypted dumps retained for 12 months.

## Steps

1. Declare an incident and freeze writes (disable swaps, stop worker, put API in maintenance if needed).
2. Identify the restore point.
3. Create a new PostgreSQL instance or restore into staging first.
4. Restore from PITR or from the encrypted dump.
5. Run migrations only if the restore point is behind the current schema; prefer restoring to the matching app version.
6. Verify:
   - table counts;
   - users/sessions/settings/audit log;
   - ledger invariants once accounting exists;
   - `/ready` returns 200.
7. Point the API and worker at the restored database.
8. Re-enable writes.
9. Record timeline, data loss window, root cause, and follow-up actions.

## Verification queries

```sql
select count(*) from users;
select count(*) from sessions;
select count(*) from audit_log;
select count(*) from settings;
```

## Rules

- Never restore over production without a verified backup.
- Never delete the old database until the new one is verified.
- Test restore quarterly.
