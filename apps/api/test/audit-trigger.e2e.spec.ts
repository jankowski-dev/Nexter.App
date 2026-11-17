import { eq, sql } from 'drizzle-orm';
import { auditLog, createDb, type Database } from '@nexter/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertDisposableTestDatabase } from './helpers/test-database';

const canRun = Boolean(process.env.NEXTER_TEST_DB === '1' && process.env.DATABASE_URL);

if (canRun) {
  assertDisposableTestDatabase(process.env.DATABASE_URL);
}

describe.runIf(canRun)('audit_log immutability', () => {
  let db: Database;
  let pool: ReturnType<typeof createDb>['pool'];

  beforeAll(() => {
    const created = createDb(process.env.DATABASE_URL ?? '');
    db = created.db;
    pool = created.pool;
  });

  afterAll(async () => {
    await db.execute(sql`truncate table audit_log`);
    await pool.end();
  });

  it('rejects UPDATE and DELETE while keeping TRUNCATE available for tests', async () => {
    await db.insert(auditLog).values({
      action: 'audit_trigger_probe',
      entityType: 'test',
    });

    const [row] = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'audit_trigger_probe'))
      .limit(1);

    expect(row).toBeDefined();
    if (!row) throw new Error('Probe audit row was not inserted');

    await expect(
      db.update(auditLog).set({ action: 'changed' }).where(eq(auditLog.id, row.id)),
    ).rejects.toThrow(/append-only/);

    await expect(db.delete(auditLog).where(eq(auditLog.id, row.id))).rejects.toThrow(/append-only/);
  });
});
