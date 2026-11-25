import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PAPER_SETTINGS, DEFAULT_SETTINGS, type SandboxEvent } from '@nexter/sandbox-core';
import { snapshotReplayCandles } from './sandbox-replay.executor';
import type { SandboxReplayReportResponse, SandboxRunReport } from '@nexter/contracts';
import {
  SandboxReplayChartService,
  type ReplayDecisionsRunner,
} from './sandbox-replay-chart.service';
import type {
  SandboxReplayReportRecord,
  SandboxReplayRepository,
} from './sandbox-replay.repository';
import type { SandboxReplayReportService } from './sandbox-replay-report.service';

const tokenId = 'bsc:0x1111111111111111111111111111111111111111';
const hour = 3_600_000;
const fromTime = new Date('2026-11-24T00:00:00.000Z');
const toTime = new Date('2026-11-24T03:00:00.000Z');
const start = fromTime.getTime();

const candles = [
  candle(start - hour, '9.00'),
  candle(start, '10.00'),
  candle(start + hour, '11.00'),
  candle(start + 2 * hour, '9.50'),
  candle(start + 3 * hour, '12.00'),
];
const snapshot = snapshotReplayCandles(candles);

const report = {
  runId: '00000000-0000-4000-8000-000000000001',
  period: { tokens: [tokenId] },
  intentJournal: [
    {
      intentId: 'buy-1',
      tokenId,
      side: 'buy',
      strategyKey: 'trend_pullback',
      strategyVersion: 1,
      status: 'filled',
      requestedUsd: '100.00',
      requestedAmount: null,
      filledUsd: '100.00',
      filledAmount: '10.00',
      priceUsd: '10.00',
      feeUsd: '0.25',
      reasonCode: 'FILL_FILLED',
      strategyReasonCode: 'TREND_PULLBACK_ENTRY',
      reasonText: 'Trend entry',
      decisionTime: start,
      fillTime: start + hour,
    },
    {
      intentId: 'sell-1',
      tokenId,
      side: 'sell',
      strategyKey: 'trend_pullback',
      strategyVersion: 1,
      status: 'filled',
      requestedUsd: null,
      requestedAmount: null,
      filledUsd: '95.00',
      filledAmount: '10.00',
      priceUsd: '9.50',
      feeUsd: '0.24',
      reasonCode: 'FILL_FILLED',
      strategyReasonCode: 'TREND_PULLBACK_STOP',
      reasonText: 'Stop',
      decisionTime: start + 2 * hour,
      fillTime: start + 2 * hour,
    },
    {
      intentId: 'reject-1',
      tokenId,
      side: 'buy',
      strategyKey: 'trend_pullback',
      strategyVersion: 1,
      status: 'rejected',
      requestedUsd: '100.00',
      requestedAmount: null,
      filledUsd: '0.00',
      filledAmount: '0.00',
      priceUsd: null,
      feeUsd: '0.00',
      reasonCode: 'RISK_CASH_BUFFER',
      strategyReasonCode: 'TREND_PULLBACK_ENTRY',
      reasonText: 'Cash buffer',
      decisionTime: start + 2 * hour,
      fillTime: null,
    },
  ],
  trades: [
    {
      tradeId: 'trade-1',
      entryIntentId: 'buy-1',
      exitIntentId: 'sell-1',
      exitReasonCode: 'TREND_PULLBACK_STOP',
      realizedPnlUsd: '-5.00',
    },
  ],
  counterfactuals: [
    {
      tokenId,
      decisionTime: start + hour,
      reasonCode: 'RISK_BLOCKED',
      entryAt: start + hour,
      entryPriceUsd: '11.00',
      exitAt: null,
      exitPriceUsd: null,
      returnPct: null,
      outcome: 'neutral',
      hindsight: true,
      usedForDecisions: false,
    },
  ],
  configVersion: 'config-1',
  dataSnapshotId: snapshot.dataSnapshotId,
  reportHash: 'a'.repeat(64),
} as unknown as SandboxRunReport;

const response: SandboxReplayReportResponse = {
  executionMode: 'historical-paper',
  report,
  notes: [],
  identity: {
    reportHash: report.reportHash,
    eventHash: 'b'.repeat(64),
    eventCount: 1,
    dataSnapshotId: snapshot.dataSnapshotId,
    candleSnapshotHash: snapshot.hash,
    configVersion: report.configVersion,
    settingsVersion: 'settings-1',
    seed: 7,
  },
};

function candle(openTime: number, close: string) {
  return {
    tokenId,
    timeframe: '1h',
    openTime,
    open: close,
    high: close,
    low: close,
    close,
    volumeUsd: '1000',
  };
}

