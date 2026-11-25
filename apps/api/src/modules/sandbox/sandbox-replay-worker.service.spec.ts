import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PAPER_SETTINGS,
  DEFAULT_SETTINGS,
  type Candle,
  type RunReport,
} from '@nexter/sandbox-core';
import {
  InlineReplayExecutor,
  ReplayExecutionError,
  snapshotReplayCandles,
  type ReplayExecutionInput,
  type ReplayExecutor,
} from './sandbox-replay.executor';
import { SandboxReplayWorkerService } from './sandbox-replay-worker.service';
import type {
  SandboxReplaySnapshotWrite,
  SandboxReplayWorkerRecord,
} from './sandbox-replay.repository';

const USER = '22222222-2222-4222-8222-222222222222';
const REPLAY = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'bsc:0x1111111111111111111111111111111111111111';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const FROM = Date.UTC(2026, 0, 1);
const TO = FROM + 30 * DAY;
const NOW = new Date(TO);

/** 48 valid rising 1h bars inside the evaluation window. */
function replayCandles(): Candle[] {
  let previous = 100;
  return Array.from({ length: 48 }, (_, index) => {
    const close = 100 + index * 0.1;
    const open = previous;
    previous = close;
    return {
      tokenId: TOKEN,
      timeframe: '1h',
      openTime: FROM + index * HOUR,
      open: open.toFixed(8),
      high: (Math.max(open, close) * 1.001).toFixed(8),
      low: (Math.min(open, close) * 0.999).toFixed(8),
      close: close.toFixed(8),
      volumeUsd: '100000',
    };
  });
}

function replayRecord(
  overrides: Partial<SandboxReplayWorkerRecord> = {},
): SandboxReplayWorkerRecord {
  return {
    id: REPLAY,
    userId: USER,
    name: 'Historical replay',
    status: 'queued',
    tokenKeys: [TOKEN],
    periodDays: 30,
    fromTime: new Date(FROM),
    toTime: new Date(TO),
    initialCapitalUsd: '1000.00',
    finalEquityUsd: null,
    returnPct: null,
    maxDrawdownPct: null,
    reportHash: null,
    error: null,
    queuedAt: new Date(FROM),
    startedAt: null,
    finishedAt: null,
    archivedAt: null,
    createdAt: new Date(FROM),
    updatedAt: new Date(FROM),
    settings: DEFAULT_SETTINGS as unknown as Record<string, unknown>,
    paper: DEFAULT_PAPER_SETTINGS as unknown as Record<string, unknown>,
    seed: 7,
    eventCount: null,
    eventHash: null,
    dataSnapshotId: null,
    candleSnapshotHash: null,
    candleSnapshot: null,
    ...overrides,
  };
}

function fakeReport(input: ReplayExecutionInput): RunReport {
  return {
    runId: input.runId,
    dataSnapshotId: input.dataSnapshotId,
    reportHash: 'a'.repeat(64),
    eventCount: 12,
    eventHash: 'b'.repeat(64),
    period: { firstBar: input.evaluateFrom, lastBar: TO, bars: 48, tokens: [TOKEN] },
  } as unknown as RunReport;
}

interface HarnessOptions {
  readonly locked?: boolean;
  readonly markRunningOk?: boolean;
  readonly runningRows?: ReadonlyArray<{ id: string; userId: string }>;
  readonly record?: SandboxReplayWorkerRecord | null;
  readonly failClaimOnce?: boolean;
  readonly failSnapshotStore?: boolean;
}

