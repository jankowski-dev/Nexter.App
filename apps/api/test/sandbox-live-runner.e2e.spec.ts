import { eq, sql } from 'drizzle-orm';
import { createDb, sandboxEquityPoints, sandboxEvents, sandboxRuns } from '@nexter/db';
import { SANDBOX_TIMEFRAME } from '@nexter/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SandboxRepository } from '../src/modules/sandbox/sandbox.repository';
import { SandboxRunnerService } from '../src/modules/sandbox/sandbox-runner.service';
import { AuditService } from '../src/shared/audit/audit.service';
import { assertDisposableTestDatabase } from './helpers/test-database';
import {
  makeEngineState,
  makeOpenLedger,
  SANDBOX_TEST_AT,
  SANDBOX_TEST_TOKEN,
  seedSandboxRun,
} from './helpers/sandbox-fixtures';

const canRun = Boolean(process.env.NEXTER_TEST_DB === '1' && process.env.DATABASE_URL);

if (canRun) {
  assertDisposableTestDatabase(process.env.DATABASE_URL);
}

const HOUR = 3_600_000;

function closedCandles(count = 220) {
  return Array.from({ length: count }, (_, index) => ({
    tokenKey: SANDBOX_TEST_TOKEN,
    timeframe: SANDBOX_TIMEFRAME,
    openTime: new Date(SANDBOX_TEST_AT + index * HOUR),
    open: '100.00000000',
    high: '100.00000000',
    low: '100.00000000',
    close: '100.00000000',
    volumeUsd: '100000.00000000',
    source: 'geckoterminal',
    fetchedAt: new Date(SANDBOX_TEST_AT),
  }));
}

function fakeDataService() {
  return {
    latestPrice: async () => ({
      tokenId: SANDBOX_TEST_TOKEN,
      priceUsd: '100.00000000',
      volumeUsd: '100000.00000000',
      asOf: new Date(SANDBOX_TEST_AT),
    }),
  };
}

describe.runIf(canRun)('sandbox live runner persistence', () => {
  let created: ReturnType<typeof createDb>;
  let repository: SandboxRepository;
  let runner: SandboxRunnerService;

  beforeAll(() => {
    created = createDb(process.env.DATABASE_URL ?? '');
    repository = new SandboxRepository(created.db);
    runner = new SandboxRunnerService(
      created.pool,
      true,
      repository,
      fakeDataService() as never,
      new AuditService(created.db),
    );
  });

  beforeEach(async () => {
    await created.db.execute(sql`truncate table users restart identity cascade`);
  });

  afterAll(async () => {
    await created.pool.end();
  });

  const seedRunningRun = (
    overrides: { ledgerState?: object; engineState?: object; lastBarClose?: Date } = {},
  ) =>
    seedSandboxRun(created.db, {
      status: 'running',
      ...overrides,
    });

  it('persists a tick, projections and events and does not double-tick the bar', async () => {
    const owner = await seedRunningRun();
    await repository.upsertCandles(closedCandles());
    const lastClose = SANDBOX_TEST_AT + 220 * HOUR;

    await runner.runOnce(new Date(lastClose));

    const [run] = await created.db
      .select()
      .from(sandboxRuns)
      .where(eq(sandboxRuns.id, owner.runId));
    expect(run?.lastBarClose?.getTime()).toBe(lastClose);
    expect(run?.eventSeq).toBeGreaterThan(0);

    const [events] = await created.db
      .select({ count: sql<number>`count(*)::int` })
      .from(sandboxEvents)
      .where(eq(sandboxEvents.runId, owner.runId));
    const [points] = await created.db
      .select({ count: sql<number>`count(*)::int` })
      .from(sandboxEquityPoints)
      .where(eq(sandboxEquityPoints.runId, owner.runId));
    expect(events?.count).toBe(run?.eventSeq);
    expect(points?.count).toBe(1);

    const eventCount = run?.eventSeq ?? 0;
    await runner.runOnce(new Date(lastClose));
    const [after] = await created.db
      .select()
      .from(sandboxRuns)
      .where(eq(sandboxRuns.id, owner.runId));
    expect(after?.eventSeq).toBe(eventCount);
  });

  it('marks a run failed when the persisted ledger fails reconciliation', async () => {
    const open = makeOpenLedger();
    const tampered = { ...open.ledger, cashUsd: '900.00' };
    const owner = await seedRunningRun({
      ledgerState: tampered,
      engineState: makeEngineState(),
      lastBarClose: new Date(SANDBOX_TEST_AT + 220 * HOUR - HOUR),
    });
    await repository.upsertCandles(closedCandles());

    await runner.runOnce(new Date(SANDBOX_TEST_AT + 220 * HOUR));

    const [run] = await created.db
      .select()
      .from(sandboxRuns)
      .where(eq(sandboxRuns.id, owner.runId));
    expect(run?.status).toBe('failed');
    expect(run?.error).toMatch(/reconciliation/i);
  });
});
