# Auth Break-Glass Recovery Runbook

Use this only when the owner cannot sign in and recovery codes are unavailable. This is an offline, owner-operated procedure. Agents and CI must not run it against production.

## Preconditions

1. Confirm the request with the owner out-of-band.
2. Put the API in maintenance mode or stop the API service so no login attempts race the change.
3. Take a database backup:

   ```bash
   pg_dump "$DATABASE_URL" --format=custom --file "nexter-before-auth-recovery-$(date +%Y%m%dT%H%M%S).dump"
   ```

4. Connect to the production database with an owner-level role.
5. Record the incident and the reason for break-glass access.

## Option A — Lost TOTP device, password still known

This disables TOTP and revokes all sessions. The owner can log in with the password and is forced through TOTP setup again.

```sql
BEGIN;

UPDATE users
SET totp_enabled = false,
    totp_secret_encrypted = NULL,
    updated_at = now()
WHERE email = 'owner@example.com'
RETURNING id, email;

UPDATE sessions
SET revoked_at = now()
WHERE user_id = (SELECT id FROM users WHERE email = 'owner@example.com')
  AND revoked_at IS NULL;

DELETE FROM rate_limits;

INSERT INTO audit_log (user_id, action, entity_type, entity_id, after)
SELECT id, 'auth.break_glass_totp_disabled', 'user', id::text,
       jsonb_build_object('reason', 'owner lost TOTP device')
FROM users
WHERE email = 'owner@example.com';

COMMIT;
```

After the owner logs in, verify TOTP again and store new recovery codes.

## Option B — Password and recovery codes lost

Generate a new Argon2id hash locally and update the owner row. Do not paste the password into shell history; the example reads it with `read -s`.

```bash
cd apps/api
export OWNER_EMAIL='owner@example.com'
read -s NEW_PASSWORD
export NEW_PASSWORD

node --input-type=module -e "
import { Algorithm, hash } from '@node-rs/argon2';
import pg from 'pg';

const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  await client.query('begin');
  const passwordHash = await hash(process.env.NEW_PASSWORD, {
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
    algorithm: Algorithm.Argon2id,
  });
  const result = await client.query(
    'update users set password_hash = \$1, updated_at = now() where email = \$2 returning id',
    [passwordHash, process.env.OWNER_EMAIL],
  );
  if (result.rowCount !== 1) throw new Error('owner not found');
  const userId = result.rows[0].id;
  await client.query(
    'update sessions set revoked_at = now() where user_id = \$1 and revoked_at is null',
    [userId],
  );
  await client.query('delete from rate_limits');
  await client.query(
    'insert into audit_log (user_id, action, entity_type, entity_id, after) values (\$1, \$2, \$3, \$4, \$5)',
    [userId, 'auth.break_glass_password_reset', 'user', userId, JSON.stringify({ reason: 'owner lost password and recovery codes' })],
  );
  await client.query('commit');
} catch (error) {
  await client.query('rollback');
  throw error;
} finally {
  await client.end();
}
"
unset NEW_PASSWORD
```

After the owner logs in, verify TOTP, regenerate recovery codes, and store them.

## Post-recovery checks

1. Start the API and confirm `/ready`.
2. Log in with the owner account and complete TOTP.
3. List active sessions and revoke anything unexpected.
4. Confirm audit entries exist for the break-glass action.
5. Rotate `SETUP_TOKEN` and `AUTH_ENCRYPTION_KEY` only if compromise is suspected. Rotating the encryption key makes existing TOTP secrets unreadable, so disable TOTP first or re-enrol the owner.
6. Document the incident and the recovery duration.