function harness(options: HarnessOptions = {}) {
  const calls: string[] = [];
  let record = options.record === undefined ? replayRecord() : options.record;
  let failClaim = options.failClaimOnce ?? false;

  const requeueRunningReplays = vi.fn(
    async (_at: Date): Promise<Array<{ id: string; userId: string }>> => {
      calls.push('requeue');
      if (record !== null && record.status === 'running') {
        record = { ...record, status: 'queued', startedAt: null, updatedAt: _at };
        return [{ id: record.id, userId: record.userId }];
      }
      return [...(options.runningRows ?? [])];
    },
  );

  const claimQueuedReplay = vi.fn(async (): Promise<SandboxReplayWorkerRecord | null> => {
    calls.push('claim');
    if (failClaim) {
      failClaim = false;
      throw new Error('pool timeout');
    }
    return record !== null && record.status === 'queued' ? record : null;
  });

  const markReplayRunning = vi.fn(async (id: string, at: Date): Promise<boolean> => {
    calls.push('mark-running');
    if (!(options.markRunningOk ?? true)) return false;
    if (record === null || record.id !== id || record.status !== 'queued') return false;
    record = { ...record, status: 'running', startedAt: at, updatedAt: at };
    return true;
  });

  const storeReplaySnapshot = vi.fn(
    async (id: string, input: SandboxReplaySnapshotWrite): Promise<boolean> => {
      calls.push('store-snapshot');
      if (options.failSnapshotStore) return false;
      if (record === null || record.id !== id || record.status !== 'running') return false;
      record = {
        ...record,
        dataSnapshotId: input.dataSnapshotId,
        candleSnapshot: input.candleSnapshot,
        candleSnapshotHash: input.candleSnapshotHash,
        updatedAt: input.at,
      };
      return true;
    },
  );

  const storeReplayReport = vi.fn(
    async (
      id: string,
      input: {
        report: Record<string, unknown>;
        reportHash: string;
        eventCount: number;
        eventHash: string;
        dataSnapshotId: string;
        candleSnapshot: Buffer;
        candleSnapshotHash: string;
        at: Date;
      },
    ): Promise<boolean> => {
      calls.push('store-report');
      if (record === null || record.id !== id || record.status !== 'running') return false;
      record = {
        ...record,
        status: 'completed',
        reportHash: input.reportHash,
        eventCount: input.eventCount,
        eventHash: input.eventHash,
        dataSnapshotId: input.dataSnapshotId,
        candleSnapshot: input.candleSnapshot,
        candleSnapshotHash: input.candleSnapshotHash,
        finishedAt: input.at,
        updatedAt: input.at,
      };
      return true;
    },
  );

  const markReplayFailed = vi.fn(async (id: string, error: string, at: Date): Promise<boolean> => {
    calls.push('mark-failed');
    if (record === null || record.id !== id || record.status !== 'running') return false;
    record = { ...record, status: 'failed', error, finishedAt: at, updatedAt: at };
    return true;
  });

  const loadReplayCandles = vi.fn(async () => {
    calls.push('load-candles');
    return replayCandles();
  });

  const repository = {
    requeueRunningReplays,
    claimQueuedReplay,
    markReplayRunning,
    storeReplaySnapshot,
    storeReplayReport,
    markReplayFailed,
    loadReplayCandles,
  };

  const client = {
    query: vi.fn(async (sql: string) => {
      if (sql.includes('try_advisory_lock')) {
        calls.push('lock');
        return { rows: [{ locked: options.locked ?? true }] };
      }
      calls.push('unlock');
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  const pool = { connect: vi.fn(async () => client) };

  const audit = { log: vi.fn(async (_input: { action: string }) => undefined) };
  const runReplay = vi.fn(async (input: ReplayExecutionInput) => fakeReport(input));
  const executor: ReplayExecutor & { run: typeof runReplay } = { run: runReplay };

  const service = new SandboxReplayWorkerService(
    pool as never,
    true,
    repository as never,
    audit as never,
    executor,
  );

  return {
    service,
    executor,
    repository,
    audit,
    client,
    pool,
    calls,
    getRecord: () => record,
    getExecutorInput: () => executor.run.mock.calls[0]?.[0] as ReplayExecutionInput | undefined,
  };
}

function auditedActions(audit: { log: { mock: { calls: unknown[][] } } }): string[] {
  return audit.log.mock.calls.map((call) => (call[0] as { action: string }).action);
}

describe('SandboxReplayWorkerService locking', () => {
  it('claims nothing and requeues nothing when the advisory lock is held elsewhere', async () => {
    const h = harness({
      locked: false,
      runningRows: [{ id: REPLAY, userId: USER }],
    });

    await h.service.runOnce(NOW);

    expect(h.repository.claimQueuedReplay).not.toHaveBeenCalled();
    expect(h.repository.requeueRunningReplays).not.toHaveBeenCalled();
    expect(h.executor.run).not.toHaveBeenCalled();
    expect(h.client.release).toHaveBeenCalled();
  });

  it('requeues stale running rows only after acquiring the lock', async () => {
    const h = harness({
      runningRows: [{ id: REPLAY, userId: USER }],
      record: null,
    });

    await h.service.runOnce(NOW);

    expect(h.repository.requeueRunningReplays).toHaveBeenCalledWith(NOW);
    expect(h.calls.indexOf('lock')).toBeGreaterThanOrEqual(0);
    expect(h.calls.indexOf('lock')).toBeLessThan(h.calls.indexOf('requeue'));
    expect(auditedActions(h.audit)).toContain('sandbox.replay_requeued');

    const lockedOut = harness({
      locked: false,
      runningRows: [{ id: REPLAY, userId: USER }],
      record: null,
    });
    await lockedOut.service.runOnce(NOW);
    expect(lockedOut.repository.requeueRunningReplays).not.toHaveBeenCalled();
  });
});

describe('SandboxReplayWorkerService execution', () => {
  it('claims, snapshots, runs and stores one completed replay', async () => {
    const h = harness();

    await h.service.runOnce(NOW);

    const input = h.getExecutorInput();
    expect(input).toBeDefined();
    expect(input?.evaluateFrom).toBe(FROM);
    expect(input?.tokenIds).toEqual([TOKEN]);
    expect(input?.candles).toHaveLength(48);
    expect(input?.dataSnapshotId).toMatch(/^[0-9a-f]{64}$/);
    expect(input?.configVersion).toMatch(/^[0-9a-f]{64}$/);

    const snapshotWrite = h.repository.storeReplaySnapshot.mock.calls[0]?.[1];
    expect(snapshotWrite?.dataSnapshotId).toBe(input?.dataSnapshotId);
    expect(snapshotWrite?.candleSnapshotHash).toBe(snapshotWrite?.dataSnapshotId);
    expect(h.repository.storeReplaySnapshot.mock.invocationCallOrder[0] as number).toBeLessThan(
      h.executor.run.mock.invocationCallOrder[0] as number,
    );

    expect(h.repository.markReplayRunning).toHaveBeenCalledWith(REPLAY, NOW);
    expect(h.repository.storeReplayReport).toHaveBeenCalledTimes(1);
    const reportWrite = h.repository.storeReplayReport.mock.calls[0]?.[1];
    expect(reportWrite).toMatchObject({
      reportHash: 'a'.repeat(64),
      eventCount: 12,
      eventHash: 'b'.repeat(64),
      dataSnapshotId: input?.dataSnapshotId,
    });
    expect(h.getRecord()?.status).toBe('completed');
    expect(auditedActions(h.audit)).toEqual(['sandbox.replay_started', 'sandbox.replay_completed']);
    expect(h.calls).toContain('store-snapshot');
    expect(h.calls).toContain('store-report');
    expect(h.calls).toContain('unlock');
    expect(h.client.release).toHaveBeenCalled();
  });

  it('marks the replay failed with a sanitized message when the executor throws', async () => {
    const h = harness();
    h.executor.run.mockRejectedValueOnce(new Error('engine exploded'));

    await h.service.runOnce(NOW);

    expect(h.repository.storeReplayReport).not.toHaveBeenCalled();
    expect(h.repository.markReplayFailed).toHaveBeenCalledWith(
      REPLAY,
      'engine exploded',
      expect.any(Date),
    );
    expect(h.getRecord()?.status).toBe('failed');
    expect(auditedActions(h.audit)).toEqual(['sandbox.replay_started', 'sandbox.replay_failed']);
  });

  it('skips execution when the queued replay was cancelled before start', async () => {
    const h = harness({ markRunningOk: false });

    await h.service.runOnce(NOW);

    expect(h.executor.run).not.toHaveBeenCalled();
    expect(h.repository.storeReplayReport).not.toHaveBeenCalled();
    expect(auditedActions(h.audit)).toEqual([]);
  });

  it('does not trim the first evaluated bar into the prefix', async () => {
    const h = harness();

    await h.service.runOnce(NOW);

    const input = h.getExecutorInput();
    const first = input?.candles[0];
    expect(input?.evaluateFrom).toBe(first?.openTime);
  });

  it('stores a real deterministic report through the inline executor', async () => {
    const h = harness();

    await h.service.runOnce(NOW, new InlineReplayExecutor());

    const record = h.getRecord();
    expect(record?.status).toBe('completed');
    expect(record?.reportHash).toMatch(/^[0-9a-f]{64}$/);
    expect(record?.eventHash).toMatch(/^[0-9a-f]{64}$/);
    expect(record?.eventCount).toBeGreaterThan(0);
    expect(record?.dataSnapshotId).toBe(record?.candleSnapshotHash);
    expect(h.repository.storeReplayReport).toHaveBeenCalledTimes(1);
  });
});

describe('SandboxReplayWorkerService resilience', () => {
  it('does not crash the loop on a transient claim failure and retries next pass', async () => {
    const h = harness({ failClaimOnce: true });

    await expect(h.service.runOnce(NOW)).resolves.toBeUndefined();
    expect(h.repository.markReplayRunning).not.toHaveBeenCalled();
    expect(h.client.release).toHaveBeenCalled();

    await h.service.runOnce(NOW);
    expect(h.getRecord()?.status).toBe('completed');
  });

  it('does not run the same replay twice', async () => {
    const h = harness();

    await h.service.runOnce(NOW);
    await h.service.runOnce(NOW);

    expect(h.executor.run).toHaveBeenCalledTimes(1);
    expect(h.repository.storeReplayReport).toHaveBeenCalledTimes(1);
  });

  it('fails the replay when the snapshot cannot be stored (state changed)', async () => {
    const h = harness({ failSnapshotStore: true });

    await h.service.runOnce(NOW);

    expect(h.executor.run).not.toHaveBeenCalled();
    expect(h.repository.storeReplayReport).not.toHaveBeenCalled();
    // The row moved on; no failure is invented for a replay this worker no
    // longer owns.
    expect(h.repository.markReplayFailed).not.toHaveBeenCalled();
  });
});

describe('SandboxReplayWorkerService snapshot reuse', () => {
  it('reuses a stored snapshot after a requeue instead of reloading candles', async () => {
    const snapshot = snapshotReplayCandles(replayCandles());
    const h = harness({
      record: replayRecord({
        candleSnapshot: snapshot.gzip,
        candleSnapshotHash: snapshot.hash,
        dataSnapshotId: snapshot.dataSnapshotId,
      }),
    });

    await h.service.runOnce(NOW);

    expect(h.repository.loadReplayCandles).not.toHaveBeenCalled();
    expect(h.repository.storeReplaySnapshot).not.toHaveBeenCalled();
    const input = h.getExecutorInput();
    expect(input?.candles).toHaveLength(48);
    expect(input?.dataSnapshotId).toBe(snapshot.dataSnapshotId);
    expect(h.getRecord()?.status).toBe('completed');
  });

  it('fails closed when a stored snapshot is corrupt', async () => {
    const h = harness({
      record: replayRecord({
        candleSnapshot: Buffer.from('not gzip'),
        candleSnapshotHash: 'c'.repeat(64),
        dataSnapshotId: 'c'.repeat(64),
      }),
    });

    await h.service.runOnce(NOW);

    expect(h.executor.run).not.toHaveBeenCalled();
    expect(h.repository.markReplayFailed).toHaveBeenCalledWith(
      REPLAY,
      expect.stringContaining('snapshot'),
      expect.any(Date),
    );
    expect(h.getRecord()?.status).toBe('failed');
  });
});

describe('SandboxReplayWorkerService report identity', () => {
  it('fails when the executor returns a report for another input', async () => {
    const h = harness();
    h.executor.run.mockResolvedValueOnce({
      runId: REPLAY,
      dataSnapshotId: 'd'.repeat(64),
      reportHash: 'e'.repeat(64),
    } as unknown as RunReport);

    await h.service.runOnce(NOW);

    expect(h.repository.storeReplayReport).not.toHaveBeenCalled();
    expect(h.repository.markReplayFailed).toHaveBeenCalledWith(
      REPLAY,
      expect.stringContaining('identity'),
      expect.any(Date),
    );
  });

  it('surfaces a sanitized ReplayExecutionError message', async () => {
    const h = harness();
    h.executor.run.mockRejectedValueOnce(
      new ReplayExecutionError('REPLAY_DATA_INSUFFICIENT', 'No candles are available'),
    );

    await h.service.runOnce(NOW);

    expect(h.repository.markReplayFailed).toHaveBeenCalledWith(
      REPLAY,
      'No candles are available',
      expect.any(Date),
    );
  });
});
