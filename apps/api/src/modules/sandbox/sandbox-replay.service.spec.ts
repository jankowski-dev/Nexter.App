import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { SandboxReplayCreateRequest } from '@nexter/contracts';
import { DEFAULT_PAPER_SETTINGS, DEFAULT_SETTINGS } from '@nexter/sandbox-core';
import type { SandboxCandleStats, SandboxTokenRecord } from './sandbox.repository';
import type {
  SandboxReplayCreateInput,
  SandboxReplayDetailRecord,
  SandboxReplayListOptions,
  SandboxReplaySummaryRecord,
} from './sandbox-replay.repository';
import { SandboxReplayService } from './sandbox-replay.service';

const USER = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const REPLAY = '11111111-1111-4111-8111-111111111111';
const TOKEN_A = 'bsc:0x1111111111111111111111111111111111111111';
const TOKEN_B = 'binance:BTCUSDT';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const TO = Date.UTC(2026, 0, 10);
const NOW = new Date(TO + HOUR);
const FROM_30 = TO - 30 * DAY;
const FROM_90 = TO - 90 * DAY;
const FROM_180 = TO - 180 * DAY;

function tokenRecord(tokenKey: string, symbol: string): SandboxTokenRecord {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    userId: USER,
    tokenKey,
    symbol,
    name: symbol,
    chain: tokenKey.split(':')[0] ?? 'bsc',
    contractAddress: null,
    coingeckoId: null,
    enabled: true,
    createdAt: new Date(TO),
    updatedAt: new Date(TO),
  };
}

function stats(available: number, first: Date | null, last: Date | null): SandboxCandleStats {
  return {
    available,
    firstOpenTime: first,
    lastOpenTime: last,
    syntheticCandles: 0,
  };
}

interface HarnessOptions {
  userId?: string;
  /** Bars available inside the requested evaluation window. */
  evaluationBars?: number;
  /** Bars before the requested window start. */
  prefixBars?: number;
  /** First available bar offset (in bars) from the requested window start. */
  firstBarOffset?: number;
  /** Bars available inside the shortened (partial) window. */
  partialBars?: number;
  tokens?: SandboxTokenRecord[];
  latestClosedOpenTime?: Date | null;
  status?: SandboxReplayDetailRecord['status'];
  archivedAt?: Date | null;
}

function toRecord(input: SandboxReplayCreateInput): SandboxReplayDetailRecord {
  return {
    id: REPLAY,
    name: input.name,
    status: 'queued',
    tokenKeys: [...input.tokenKeys],
    periodDays: input.periodDays,
    fromTime: input.fromTime,
    toTime: input.toTime,
    initialCapitalUsd: input.initialCapitalUsd,
    finalEquityUsd: null,
    returnPct: null,
    maxDrawdownPct: null,
    reportHash: null,
    error: null,
    queuedAt: input.queuedAt,
    startedAt: null,
    finishedAt: null,
    archivedAt: null,
    createdAt: input.queuedAt,
    updatedAt: input.queuedAt,
    settings: input.settings,
    paper: input.paper,
    seed: input.seed,
    eventCount: null,
    eventHash: null,
    dataSnapshotId: null,
    candleSnapshotHash: null,
  };
}

