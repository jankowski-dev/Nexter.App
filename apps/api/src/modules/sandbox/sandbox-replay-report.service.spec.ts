import { ConflictException, NotFoundException } from '@nestjs/common';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { sandboxReplayReportResponseSchema, type SandboxRunReport } from '@nexter/contracts';
import {
  DEFAULT_PAPER_SETTINGS,
  DEFAULT_SETTINGS,
  paperConfigVersion,
  runPaperFromCandles,
  type Candle,
  type PaperRunConfig,
} from '@nexter/sandbox-core';
import { snapshotReplayCandles } from './sandbox-replay.executor';
import type { SandboxReplayReportRecord } from './sandbox-replay.repository';
import { SandboxReplayReportService } from './sandbox-replay-report.service';

const USER = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const REPLAY = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'bsc:0x1111111111111111111111111111111111111111';
const START = Date.UTC(2026, 0, 1);
const HOUR = 3_600_000;
const EVALUATE_INDEX = 20;
const BAR_COUNT = 60;
const FROM = START + EVALUATE_INDEX * HOUR;
const TO = START + BAR_COUNT * HOUR;
const SNAPSHOT_HASH = 'c'.repeat(64);

function candles(): Candle[] {
  let previous = 100;
  return Array.from({ length: BAR_COUNT }, (_, index) => {
    const close = 100 + index * 0.1;
    const open = previous;
    previous = close;
    return {
      tokenId: TOKEN,
      timeframe: '1h',
      openTime: START + index * HOUR,
      open: open.toFixed(8),
      high: (Math.max(open, close) * 1.001).toFixed(8),
      low: (Math.min(open, close) * 0.999).toFixed(8),
      close: close.toFixed(8),
      volumeUsd: '100000',
    };
  });
}

/** A real deterministic Stage 1C report, exactly as the replay worker stores it. */
async function buildStoredReport(): Promise<SandboxRunReport> {
  const series = candles();
  const snapshot = snapshotReplayCandles(series);
  const paper = DEFAULT_PAPER_SETTINGS;
  const config: PaperRunConfig = {
    runId: REPLAY,
    seed: 7,
    timeframe: '1h',
    tokenIds: [TOKEN],
    initialCapitalUsd: '1000.00',
    ...paper,
  };
  const { report } = await runPaperFromCandles({
    runId: REPLAY,
    seed: 7,
    configVersion: paperConfigVersion(config),
    dataSnapshotId: snapshot.dataSnapshotId,
    tokenIds: [TOKEN],
    candles: snapshot.candles,
    settings: DEFAULT_SETTINGS,
    paper,
    initialCapitalUsd: '1000.00',
    evaluateFrom: FROM,
  });

  // The JSONB round-trip the worker performs before the row is stored.
  return JSON.parse(JSON.stringify(report)) as SandboxRunReport;
}

let storedReport: SandboxRunReport;

function completedRecord(
  overrides: Partial<SandboxReplayReportRecord> = {},
): SandboxReplayReportRecord {
  return {
    id: REPLAY,
    name: '30 дней',
    status: 'completed',
    tokenKeys: [TOKEN],
    periodDays: 30,
    fromTime: new Date(FROM),
    toTime: new Date(TO),
    initialCapitalUsd: '1000.00',
    finalEquityUsd: storedReport.metrics.finalEquityUsd,
    returnPct: storedReport.metrics.totalReturnPct,
    maxDrawdownPct: storedReport.metrics.maxDrawdownPct,
    reportHash: storedReport.reportHash,
    error: null,
    queuedAt: new Date(START),
    startedAt: new Date(START),
    finishedAt: new Date(TO),
    archivedAt: null,
    createdAt: new Date(START),
    updatedAt: new Date(TO),
    settings: DEFAULT_SETTINGS as unknown as Record<string, unknown>,
    paper: DEFAULT_PAPER_SETTINGS as unknown as Record<string, unknown>,
    seed: 7,
    eventCount: storedReport.eventCount,
    eventHash: storedReport.eventHash,
    dataSnapshotId: storedReport.dataSnapshotId,
    candleSnapshotHash: SNAPSHOT_HASH,
    report: storedReport as unknown as Record<string, unknown>,
    ...overrides,
  };
}

