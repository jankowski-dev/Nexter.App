import { eq, sql } from 'drizzle-orm';
import { createDb, sandboxEquityPoints, sandboxEvents, sandboxPositions } from '@nexter/db';
import { GENESIS_HASH, type SandboxEventInput } from '@nexter/sandbox-core';
import Decimal from 'decimal.js';
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

  it('rejects the empty JSONB default once a run is no longer a draft', async () => {
    const { runId } = await seedSandboxRun(db, { status: 'running' });

    await expect(repository.loadRun(runId)).rejects.toMatchObject({
      code: 'SANDBOX_STATE_INVALID',
    });
    await expect(repository.loadRun(runId)).rejects.toThrow(/only allowed for a draft/);
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
    // Keep the tick identities consistent so the failure comes from Postgres,
    // not from the pre-write consistency guard.
    const badLedger = {
      ...open.ledger,
      positions: { [badTokenId]: { ...realPosition, tokenId: badTokenId } },
    };
    const badMarked = {
      ...open.marked,
      positions: [{ ...realMark, tokenId: badTokenId }],
    };
    const badTick = makeTick(badLedger, badMarked, open.intents, {
      engineState: makeEngineState(),
      lastBarClose: new Date(SANDBOX_TEST_AT + SANDBOX_TEST_HOUR),
    });

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

  it('rolls back appended events, state and projections when the projection fails', async () => {
    const { runId } = await seedSandboxRun(db);
    const open = makeOpenLedger();
    const realPosition = open.ledger.positions[SANDBOX_TEST_TOKEN];
    const realMark = open.marked.positions[0];
    if (realPosition === undefined || realMark === undefined) {
      throw new Error('fixture is missing its position');
    }
    const badTokenId = 'bad\u0000token';
    const badLedger = {
      ...open.ledger,
      positions: { [badTokenId]: { ...realPosition, tokenId: badTokenId } },
    };
    const badMarked = {
      ...open.marked,
      positions: [{ ...realMark, tokenId: badTokenId }],
    };
    const badTick = makeTick(badLedger, badMarked, open.intents);

    await expect(
      repository.commitTick(runId, async ({ eventLog }) => {
        await eventLog.append(eventInput(runId, 'run.started'));
        return badTick;
      }),
    ).rejects.toThrow(/invalid byte sequence|0x00/i);

    expect(await db.select().from(sandboxEvents)).toHaveLength(0);
    const run = await repository.loadRun(runId);
    expect(run).toMatchObject({ eventSeq: 0, eventHash: GENESIS_HASH, status: 'running' });
    expect(await db.select().from(sandboxPositions)).toHaveLength(0);
    expect(await db.select().from(sandboxEquityPoints)).toHaveLength(0);
  });

  it('persists and clears the last error and updates lastTickAt', async () => {
    const { runId } = await seedSandboxRun(db);
    const open = makeOpenLedger();
    const first = makeTick(open.ledger, open.marked, open.intents, {
      error: 'stale market data',
    });

    await repository.persistTick(runId, first);
    let run = await repository.loadRun(runId);
    expect(run).toMatchObject({ error: 'stale market data' });
    expect(run?.lastTickAt?.getTime()).toBe(first.lastTickAt.getTime());

    const second = makeTick(open.ledger, open.marked, open.intents, {
      error: null,
      lastBarClose: new Date(SANDBOX_TEST_AT + SANDBOX_TEST_HOUR),
      lastTickAt: new Date(SANDBOX_TEST_AT + SANDBOX_TEST_HOUR),
    });
    await repository.persistTick(runId, second);
    run = await repository.loadRun(runId);
    expect(run).toMatchObject({ error: null });
    expect(run?.lastTickAt?.getTime()).toBe(second.lastTickAt.getTime());
  });

  it('refuses to project a ledger that no longer matches the persisted journal', async () => {
    const { runId } = await seedSandboxRun(db);
    const open = makeOpenLedger();
    await repository.persistTick(runId, makeTick(open.ledger, open.marked, open.intents));

    const entry = open.ledger.entries[0];
    if (!entry) throw new Error('fixture has no ledger entry');
    // A restored-older state would carry a different entry at the same sequence.
    const olderLedger = {
      ...open.ledger,
      entries: [{ ...entry, entryId: 'other-intent:ledger' }],
    };

    await expect(
      repository.persistTick(runId, makeTick(olderLedger, open.marked, [])),
    ).rejects.toMatchObject({ code: 'SANDBOX_STATE_INVALID' });
    await expect(
      repository.persistTick(runId, makeTick(olderLedger, open.marked, [])),
    ).rejects.toThrow(/persisted entry/);
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
      stopLossPct: null,
      takeProfitPct: null,
    });
    expect(position && new Decimal(position.avgCostUsd).equals(0)).toBe(true);
    expect(position && new Decimal(position.marketPriceUsd).equals(0)).toBe(true);
    expect(position && new Decimal(position.feesPaidUsd).equals(0)).toBe(true);
    expect(await db.select().from(sandboxPositions)).toHaveLength(1);
  });
});
