import { asc, eq, sql } from 'drizzle-orm';
import { createDb, sandboxEvents, sandboxRuns, type Database } from '@nexter/db';
import { GENESIS_HASH, type SandboxEventInput } from '@nexter/sandbox-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SandboxEventLog, listSandboxEvents } from '../src/modules/sandbox/sandbox-event-log';
import { assertDisposableTestDatabase } from './helpers/test-database';
import { seedSandboxRun } from './helpers/sandbox-fixtures';

const canRun = Boolean(process.env.NEXTER_TEST_DB === '1' && process.env.DATABASE_URL);

if (canRun) {
  assertDisposableTestDatabase(process.env.DATABASE_URL);
}

function eventInput(runId: string, eventType: string): SandboxEventInput {
  return {
    runId,
    clockTime: '2026-01-01T01:00:00.000Z',
    module: 'run',
    eventType,
    severity: 'info',
    dataSnapshotId: 'snapshot-1',
    configVersion: 'config-1',
    seed: 7,
  };
}

describe.runIf(canRun)('sandbox db event log', () => {
  let db: Database;
  let pool: ReturnType<typeof createDb>['pool'];

  beforeAll(() => {
    const created = createDb(process.env.DATABASE_URL ?? '');
    db = created.db;
    pool = created.pool;
  });

  beforeEach(async () => {
    await db.execute(sql`truncate table users restart identity cascade`);
  });

  afterAll(async () => {
    await pool.end();
  });

  function withLog<T>(runId: string, work: (log: SandboxEventLog) => Promise<T>): Promise<T> {
    return db.transaction(async (tx) => work(await SandboxEventLog.load(tx, runId)));
  }

  it('appends seq 0 with the genesis prevHash and advances the run head', async () => {
    const { runId } = await seedSandboxRun(db);

    const events = await withLog(runId, async (log) => {
      expect(log.events()).toEqual([]);
      expect(log.hash()).toBe(GENESIS_HASH);

      const first = await log.append(eventInput(runId, 'run.started'));
      const second = await log.append(eventInput(runId, 'run.ticked'));
      const third = await log.append(eventInput(runId, 'run.paused'));

      expect(log.events()).toHaveLength(3);
      expect(log.hash()).toBe(third.hash);
      return [first, second, third];
    });

    expect(events.map((event) => event.seq)).toEqual([0, 1, 2]);
    expect(events[0]?.prevHash).toBe(GENESIS_HASH);
    expect(events[1]?.prevHash).toBe(events[0]?.hash);
    expect(events[2]?.prevHash).toBe(events[1]?.hash);

    const [run] = await db
      .select({ eventSeq: sandboxRuns.eventSeq, eventHash: sandboxRuns.eventHash })
      .from(sandboxRuns)
      .where(eq(sandboxRuns.id, runId));
    expect(run).toEqual({ eventSeq: 3, eventHash: events[2]?.hash });

    const rows = await db
      .select()
      .from(sandboxEvents)
      .where(eq(sandboxEvents.runId, runId))
      .orderBy(asc(sandboxEvents.seq));
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.seq)).toEqual([0, 1, 2]);
    expect(rows[2]?.hash).toBe(events[2]?.hash);
  });

  it('reloads a committed chain, verifies it and continues from its head', async () => {
    const { runId } = await seedSandboxRun(db);
    const original = await withLog(runId, async (log) => [
      await log.append(eventInput(runId, 'run.started')),
      await log.append(eventInput(runId, 'run.ticked')),
    ]);

    await withLog(runId, async (log) => {
      expect(log.events()).toEqual(original);
      expect(log.hash()).toBe(original[1]?.hash);

      const verification = await log.verify();
      expect(verification).toMatchObject({
        ok: true,
        count: 2,
        lastSeq: 1,
        headHash: original[1]?.hash,
        errors: [],
      });

      const next = await log.append(eventInput(runId, 'run.resumed'));
      expect(next.seq).toBe(2);
      expect(next.prevHash).toBe(original[1]?.hash);
    });

    const staticVerification = await SandboxEventLog.verifyRun(db, runId);
    expect(staticVerification).toMatchObject({ ok: true, count: 3, lastSeq: 2 });

    const page = await listSandboxEvents(db, runId, { afterSeq: 0, limit: 1 });
    expect(page.map((event) => event.seq)).toEqual([1]);
    const all = await listSandboxEvents(db, runId);
    expect(all.map((event) => event.seq)).toEqual([0, 1, 2]);
  });

  it('detects a corrupted payload and a tampered chain', async () => {
    const { runId } = await seedSandboxRun(db);
    await withLog(runId, async (log) => {
      await log.append(eventInput(runId, 'run.started'));
      await log.append(eventInput(runId, 'run.ticked'));
    });

    // Payload-only tampering: the columns no longer describe the payload.
    await db.execute(
      sql`update sandbox_events
            set payload = jsonb_set(payload, '{eventType}', '"run.tampered"')
          where run_id = ${runId} and seq = 1`,
    );
    await expect(db.transaction((tx) => SandboxEventLog.load(tx, runId))).rejects.toMatchObject({
      code: 'SANDBOX_EVENT_PAYLOAD_INVALID',
    });

    // Column+payload tampering keeps them consistent but breaks the hash chain.
    await db.execute(
      sql`update sandbox_events
            set event_type = 'run.tampered',
                payload = jsonb_set(payload, '{eventType}', '"run.tampered"')
          where run_id = ${runId} and seq = 1`,
    );
    const verification = await SandboxEventLog.verifyRun(db, runId);
    expect(verification.ok).toBe(false);
    expect(verification.errors[0]).toMatch(/hash mismatch/);
    await expect(db.transaction((tx) => SandboxEventLog.load(tx, runId))).rejects.toMatchObject({
      code: 'SANDBOX_EVENT_CHAIN_DESYNC',
    });
  });

  it('detects a chain whose persisted run head was truncated', async () => {
    const { runId } = await seedSandboxRun(db);
    await withLog(runId, async (log) => {
      await log.append(eventInput(runId, 'run.started'));
      await log.append(eventInput(runId, 'run.ticked'));
    });

    // The rows still link cleanly, but the run row no longer describes their
    // head. This is what a partial restore would look like.
    await db.execute(
      sql`update sandbox_runs set event_seq = 1, event_hash = ${GENESIS_HASH} where id = ${runId}`,
    );

    const verification = await SandboxEventLog.verifyRun(db, runId);
    expect(verification).toMatchObject({ ok: false, count: 2, lastSeq: 1 });
    expect(verification.errors[0]).toMatch(/persisted head is seq 1/);

    await expect(db.transaction((tx) => SandboxEventLog.load(tx, runId))).rejects.toMatchObject({
      code: 'SANDBOX_EVENT_CHAIN_DESYNC',
    });
  });

  it('does not advance the in-memory chain when the insert fails', async () => {
    const { runId } = await seedSandboxRun(db);
    let captured: SandboxEventLog | undefined;

    await expect(
      db.transaction(async (tx) => {
        const log = await SandboxEventLog.load(tx, runId);
        captured = log;
        // Occupy the next sequence so the log's insert hits the primary key.
        await tx.insert(sandboxEvents).values({
          runId,
          seq: 0,
          clockTime: new Date('2026-01-01T01:00:00.000Z'),
          module: 'run',
          eventType: 'run.conflict',
          severity: 'info',
          payload: { note: 'conflict' },
          hash: 'f'.repeat(64),
          prevHash: GENESIS_HASH,
        });

        await log.append(eventInput(runId, 'run.started'));
      }),
      // Drizzle wraps the Postgres error (`Failed query: insert ...`), so match
      // any throw here and rely on the chain invariants asserted below.
    ).rejects.toThrow();

    expect(captured?.events()).toEqual([]);
    expect(captured?.hash()).toBe(GENESIS_HASH);

    const rows = await db.select().from(sandboxEvents);
    expect(rows).toHaveLength(0);
    const [run] = await db
      .select({ eventSeq: sandboxRuns.eventSeq, eventHash: sandboxRuns.eventHash })
      .from(sandboxRuns)
      .where(eq(sandboxRuns.id, runId));
    expect(run).toEqual({ eventSeq: 0, eventHash: GENESIS_HASH });
  });

  it('fails closed when the persisted run head disagrees with the stored chain', async () => {
    const { runId } = await seedSandboxRun(db, { eventSeq: 5 });

    await expect(
      withLog(runId, (log) => log.append(eventInput(runId, 'run.started'))),
    ).rejects.toMatchObject({ code: 'SANDBOX_EVENT_CHAIN_DESYNC' });

    const rows = await db.select().from(sandboxEvents);
    expect(rows).toHaveLength(0);
  });

  it('rejects an unknown run before it can append', async () => {
    const missingRunId = '33333333-3333-4333-8333-333333333333';

    await expect(
      withLog(missingRunId, (log) => log.append(eventInput(missingRunId, 'run.started'))),
    ).rejects.toMatchObject({ code: 'SANDBOX_RUN_NOT_FOUND' });
  });
});
