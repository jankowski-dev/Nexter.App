import { ConflictException } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import {
  auditLog,
  createDb,
  sandboxIntents,
  sandboxRunTokens,
  sandboxRuns,
  users,
} from '@nexter/db';
import { Reason } from '@nexter/sandbox-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SandboxRepository } from '../src/modules/sandbox/sandbox.repository';
import { SandboxRunService } from '../src/modules/sandbox/sandbox-run.service';
import { AuditService } from '../src/shared/audit/audit.service';
import { assertDisposableTestDatabase } from './helpers/test-database';
import {
  makeEngineState,
  makeOpenLedger,
  SANDBOX_TEST_TOKEN,
  seedSandboxRun,
} from './helpers/sandbox-fixtures';

const canRun = Boolean(process.env.NEXTER_TEST_DB === '1' && process.env.DATABASE_URL);

if (canRun) {
  assertDisposableTestDatabase(process.env.DATABASE_URL);
}

const tokensService = {
  preflight: async () => ({ status: 'ok' as const, warnings: [], coverage: [] }),
};

const dataService = {
  refreshToken: async () => ({ fetched: 4320, upserted: 4320, source: 'test', synthetic: false }),
};

describe.runIf(canRun)('sandbox run lifecycle persistence', () => {
  let created: ReturnType<typeof createDb>;
  let repository: SandboxRepository;
  let service: SandboxRunService;

  beforeAll(() => {
    created = createDb(process.env.DATABASE_URL ?? '');
    repository = new SandboxRepository(created.db);
    service = new SandboxRunService(
      repository,
      tokensService as never,
      dataService as never,
      new AuditService(created.db),
    );
  });

  beforeEach(async () => {
    await created.db.execute(sql`truncate table users restart identity cascade`);
  });

  afterAll(async () => {
    await created.pool.end();
  });

  it('creates, starts, pauses, resumes, stops and archives with audit', async () => {
    const [user] = await created.db
      .insert(users)
      .values({ email: 'sandbox-lifecycle@example.com', passwordHash: 'not-a-real-hash' })
      .returning({ id: users.id });
    if (!user) throw new Error('user insert returned no row');
    await repository.insertToken({
      userId: user.id,
      tokenKey: SANDBOX_TEST_TOKEN,
      symbol: 'CAKE',
      name: 'PancakeSwap',
      chain: 'bsc',
      contractAddress: SANDBOX_TEST_TOKEN.slice('bsc:'.length),
      coingeckoId: null,
      enabled: true,
    });

    const draft = await service.create(
      user.id,
      { name: 'Lifecycle', initialCapitalUsd: '1000', tokenKeys: [SANDBOX_TEST_TOKEN] },
      {},
    );
    expect(draft.status).toBe('draft');
    expect(draft.tokens).toEqual([]);

    const running = await service.start(user.id, draft.id, {}, {});
    expect(running.status).toBe('running');
    expect(running.startedAt).not.toBeNull();

    const [runRow] = await created.db
      .select()
      .from(sandboxRuns)
      .where(eq(sandboxRuns.id, draft.id));
    expect(runRow?.engineState).toEqual({ tokens: {} });
    expect(runRow?.ledgerState).toMatchObject({ cashUsd: '1000.00' });

    const snapshot = await created.db
      .select()
      .from(sandboxRunTokens)
      .where(eq(sandboxRunTokens.runId, draft.id));
    expect(snapshot).toHaveLength(1);

    expect((await service.pause(user.id, draft.id, {})).status).toBe('paused');
    expect((await service.resume(user.id, draft.id, {})).status).toBe('running');
    expect((await service.stop(user.id, draft.id, {})).status).toBe('stopped');
    expect((await service.archive(user.id, draft.id, {})).archivedAt).not.toBeNull();

    const audits = await created.db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(and(eq(auditLog.entityType, 'sandbox_run'), eq(auditLog.entityId, draft.id)));
    expect(audits.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        'sandbox.run_created',
        'sandbox.run_started',
        'sandbox.run_paused',
        'sandbox.run_resumed',
        'sandbox.run_stopped',
        'sandbox.run_archived',
      ]),
    );
  });

  it('queues one manual close and rejects a second close', async () => {
    const open = makeOpenLedger();
    const owner = await seedSandboxRun(created.db, {
      status: 'running',
      ledgerState: open.ledger,
      engineState: makeEngineState(),
    });

    const run = await service.requestClose(owner.userId, owner.runId, SANDBOX_TEST_TOKEN, {});
    expect(run.status).toBe('running');

    const intents = await created.db
      .select()
      .from(sandboxIntents)
      .where(eq(sandboxIntents.runId, owner.runId));
    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({
      status: 'pending',
      side: 'sell',
      tokenId: SANDBOX_TEST_TOKEN,
      strategyReasonCode: 'MANUAL_CLOSE',
    });

    await expect(
      service.requestClose(owner.userId, owner.runId, SANDBOX_TEST_TOKEN, {}),
    ).rejects.toBeInstanceOf(ConflictException);

    await service.stop(owner.userId, owner.runId, {});
    const [stoppedIntent] = await created.db
      .select()
      .from(sandboxIntents)
      .where(eq(sandboxIntents.runId, owner.runId));
    expect(stoppedIntent?.status).toBe('expired');
    expect(stoppedIntent?.reasonCode).toBe('FILL_EXPIRED');

    // Archive must expire a pending row even when it appeared after the stop,
    // atomically with the archive transition.
    const inserted = await repository.insertManualCloseIntent(owner.runId, {
      intentId: 'archive-pending',
      tokenId: SANDBOX_TEST_TOKEN,
      side: 'sell',
      strategyKey: 'trend_pullback',
      strategyVersion: 1,
      reasonCode: Reason.MANUAL_CLOSE,
      sizeUsd: '0.00',
      amount: '1.00000000',
      stopLossPct: null,
      takeProfitPct: null,
      decisionPriceUsd: '0.00000000',
      clockTime: Date.now(),
    });
    expect(inserted).toBe(true);

    await service.archive(owner.userId, owner.runId, {});
    const afterArchive = await created.db
      .select()
      .from(sandboxIntents)
      .where(eq(sandboxIntents.runId, owner.runId));
    expect(afterArchive).toHaveLength(2);
    expect(afterArchive.every((row) => row.status === 'expired')).toBe(true);
  });
});