function replayRecord(): SandboxReplayReportRecord {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Replay',
    status: 'completed',
    tokenKeys: [tokenId],
    periodDays: 30,
    fromTime,
    toTime,
    initialCapitalUsd: '1000.00',
    finalEquityUsd: '1000.00',
    returnPct: '0.00',
    maxDrawdownPct: '0.00',
    reportHash: 'a'.repeat(64),
    error: null,
    queuedAt: fromTime,
    startedAt: fromTime,
    finishedAt: toTime,
    archivedAt: null,
    createdAt: fromTime,
    updatedAt: toTime,
    settings: DEFAULT_SETTINGS as unknown as Record<string, unknown>,
    paper: DEFAULT_PAPER_SETTINGS as unknown as Record<string, unknown>,
    seed: 7,
    eventCount: 1,
    eventHash: 'b'.repeat(64),
    dataSnapshotId: snapshot.dataSnapshotId,
    candleSnapshotHash: snapshot.hash,
    report: null,
  };
}

function chartService(runner?: ReplayDecisionsRunner) {
  const repository = {
    findReplayChartSource: vi.fn(async () => ({
      replay: replayRecord(),
      candleSnapshot: snapshot.gzip,
    })),
  } as unknown as SandboxReplayRepository;
  const reports = {
    getReport: vi.fn(async () => response),
  } as unknown as SandboxReplayReportService;
  return {
    service: new SandboxReplayChartService(repository, reports, runner),
    repository,
    reports,
  };
}

describe('SandboxReplayChartService', () => {
  it('returns only evaluation-window candles and all action reasons', async () => {
    const { service } = chartService();
    const chart = await service.getChart('user-1', '00000000-0000-4000-8000-000000000001');

    expect(chart.tokens[0]?.candles.map((item) => item.time)).toEqual([
      start,
      start + hour,
      start + 2 * hour,
    ]);
    expect(chart.actions.map((item) => item.kind)).toEqual([
      'buy',
      'counterfactual',
      'sell',
      'reject',
    ]);
    const reject = chart.actions.find((item) => item.kind === 'reject');
    expect(reject?.priceUsd).toBe('9.50');
    expect(reject?.reasonCode).toBe('RISK_CASH_BUFFER');
    expect(chart.actions.find((item) => item.kind === 'sell')?.pnlUsd).toBe('-5.00');
  });

  it('runs decisions once and paginates/filters the same deterministic rows', async () => {
    const events = [
      decisionEvent(start, 'hold', 'TREND_PULLBACK_HOLD', 'Hold'),
      decisionEvent(start + hour, 'buy', 'TREND_PULLBACK_ENTRY', 'Entry'),
      decisionEvent(start + hour, 'hold', 'RISK_COLD', 'Cooldown'),
    ];
    const runner: ReplayDecisionsRunner = vi.fn(async () => ({
      report,
      result: {} as never,
      events,
    })) as unknown as ReplayDecisionsRunner;
    const { service } = chartService(runner);

    const first = await service.getDecisions('user-1', '00000000-0000-4000-8000-000000000001', {
      limit: 2,
      offset: 0,
    });
    const second = await service.getDecisions('user-1', '00000000-0000-4000-8000-000000000001', {
      limit: 2,
      offset: 2,
    });
    const filtered = await service.getDecisions('user-1', '00000000-0000-4000-8000-000000000001', {
      limit: 10,
      offset: 0,
      tokenId,
    });

    expect(first.total).toBe(3);
    expect(first.items).toHaveLength(2);
    expect(second.items).toHaveLength(1);
    expect(filtered.total).toBe(3);
    expect(runner).toHaveBeenCalledTimes(1);
  });
});

function decisionEvent(
  time: number,
  action: 'buy' | 'sell' | 'hold' | 'block' | 'noop',
  reasonCode: string,
  reasonText: string,
): SandboxEvent {
  return {
    runId: '00000000-0000-4000-8000-000000000001',
    clockTime: new Date(time).toISOString(),
    module: 'strategy',
    eventType: 'decision',
    severity: 'decision',
    tokenId,
    strategyId: 'trend_pullback',
    regime: 'trend',
    stateBefore: null,
    stateAfter: null,
    inputs: {},
    timing: null,
    decision: { action, sizeUsd: action === 'buy' ? '100.00' : null, reasonCode, reasonText },
    alternatives: [],
    riskChecks: [],
    dataSnapshotId: snapshot.dataSnapshotId,
    configVersion: 'config-1',
    seed: 7,
    correlationId: null,
    reasonCode,
    reasonText,
    seq: 1,
    recordedAt: new Date(time).toISOString(),
    prevHash: '0'.repeat(64),
    hash: '1'.repeat(64),
  };
}