function harness(row: SandboxReplayReportRecord | null = completedRecord(), owner = USER) {
  const findReplayReport = vi.fn(async (userId: string, id: string) => {
    if (row === null || userId !== owner || id !== row.id) return null;
    return row;
  });
  const unexpectedWrite = vi.fn(() => {
    throw new Error('The replay report read path attempted a write');
  });
  // Every mutating repository method is present and would fail the test if a
  // GET ever reached it. The service must only read the stored JSONB report.
  const repository = {
    findReplayReport,
    createReplay: unexpectedWrite,
    cancelQueuedReplay: unexpectedWrite,
    archiveReplay: unexpectedWrite,
    claimQueuedReplay: unexpectedWrite,
    markReplayRunning: unexpectedWrite,
    storeReplaySnapshot: unexpectedWrite,
    storeReplayReport: unexpectedWrite,
    markReplayFailed: unexpectedWrite,
    requeueRunningReplays: unexpectedWrite,
  };
  const service = new SandboxReplayReportService(repository as never);

  return { service, row, findReplayReport, unexpectedWrite };
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

beforeAll(async () => {
  storedReport = await buildStoredReport();
});

describe('SandboxReplayReportService getReport', () => {
  it('wraps the stored report as historical paper with explicit notes', async () => {
    const h = harness();
    const result = await h.service.getReport(USER, REPLAY);

    expect(result.executionMode).toBe('historical-paper');
    expect(result.report).toEqual(storedReport);
    expect(result.report.reportHash).toBe(storedReport.reportHash);
    expect(result.identity).toMatchObject({
      reportHash: storedReport.reportHash,
      eventHash: storedReport.eventHash,
      eventCount: storedReport.eventCount,
      dataSnapshotId: storedReport.dataSnapshotId,
      candleSnapshotHash: SNAPSHOT_HASH,
      configVersion: storedReport.configVersion,
      settingsVersion: storedReport.settingsVersion,
      seed: storedReport.seed,
    });
    expect(sandboxReplayReportResponseSchema.safeParse(result).success).toBe(true);

    const notes = result.notes.join('\n');
    expect(notes).toMatch(/1h closed candles only/);
    expect(notes).toMatch(/next bar open/);
    expect(notes).toMatch(/not live or exchange fills/);
    expect(notes).toMatch(/not a performance claim/);
    expect(notes).toContain(new Date(FROM).toISOString());
    expect(notes).toContain(new Date(TO).toISOString());
    expect(notes).toMatch(/lookback prefix only/);
    expect(notes).toMatch(/full 180-day request has no prefix/);
    expect(notes).toContain(`Report hash ${storedReport.reportHash}`);
    expect(notes).toContain(`candle snapshot SHA-256 ${SNAPSHOT_HASH}`);
    expect(notes).toContain(storedReport.dataSnapshotId);
    expect(notes).toMatch(/full hash-chained event journal is not persisted/);
    expect(notes).toContain(`eventCount ${storedReport.eventCount}`);
    expect(notes).toContain(`eventHash ${storedReport.eventHash}`);

    expect(h.findReplayReport).toHaveBeenCalledTimes(1);
    expect(h.findReplayReport).toHaveBeenCalledWith(USER, REPLAY);
    expect(h.unexpectedWrite).not.toHaveBeenCalled();
  });

  it('returns 404 for another owner or an unknown replay', async () => {
    const h = harness();

    await expectCode(
      h.service.getReport(OTHER, REPLAY),
      NotFoundException,
      'SANDBOX_REPLAY_NOT_FOUND',
    );
    await expectCode(
      h.service.getReport(USER, '99999999-9999-4999-8999-999999999999'),
      NotFoundException,
      'SANDBOX_REPLAY_NOT_FOUND',
    );
  });

  it('returns 409 for every non-completed status', async () => {
    for (const status of ['queued', 'running', 'failed', 'cancelled'] as const) {
      const h = harness(completedRecord({ status }));
      await expectCode(
        h.service.getReport(USER, REPLAY),
        ConflictException,
        'SANDBOX_REPLAY_NOT_COMPLETED',
      );
      expect(h.unexpectedWrite).not.toHaveBeenCalled();
    }
  });

  it('fails closed on a completed row with a missing or invalid stored report', async () => {
    await expectCode(
      harness(completedRecord({ report: null })).service.getReport(USER, REPLAY),
      ConflictException,
      'SANDBOX_REPLAY_STATE_INVALID',
    );
    await expectCode(
      harness(completedRecord({ report: { runId: REPLAY } })).service.getReport(USER, REPLAY),
      ConflictException,
      'SANDBOX_REPLAY_STATE_INVALID',
    );
  });

  it('fails closed when the stored report identity contradicts its row', async () => {
    await expectCode(
      harness(completedRecord({ reportHash: 'd'.repeat(64) })).service.getReport(USER, REPLAY),
      ConflictException,
      'SANDBOX_REPLAY_STATE_INVALID',
    );
    await expectCode(
      harness(completedRecord({ eventCount: storedReport.eventCount + 1 })).service.getReport(
        USER,
        REPLAY,
      ),
      ConflictException,
      'SANDBOX_REPLAY_STATE_INVALID',
    );
  });

  it('never mutates the stored report or the row on read', async () => {
    const row = completedRecord();
    const before = JSON.stringify(row);
    const h = harness(row);

    await h.service.getReport(USER, REPLAY);

    expect(JSON.stringify(row)).toBe(before);
    expect(h.unexpectedWrite).not.toHaveBeenCalled();
  });
});
