import { sql } from 'drizzle-orm';
import { createDb, type Database } from '@nexter/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertDisposableTestDatabase } from './helpers/test-database';

const canRun = Boolean(process.env.NEXTER_TEST_DB === '1' && process.env.DATABASE_URL);

if (canRun) {
  assertDisposableTestDatabase(process.env.DATABASE_URL);
}

const SANDBOX_TABLES = [
  'sandbox_tokens',
  'sandbox_candles',
  'sandbox_runs',
  'sandbox_run_tokens',
  'sandbox_events',
  'sandbox_positions',
  'sandbox_trades',
  'sandbox_ledger_entries',
  'sandbox_equity_points',
  'sandbox_intents',
  'sandbox_reports',
];

const SANDBOX_INDEXES = [
  'sandbox_tokens_user_token_unique',
  'sandbox_tokens_user_idx',
  'sandbox_candles_pk',
  'sandbox_candles_token_time_idx',
  'sandbox_runs_user_status_archived_idx',
  'sandbox_runs_status_idx',
  'sandbox_run_tokens_pk',
  'sandbox_events_pk',
  'sandbox_events_run_clock_idx',
  'sandbox_positions_pk',
  'sandbox_trades_pk',
  'sandbox_trades_run_token_idx',
  'sandbox_ledger_entries_pk',
  'sandbox_ledger_entries_run_entry_unique',
  'sandbox_equity_points_pk',
  'sandbox_intents_pk',
  'sandbox_intents_run_decision_idx',
  'sandbox_reports_pk',
];

describe.runIf(canRun)('sandbox stage 2 schema', () => {
  let db: Database;
  let pool: ReturnType<typeof createDb>['pool'];

  beforeAll(() => {
    const created = createDb(process.env.DATABASE_URL ?? '');
    db = created.db;
    pool = created.pool;
  });

  afterAll(async () => {
    await pool.end();
  });

  it('creates every sandbox table', async () => {
    const result = await db.execute(sql`
      select table_name
      from information_schema.tables
      where table_schema = 'public' and table_name like 'sandbox\_%'
    `);
    const names = (result.rows as Array<{ table_name: string }>).map((row) => row.table_name);

    expect(names.sort()).toEqual([...SANDBOX_TABLES].sort());
  });

  it('creates the declared indexes and composite primary keys', async () => {
    const result = await db.execute(sql`
      select indexname
      from pg_indexes
      where schemaname = 'public' and indexname like 'sandbox%'
    `);
    const names = new Set(
      (result.rows as Array<{ indexname: string }>).map((row) => row.indexname),
    );

    for (const index of SANDBOX_INDEXES) {
      expect(names.has(index), `missing index ${index}`).toBe(true);
    }
  });

  it('gives the app role no DELETE on any sandbox table', async () => {
    const role = await db.execute(sql`select 1 from pg_roles where rolname = 'nexter_app'`);

    if (role.rows.length === 0) {
      // CI migrates as the postgres superuser; the app-role grants are applied
      // only where the deployment role exists.
      return;
    }

    const grants = await db.execute(sql`
      select table_name, privilege_type
      from information_schema.role_table_grants
      where grantee = 'nexter_app' and table_name like 'sandbox\_%'
    `);
    const rows = grants.rows as Array<{ table_name: string; privilege_type: string }>;

    expect(rows.some((row) => row.privilege_type === 'DELETE')).toBe(false);

    const eventPrivileges = rows
      .filter((row) => row.table_name === 'sandbox_events')
      .map((row) => row.privilege_type)
      .sort();
    expect(eventPrivileges).toEqual(['INSERT', 'SELECT']);

    const tokenPrivileges = rows
      .filter((row) => row.table_name === 'sandbox_tokens')
      .map((row) => row.privilege_type)
      .sort();
    expect(tokenPrivileges).toEqual(['INSERT', 'SELECT', 'UPDATE']);
  });
});