function harness(options: HarnessOptions = {}) {
  const owner = options.userId ?? USER;
  const tokens = options.tokens ?? [tokenRecord(TOKEN_A, 'CAKE'), tokenRecord(TOKEN_B, 'BTC')];
  const evaluationBars = options.evaluationBars ?? 720;
  const prefixBars = options.prefixBars ?? 100;
  const firstBarOffset = options.firstBarOffset ?? 0;
  const partialBars = options.partialBars ?? Math.max(0, 720 - firstBarOffset);
  const latestClosedOpenTime =
    options.latestClosedOpenTime === undefined ? new Date(TO - HOUR) : options.latestClosedOpenTime;

  let record: SandboxReplayDetailRecord | null = null;
  if (options.status !== undefined) {
    const initial = toRecord({
      userId: owner,
      name: 'Existing replay',
      tokenKeys: [TOKEN_A],
      periodDays: 30,
      fromTime: new Date(FROM_30),
      toTime: new Date(TO),
      initialCapitalUsd: '1000.00',
      seed: 7,
      settings: DEFAULT_SETTINGS as unknown as Record<string, unknown>,
      paper: DEFAULT_PAPER_SETTINGS as unknown as Record<string, unknown>,
      queuedAt: new Date(TO),
    });
    record = {
      ...initial,
      status: options.status,
      archivedAt: options.archivedAt ?? null,
      startedAt: options.status === 'queued' ? null : new Date(TO),
      finishedAt:
        options.status === 'completed' ||
        options.status === 'failed' ||
        options.status === 'cancelled'
          ? new Date(TO)
          : null,
    };
  }

  const lastOpen = new Date(TO - HOUR);
  const candleStatsMany = vi.fn(async (tokenKeys: string[]) => {
    const map = new Map<string, SandboxCandleStats>();
    for (const tokenKey of tokenKeys) {
      map.set(
        tokenKey,
        stats(
          evaluationBars + prefixBars,
          new Date(FROM_180 - prefixBars * HOUR),
          latestClosedOpenTime ?? null,
        ),
      );
    }
    return map;
  });

  const latestClosedOpenTimes = vi.fn(async (tokenKeys: string[]) => {
    const map = new Map<string, Date>();
    if (latestClosedOpenTime !== null) {
      for (const tokenKey of tokenKeys) map.set(tokenKey, latestClosedOpenTime);
    }
    return map;
  });

  const candleStatsBetween = vi.fn(async (tokenKeys: string[], from: Date, to: Date) => {
    const map = new Map<string, SandboxCandleStats>();
    for (const tokenKey of tokenKeys) {
      if (to.getTime() === TO) {
        if ([FROM_30, FROM_90, FROM_180].includes(from.getTime())) {
          map.set(
            tokenKey,
            stats(
              evaluationBars,
              evaluationBars === 0 ? null : new Date(from.getTime() + firstBarOffset * HOUR),
              lastOpen,
            ),
          );
        } else {
          map.set(tokenKey, stats(partialBars, partialBars === 0 ? null : from, lastOpen));
        }
      } else {
        map.set(tokenKey, stats(prefixBars, null, null));
      }
    }
    return map;
  });

  const candles = {
    listTokens: vi.fn(async (userId: string) => (userId === owner ? tokens : [])),
    candleStatsMany,
    candleStatsBetween,
    latestClosedOpenTimes,
  };

  const createReplay = vi.fn(async (input: SandboxReplayCreateInput) => {
    record = toRecord(input);
    return record;
  });

  const listReplays = vi.fn(async (_userId: string, _options: SandboxReplayListOptions) =>
    record === null ? [] : [toSummaryRow(record)],
  );
  const countReplays = vi.fn(async () => (record === null ? 0 : 1));
  const findReplay = vi.fn(async (userId: string, id: string) => {
    if (record === null || record.id !== id || userId !== owner) return null;
    return record;
  });
  const cancelQueuedReplay = vi.fn(async (_userId: string, _id: string, at: Date) => {
    if (record === null || record.status !== 'queued' || record.archivedAt !== null) return false;
    record = { ...record, status: 'cancelled', finishedAt: at, updatedAt: at };
    return true;
  });
  const archiveReplay = vi.fn(async (_userId: string, _id: string, at: Date) => {
    if (record === null || record.archivedAt !== null) return false;
    if (!['completed', 'failed', 'cancelled'].includes(record.status)) return false;
    record = { ...record, archivedAt: at, updatedAt: at };
    return true;
  });

  const replays = {
    createReplay,
    listReplays,
    countReplays,
    findReplay,
    cancelQueuedReplay,
    archiveReplay,
  };
  const audit = { log: vi.fn(async (_input: { action: string }) => undefined) };
  const service = new SandboxReplayService(candles as never, replays as never, audit as never);

  return {
    service,
    candles,
    replays,
    audit,
    createReplay,
    candleStatsBetween,
    listReplays,
    getRecord: () => record,
    setRecord: (next: SandboxReplayDetailRecord | null) => {
      record = next;
    },
  };
}

