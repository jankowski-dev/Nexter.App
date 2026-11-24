import { NotFoundException } from '@nestjs/common';
import { createLedger, type SandboxEvent } from '@nexter/sandbox-core';
import { describe, expect, it, vi } from 'vitest';
import { SandboxReadService } from './sandbox-read.service';
import type { SandboxRunSummaryRow } from './sandbox.repository';
import type { SandboxRunSnapshot } from './sandbox.types';

const TOKEN = 'bsc:0x1111111111111111111111111111111111111111';
const RUN = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';
const AT = new Date('2026-11-24T00:00:00.000Z');

function runSummary(overrides: Partial<SandboxRunSummaryRow> = {}): SandboxRunSummaryRow {
  return {
    id: RUN,
    name: 'Run',
    status: 'running',
    initialCapitalUsd: '1000.000000000000000000',
    cashUsd: '1000.000000000000000000',
    equityUsd: '1008.980000000000000000',
    peakEquityUsd: '1008.980000000000000000',
    lastBarClose: AT,
    lastTickAt: AT,
    error: null,
    createdAt: AT,
    updatedAt: AT,
    startedAt: AT,
    stoppedAt: null,
    archivedAt: null,
    tokenCount: 1,
    ...overrides,
  };
}

function runSnapshot(overrides: Partial<SandboxRunSnapshot> = {}): SandboxRunSnapshot {
  const ledger = createLedger('1000.00');
  return {
    id: RUN,
    userId: OWNER,
    name: 'Run',
    status: 'stopped',
    initialCapitalUsd: '1000.00',
    cashUsd: '1000.00',
    equityUsd: '1000.00',
    peakEquityUsd: '1000.00',
    dayStartEquityUsd: '1000.00',
    settings: {},
    engineState: { tokens: {} },
    ledgerState: ledger,
    lastBarClose: AT,
    eventSeq: 0,
    eventHash: '0'.repeat(64),
    lastTickAt: AT,
    error: null,
    createdAt: AT,
    updatedAt: AT,
    startedAt: AT,
    pausedAt: null,
    stoppedAt: AT,
    archivedAt: AT,
    tokens: [
      {
        tokenKey: TOKEN,
        symbol: 'CAKE',
        chain: 'bsc',
        contractAddress: TOKEN.slice('bsc:'.length),
        enabled: true,
      },
    ],
    ...overrides,
  };
}

function sampleEvent(seq: number): SandboxEvent {
  return {
    runId: RUN,
    clockTime: AT.toISOString(),
    module: 'run',
    eventType: 'run.ticked',
    severity: 'info',
    tokenId: null,
    strategyId: null,
    regime: null,
    stateBefore: null,
    stateAfter: null,
    inputs: {},
    timing: null,
    decision: null,
    alternatives: [],
    riskChecks: [],
    dataSnapshotId: 'snapshot-1',
    configVersion: 'config-1',
    seed: 1,
    correlationId: null,
    reasonCode: null,
    reasonText: null,
    seq,
    recordedAt: AT.toISOString(),
    prevHash: '0'.repeat(64),
    hash: 'a'.repeat(64),
  };
}

function fakeRepository(overrides: Record<string, unknown> = {}) {
  return {
    runStatusCounts: vi.fn(async () => [
      { status: 'running', archived: false, count: 2 },
      { status: 'draft', archived: false, count: 1 },
      { status: 'stopped', archived: true, count: 1 },
    ]),
    listRuns: vi.fn(async () => [runSummary()]),
    countRuns: vi.fn(async () => 4),
    lastTickAt: vi.fn(async () => AT),
    listTokens: vi.fn(async () => [
      { tokenKey: TOKEN, enabled: true },
      { tokenKey: 'binance:BTCUSDT', enabled: false },
    ]),
    candleStatsMany: vi.fn(
      async () =>
        new Map([
          [
            TOKEN,
            {
              available: 4320,
              firstOpenTime: AT,
              lastOpenTime: new Date(AT.getTime() - 3 * 3_600_000),
              syntheticCandles: 0,
            },
          ],
        ]),
    ),
    loadRun: vi.fn(async () => runSnapshot()),
    countOpenPositions: vi.fn(async () => 1),
    countTrades: vi.fn(async () => 1),
    countIntents: vi.fn(async () => 1),
    countEquityPoints: vi.fn(async () => 1),
    countLedgerEntries: vi.fn(async () => 1),
    listPositions: vi.fn(async () => []),
    listTrades: vi.fn(async () => []),
    listIntents: vi.fn(async () => []),
    listEquityPoints: vi.fn(async () => []),
    listEvents: vi.fn(async () => [sampleEvent(0), sampleEvent(1), sampleEvent(2)]),
    ...overrides,
  };
}

function service(repository: ReturnType<typeof fakeRepository>): SandboxReadService {
  return new SandboxReadService(true, repository as never, {} as never);
}

describe('SandboxReadService', () => {
  it('folds run counts and reports universe staleness', async () => {
    const repository = fakeRepository();
    const overview = await service(repository).overview(
      'owner',
      new Date('2026-11-24T00:00:00.000Z'),
    );

    expect(overview.runs).toEqual({
      total: 3,
      draft: 1,
      running: 2,
      paused: 0,
      stopped: 0,
      failed: 0,
      archived: 1,
    });
    expect(overview.activeRuns).toHaveLength(1);
    expect(overview.universe).toMatchObject({
      tokens: 2,
      enabledTokens: 1,
      staleTokens: [TOKEN],
    });
    expect(overview.lastTickAt).toBe(AT.toISOString());
    expect(overview.executionMode).toBe('live-paper');
  });

  it('passes list filters through and maps summaries', async () => {
    const repository = fakeRepository();
    const result = await service(repository).listRuns('owner', {
      status: 'running',
      includeArchived: true,
      limit: 10,
      offset: 5,
    });

    expect(repository.listRuns).toHaveBeenCalledWith('owner', {
      status: 'running',
      includeArchived: true,
      limit: 10,
      offset: 5,
    });
    expect(repository.countRuns).toHaveBeenCalledWith('owner', {
      status: 'running',
      includeArchived: true,
    });
    expect(result.total).toBe(4);
    expect(result.runs[0]?.returnPct).toBe('0.90');
  });

  it('paginates events with limit + 1 and an exclusive afterSeq', async () => {
    const repository = fakeRepository();
    const result = await service(repository).events(OWNER, RUN, {
      afterSeq: 3,
      limit: 2,
    });

    expect(repository.loadRun).toHaveBeenCalledWith(RUN);
    expect(repository.listEvents).toHaveBeenCalledWith(RUN, { afterSeq: 3, limit: 3 });
    expect(result.events.map((event) => event.seq)).toEqual([0, 1]);
    expect(result.hasMore).toBe(true);
    expect(result.nextAfterSeq).toBe(1);
  });

  it('allows read-only access to an archived run but rejects a foreign owner', async () => {
    const archived = await service(fakeRepository()).getRun(OWNER, RUN);
    expect(archived.archivedAt).toBe(AT.toISOString());

    await expect(service(fakeRepository()).getRun('other-owner', RUN)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
