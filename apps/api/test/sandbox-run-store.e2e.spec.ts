import { eq, sql } from 'drizzle-orm';
import { createDb, sandboxEquityPoints, sandboxEvents, sandboxPositions } from '@nexter/db';
import { GENESIS_HASH, type SandboxEventInput } from '@nexter/sandbox-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SandboxRepository } from '../src/modules/sandbox/sandbox.repository';
import { SandboxPersistenceError } from '../src/modules/sandbox/sandbox.types';
import { assertDisposableTestDatabase } from './helpers/test-database';
import {
  makeClosedLedger,
  makeEngineState,
  makeOpenLedger,
  makeTick,
  SANDBOX_TEST_AT,
  SANDBOX_TEST_HOUR,
  SANDBOX_TEST_TOKEN,
  seedSandboxRun,
} from './helpers/sandbox-fixtures';

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

describe.runIf(canRun)('sandbox run store', () => {
  let db: ReturnType<typeof createDb>['db'];
  let pool: ReturnType<typeof createDb>['pool'];
  let repository: SandboxRepository;

  beforeAll(() => {
    const created = createDb(process.env.DATABASE_URL ?? '');
    db = created.db;
    pool = created.pool;
    repository = new SandboxRepository(db);
  });

  beforeEach(async () => {
    await db.execute(sql`truncate table users restart identity cascade`);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('loads a draft run with uninitialised state and its token snapshot', async () => {
    const { runId, userId } = await seedSandboxRun(db, { status: 'draft' });

    const run = await repository.loadRun(runId);

    expect(run).not.toBeNull();
    expect(run).toMatchObject({
      id: runId,
      userId,
      status: 'draft',
      initialCapitalUsd: '1000.00',
      cashUsd: '1000.00',
      eventSeq: 0,
      eventHash: GENESIS_HASH,
    });
    expect(run?.engineState).toBeNull();
    expect(run?.ledgerState).toBeNull();
    expect(run?.lastBarClose).toBeNull();
    expect(run?.tokens).toEqual([
      {
        tokenKey: SANDBOX_TEST_TOKEN,
        symbol: 'CAKE',
        chain: 'bsc',
        contractAddress: SANDBOX_TEST_TOKEN.slice('bsc:'.length),
        enabled: true,
      },
    ]);
  });

  it('round-trips validated engine and ledger state through JSONB', async () => {
    const open = makeOpenLedger();
    const engineState = makeEngineState();
    const { runId } = await seedSandboxRun(db, {
      engineState,
      ledgerState: open.ledger,
    });

    const run = await repository.loadRun(runId);

    expect(run?.engineState).toEqual(engineState);
    expect(run?.ledgerState).toEqual(open.ledger);
    expect(run?.ledgerState?.positions[SANDBOX_TEST_TOKEN]?.entryIntentId).toBe('intent-1');
  });

  it('fails closed on a corrupt persisted state', async () => {
    const { runId } = await seedSandboxRun(db, { engineState: { tokens: 'nope' } });

    await expect(repository.loadRun(runId)).rejects.toBeInstanceOf(SandboxPersistenceError);
    await expect(repository.loadRun(runId)).rejects.toMatchObject({
      code: 'SANDBOX_STATE_INVALID',
    });
  });

  it('commits run state, events and projections in one tick', async () => {
    const { runId } = await seedSandboxRun(db, { status: 'draft' });
    const open = makeOpenLedger();
    const tick = makeTick(open.ledger, open.marked, open.intents);

    const summary = await repository.commitTick(runId, async ({ eventLog }) => {
      await eventLog.append(eventInput(runId, 'run.started'));
      await eventLog.append(eventInput(runId, 'run.ticked'));
      return tick;
    });

    expect(summary).toMatchObject({
      eventSeq: 2,
      positions: 1,
      trades: 1,
      ledgerEntries: 1,
      intents: 1,
    });
    expect(summary.eventHash).toMatch(/^[0-9a-f]{64}$/);

    const run = await repository.loadRun(runId);
    expect(run).toMatchObject({
      status: 'running',
      cashUsd: tick.cashUsd,
      equityUsd: tick.equityUsd,
      peakEquityUsd: tick.peakEquityUsd,
      dayStartEquityUsd: tick.dayStartEquityUsd,
      eventSeq: 2,
      eventHash: summary.eventHash,
      error: null,
    });
    expect(run?.engineState).toEqual(tick.engineState);
    expect(run?.ledgerState).toEqual(tick.ledgerState);
    expect(run?.lastBarClose?.getTime()).toBe(tick.lastBarClose.getTime());
    expect(run?.lastTickAt?.getTime()).toBe(tick.lastTickAt.getTime());

    expect(await db.select().from(sandboxEvents)).toHaveLength(2);
    expect(await db.select().from(sandboxPositions)).toHaveLength(1);
    expect(await db.select().from(sandboxEquityPoints)).toHaveLength(1);
  });

  it('re-persisting the same tick is idempotent', async () => {
    const { runId } = await seedSandboxRun(db);
    const open = makeOpenLedger();
    const tick = makeTick(open.ledger, open.marked, open.intents);

    await repository.persistTick(runId, tick);
    const second = await repository.persistTick(runId, tick);

    expect(second).toMatchObject({
      positions: 1,
      trades: 1,
      ledgerEntries: 0,
      intents: 1,
    });
    expect(await db.select().from(sandboxPositions)).toHaveLength(1);
    expect(await db.select().from(sandboxEquityPoints)).toHaveLength(1);
  });

  it('rolls back the run state and projections when a projection write fails', async () => {
    const { runId } = await seedSandboxRun(db);
    const open = makeOpenLedger();
    const goodTick = makeTick(open.ledger, open.marked, open.intents);
    await repository.persistTick(runId, goodTick);

    const realPosition = open.ledger.positions[SANDBOX_TEST_TOKEN];
    const realMark = open.marked.positions[0];
    if (realPosition === undefined || realMark === undefined) {
      throw new Error('fixture is missing its position');
    }
    // Postgres rejects a NUL byte in text, so this row fails after the run
    // update and must roll the whole tick back.
    const badTokenId = 'bad\u0000token';
    const badTick = makeTick(
      {
        ...open.ledger,
        positions: {
          ...open.ledger.positions,
          [badTokenId]: { ...realPosition, tokenId: badTokenId },
        },
      },
      {
        ...open.marked,
        positions: [...open.marked.positions, { ...realMark, tokenId: badTokenId }],
      },
      open.intents,
      {
        cashUsd: '1.00',
        engineState: makeEngineState(),
        lastBarClose: new Date(SANDBOX_TEST_AT + SANDBOX_TEST_HOUR),
      },
    );

    await expect(repository.persistTick(runId, badTick)).rejects.toThrow(
      /invalid byte sequence|0x00/i,
    );

    const run = await repository.loadRun(runId);
    expect(run).toMatchObject({
      cashUsd: goodTick.cashUsd,
      equityUsd: goodTick.equityUsd,
      eventSeq: 0,
    });
    expect(run?.engineState).toEqual(goodTick.engineState);
    expect(await db.select().from(sandboxPositions)).toHaveLength(1);
    expect(await db.select().from(sandboxEquityPoints)).toHaveLength(1);
  });

  it('rolls back appended events when the tick callback throws', async () => {
    const { runId } = await seedSandboxRun(db);

    await expect(
      repository.commitTick(runId, async ({ eventLog }) => {
        await eventLog.append(eventInput(runId, 'run.started'));
        throw new Error('decision exploded');
      }),
    ).rejects.toThrow('decision exploded');

    expect(await db.select().from(sandboxEvents)).toHaveLength(0);
    const run = await repository.loadRun(runId);
    expect(run).toMatchObject({ eventSeq: 0, eventHash: GENESIS_HASH, status: 'running' });
    expect(await db.select().from(sandboxPositions)).toHaveLength(0);
    expect(await db.select().from(sandboxEquityPoints)).toHaveLength(0);
  });

  it('persists a closed position as a zero tombstone and keeps its trade', async () => {
    const { runId } = await seedSandboxRun(db);
    const open = makeOpenLedger();
    await repository.persistTick(runId, makeTick(open.ledger, open.marked, open.intents));

    const closed = makeClosedLedger();
    const closedTick = makeTick(closed.ledger, closed.marked, [], {
      lastBarClose: new Date(SANDBOX_TEST_AT + SANDBOX_TEST_HOUR),
      lastTickAt: new Date(SANDBOX_TEST_AT + SANDBOX_TEST_HOUR),
      equityPoint: {
        clockTime: SANDBOX_TEST_AT + SANDBOX_TEST_HOUR,
        equityUsd: closed.marked.equityUsd,
        cashUsd: closed.ledger.cashUsd,
        positionsValueUsd: '0.00',
        drawdownPct: '0.00',
      },
    });
    await repository.persistTick(runId, closedTick);

    const [position] = await db
      .select()
      .from(sandboxPositions)
      .where(eq(sandboxPositions.runId, runId));
    expect(position).toMatchObject({
      tokenId: SANDBOX_TEST_TOKEN,
      amount: '0.00000000',
      costBasisUsd: '0.00',
      marketValueUsd: '0.00',
    });
    expect(await db.select().from(sandboxPositions)).toHaveLength(1);
  });
});