function toSummaryRow(record: SandboxReplayDetailRecord): SandboxReplaySummaryRecord {
  const { settings: _settings, paper: _paper, ...summary } = record;
  return summary;
}

async function expectCode(
  promise: Promise<unknown>,
  type: typeof ConflictException | typeof NotFoundException,
  code: string,
): Promise<void> {
  let error: unknown;
  try {
    await promise;
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(type);
  expect((error as ConflictException).getResponse()).toMatchObject({ code });
}

describe('SandboxReplayService preflight', () => {
  it('reports a full 30-day window ending at the latest common closed candle', async () => {
    const h = harness({ evaluationBars: 720, prefixBars: 100 });
    const result = await h.service.preflight(
      USER,
      {
        tokenKeys: [TOKEN_A, TOKEN_B],
        periodDays: 30,
        allowPartial: false,
      },
      new Date(NOW),
    );

    expect(result.status).toBe('ok');
    expect(result.toTime).toBe(new Date(TO).toISOString());
    expect(result.fromTime).toBe(new Date(FROM_30).toISOString());
    expect(result.coverage).toHaveLength(2);
    expect(result.coverage[0]).toMatchObject({
      available: 720,
      required: 720,
      gaps: 0,
      prefixBars: 100,
      status: 'ok',
    });
  });

  it('reports a partial window without allowPartial and keeps from_time at the requested start', async () => {
    const h = harness({ evaluationBars: 480, firstBarOffset: 240, prefixBars: 100 });
    const result = await h.service.preflight(
      USER,
      { tokenKeys: [TOKEN_A], periodDays: 30, allowPartial: false },
      new Date(NOW),
    );

    expect(result.status).toBe('partial');
    expect(result.fromTime).toBe(new Date(FROM_30).toISOString());
    expect(result.coverage[0]).toMatchObject({ available: 480, required: 720, gaps: 240 });
  });

  it('moves from_time to the earliest commonly available candle when allowPartial is true', async () => {
    const h = harness({ evaluationBars: 480, firstBarOffset: 240, prefixBars: 100 });
    const movedFrom = FROM_30 + 240 * HOUR;
    const result = await h.service.preflight(
      USER,
      { tokenKeys: [TOKEN_A], periodDays: 30, allowPartial: true },
      new Date(NOW),
    );

    expect(result.status).toBe('partial');
    expect(result.fromTime).toBe(new Date(movedFrom).toISOString());
    expect(result.coverage[0]).toMatchObject({
      fromTime: new Date(movedFrom).toISOString(),
      available: 480,
      required: 480,
      gaps: 0,
    });
    expect(h.candleStatsBetween).toHaveBeenCalledWith([TOKEN_A], new Date(movedFrom), new Date(TO));
  });

  it('rejects a token outside the owner universe', async () => {
    const h = harness();
    await expectCode(
      h.service.preflight(
        USER,
        {
          tokenKeys: ['bsc:0x9999999999999999999999999999999999999999'],
          periodDays: 30,
          allowPartial: false,
        },
        new Date(NOW),
      ),
      NotFoundException,
      'SANDBOX_REPLAY_TOKEN_NOT_FOUND',
    );
  });

  it('reports missing when no closed candles exist', async () => {
    const h = harness({ latestClosedOpenTime: null, evaluationBars: 0, prefixBars: 0 });
    const result = await h.service.preflight(
      USER,
      { tokenKeys: [TOKEN_A], periodDays: 30, allowPartial: true },
      new Date(NOW),
    );

    expect(result.status).toBe('missing');
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

describe('SandboxReplayService create', () => {
  it('creates a queued replay with frozen defaults, window and audit', async () => {
    const h = harness({ evaluationBars: 720, prefixBars: 100 });
    const created = await h.service.create(
      USER,
      {
        name: '30 дней',
        tokenKeys: [TOKEN_A, TOKEN_B],
        periodDays: 30,
        initialCapitalUsd: '1000',
        allowPartial: false,
      },
      {},
    );

    expect(created).toMatchObject({
      id: REPLAY,
      status: 'queued',
      fromTime: new Date(FROM_30).toISOString(),
      toTime: new Date(TO).toISOString(),
      initialCapitalUsd: '1000.00',
      seed: 7,
    });
    expect(h.createReplay).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER,
        name: '30 дней',
        tokenKeys: [TOKEN_A, TOKEN_B],
        periodDays: 30,
        fromTime: new Date(FROM_30),
        toTime: new Date(TO),
        initialCapitalUsd: '1000.00',
        seed: 7,
        settings: DEFAULT_SETTINGS,
        paper: DEFAULT_PAPER_SETTINGS,
      }),
    );
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'sandbox.replay_created',
        entityType: 'sandbox_replay',
        entityId: REPLAY,
      }),
    );
  });

  it('freezes the supplied seed and settings', async () => {
    const h = harness({ evaluationBars: 2160 });
    const settings = {
      ...DEFAULT_SETTINGS,
      maxPositions: 2,
    } as unknown as SandboxReplayCreateRequest['settings'];
    const paper = {
      ...DEFAULT_PAPER_SETTINGS,
      feeBps: 40,
    } as unknown as SandboxReplayCreateRequest['paper'];
    await h.service.create(
      USER,
      {
        name: '90 дней',
        tokenKeys: [TOKEN_A],
        periodDays: 90,
        initialCapitalUsd: '2500.50',
        seed: 42,
        settings,
        paper,
        allowPartial: false,
      },
      {},
    );

    expect(h.createReplay).toHaveBeenCalledWith(
      expect.objectContaining({
        seed: 42,
        settings,
        paper,
        initialCapitalUsd: '2500.50',
        fromTime: new Date(FROM_90),
      }),
    );
  });

  it('blocks a partial window without explicit acceptance', async () => {
    const h = harness({ evaluationBars: 480, firstBarOffset: 240 });
    await expectCode(
      h.service.create(
        USER,
        {
          name: '30 дней',
          tokenKeys: [TOKEN_A],
          periodDays: 30,
          initialCapitalUsd: '1000.00',
          allowPartial: false,
        },
        {},
      ),
      ConflictException,
      'SANDBOX_REPLAY_WINDOW_TOO_SHORT',
    );
    expect(h.createReplay).not.toHaveBeenCalled();
  });

  it('blocks a shortened window below the 240-bar floor', async () => {
    const h = harness({ evaluationBars: 120, firstBarOffset: 600 });
    await expectCode(
      h.service.create(
        USER,
        {
          name: '30 дней',
          tokenKeys: [TOKEN_A],
          periodDays: 30,
          initialCapitalUsd: '1000.00',
          allowPartial: true,
        },
        {},
      ),
      ConflictException,
      'SANDBOX_REPLAY_WINDOW_TOO_SHORT',
    );
    expect(h.createReplay).not.toHaveBeenCalled();
  });

  it('blocks a missing window', async () => {
    const h = harness({ evaluationBars: 0, prefixBars: 0 });
    await expectCode(
      h.service.create(
        USER,
        {
          name: '30 дней',
          tokenKeys: [TOKEN_A],
          periodDays: 30,
          initialCapitalUsd: '1000.00',
          allowPartial: true,
        },
        {},
      ),
      ConflictException,
      'SANDBOX_REPLAY_COVERAGE_MISSING',
    );
  });

  it('stores the actual shortened window when allowPartial is accepted', async () => {
    const h = harness({ evaluationBars: 480, firstBarOffset: 240, prefixBars: 100 });
    const movedFrom = FROM_30 + 240 * HOUR;
    const created = await h.service.create(
      USER,
      {
        name: 'Короткий',
        tokenKeys: [TOKEN_A],
        periodDays: 30,
        initialCapitalUsd: '1000.00',
        allowPartial: true,
      },
      {},
    );

    expect(created.fromTime).toBe(new Date(movedFrom).toISOString());
    expect(h.createReplay).toHaveBeenCalledWith(
      expect.objectContaining({ fromTime: new Date(movedFrom) }),
    );
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'sandbox.replay_created',
        after: expect.objectContaining({
          coverageStatus: 'partial',
          allowPartial: true,
        }),
      }),
    );
  });

  it('rejects an owner token that is not in the universe', async () => {
    const h = harness();
    await expectCode(
      h.service.create(
        USER,
        {
          name: '30 дней',
          tokenKeys: ['binance:ETHUSDT'],
          periodDays: 30,
          initialCapitalUsd: '1000.00',
          allowPartial: false,
        },
        {},
      ),
      NotFoundException,
      'SANDBOX_REPLAY_TOKEN_NOT_FOUND',
    );
  });
});

