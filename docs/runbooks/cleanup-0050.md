# Cleanup migration 0050 — runbook

Status: prepared 2026-11-19; not deployed yet.

## Scope

Migration `packages/db/drizzle/0050_absurd_mephisto.sql` drops abandoned, verified-empty objects:

- `automation_rules`, `automation_rule_state`, `automation_runs`;
- `ai_approvals`;
- `ai_profiles.auto_approve_*`;
- unused `settings.automation_*` columns.

It keeps `automation_default_stop_loss_pct`, `automation_default_take_profit_pct` and `automation_default_buy_amount_usd` (API names `tradeDefault*`) and all kept AI tables.

## Preflight (read-only, production)

Run before deploy; all counts/statuses must be zero:

```sql
select 'automation_rules', count(*) from automation_rules
union all select 'automation_rule_state', count(*) from automation_rule_state
union all select 'automation_runs', count(*) from automation_runs
union all select 'ai_approvals', count(*) from ai_approvals;

select count(*) from settings
where automation_enabled = true or automation_mode <> 'dry_run';
```

2026-11-19 result: `0,0,0,0` and `0` modified settings.

## Backup and restore check

- Encrypted backup: `nexter-2026-11-19-pre-ai-cleanup.dump.enc`
- SHA-256: `ed35dc9b283ff9714fac3dfca07a7c011fc79dd5c9d3fb5f57f153c44aac1a5a`
- Decrypt round-trip: verified.
- Migration test on a restored production copy: passed; dropped objects absent, three per-order defaults kept, `ai_candidates` preserved.

## Deploy order

1. Take/confirm the encrypted backup and record SHA-256.
2. Apply `0050` via the normal pre-deploy migration step.
3. Run `provision-app-role.mjs` (it no longer names dropped tables).
4. Deploy the API/web image.
5. Verify `/health`, `/ready`, AI tab/settings, and `tradeDefault*` GET/PATCH.
6. Record deployment/bundle IDs in `AGENTS.md` and `docs/decisions.md`.

## Rollback

- Application: redeploy `c626449` (`assets/index-iFPmNXg0.js`).
- Database: dropped tables/columns can remain dropped for the application rollback; if full data rollback is required, restore the encrypted backup to a clean database and repoint the service using the documented restore runbook.
- Do not recreate `automation_*`/`ai_approvals` in code; they are intentionally abandoned.