describe('SandboxReplayService list and detail', () => {
  it('lists owner replays with the status filter and pagination', async () => {
    const h = harness({ status: 'completed' });
    const result = await h.service.list(USER, {
      status: 'completed',
      includeArchived: true,
      limit: 10,
      offset: 20,
    });

    expect(h.listReplays).toHaveBeenCalledWith(USER, {
      status: 'completed',
      includeArchived: true,
      limit: 10,
      offset: 20,
    });
    expect(result).toMatchObject({ total: 1, limit: 10, offset: 20 });
    expect(result.replays[0]).toMatchObject({ status: 'completed' });
  });

  it('returns a detail for the owner only', async () => {
    const h = harness({ status: 'completed' });
    const detail = await h.service.detail(USER, REPLAY);
    expect(detail.id).toBe(REPLAY);
    expect(detail.seed).toBe(7);

    await expectCode(
      h.service.detail(OTHER, REPLAY),
      NotFoundException,
      'SANDBOX_REPLAY_NOT_FOUND',
    );
  });
});

describe('SandboxReplayService cancel and archive', () => {
  it('cancels a queued replay and audits it', async () => {
    const h = harness({ status: 'queued' });
    const cancelled = await h.service.cancel(USER, REPLAY, {});
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.finishedAt).not.toBeNull();
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'sandbox.replay_cancelled',
        before: expect.objectContaining({ status: 'queued' }),
        after: expect.objectContaining({ status: 'cancelled' }),
      }),
    );
  });

  it('refuses to cancel a running replay', async () => {
    const h = harness({ status: 'running' });
    await expectCode(
      h.service.cancel(USER, REPLAY, {}),
      ConflictException,
      'SANDBOX_REPLAY_INVALID_STATUS',
    );
  });

  it('archives a terminal replay only', async () => {
    const completed = harness({ status: 'completed' });
    const archived = await completed.service.archive(USER, REPLAY, {});
    expect(archived.archivedAt).not.toBeNull();
    expect(completed.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'sandbox.replay_archived' }),
    );

    const queued = harness({ status: 'queued' });
    await expectCode(
      queued.service.archive(USER, REPLAY, {}),
      ConflictException,
      'SANDBOX_REPLAY_INVALID_STATUS',
    );
  });

  it('returns 404 for another owner on cancel and archive', async () => {
    const h = harness({ status: 'queued' });
    await expectCode(
      h.service.cancel(OTHER, REPLAY, {}),
      NotFoundException,
      'SANDBOX_REPLAY_NOT_FOUND',
    );

    const completed = harness({ status: 'completed' });
    await expectCode(
      completed.service.archive(OTHER, REPLAY, {}),
      NotFoundException,
      'SANDBOX_REPLAY_NOT_FOUND',
    );
  });

  it('refuses a second archive of the same replay', async () => {
    const h = harness({ status: 'completed', archivedAt: new Date(TO) });
    await expectCode(
      h.service.archive(USER, REPLAY, {}),
      ConflictException,
      'SANDBOX_REPLAY_INVALID_STATUS',
    );
  });
});
