import {
  applyBuyFill,
  createLedger,
  DEFAULT_PAPER_SETTINGS,
  DEFAULT_SETTINGS,
  markPortfolio,
  MemoryEventLog,
  planBuyFill,
  Reason,
  type IntentRecord,
  type OrderIntent,
  type PaperLedgerState,
  type SandboxEventInput,
} from '@nexter/sandbox-core';
import type { SandboxPositionRecord } from '@nexter/db';
import { ConflictException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  makeEngineState,
  makeEquityPoint,
  makeOpenLedger,
  SANDBOX_TEST_AT,
  SANDBOX_TEST_TOKEN,
} from '../../../test/helpers/sandbox-fixtures';
import { formatUnits, toSandboxPosition } from './sandbox-read.mapper';
import {
  buildSandboxReport,
  renderSandboxReportMarkdown,
  SandboxReportConsistencyError,
  SandboxReportService,
  sandboxReportNotes,
  toSandboxReportResponse,
  type SandboxReportSource,
} from './sandbox-report.service';
import {
  buildSandboxPositionRows,
  SandboxPersistenceError,
  type SandboxRunSnapshot,
} from './sandbox.types';

const RUN_ID = '11111111-1111-4111-8111-111111111111';

function eventInput(snapshotId: string): SandboxEventInput {
  return {
    runId: RUN_ID,
    clockTime: new Date(SANDBOX_TEST_AT).toISOString(),
    module: 'run',
    eventType: 'run.ticked',
    severity: 'info',
    dataSnapshotId: snapshotId,
    configVersion: 'config-1',
    seed: 1,
  };
}

function runSnapshot(input: {
  runId: string;
  ledger: PaperLedgerState;
  equityUsd: string;
  engineState: ReturnType<typeof makeEngineState>;
  eventCount: number;
  eventHash: string;
}): SandboxRunSnapshot {
  return {
    id: input.runId,
    userId: '22222222-2222-4222-8222-222222222222',
    name: 'Report fixture',
    status: 'stopped',
    initialCapitalUsd: input.ledger.initialCapitalUsd,
    cashUsd: input.ledger.cashUsd,
    equityUsd: input.equityUsd,
    peakEquityUsd: input.ledger.initialCapitalUsd,
    dayStartEquityUsd: input.ledger.initialCapitalUsd,
    settings: {},
    engineState: input.engineState,
    ledgerState: input.ledger,
    lastBarClose: new Date(SANDBOX_TEST_AT),
    eventSeq: input.eventCount,
    eventHash: input.eventHash,
    lastTickAt: new Date(SANDBOX_TEST_AT),
    error: null,
    createdAt: new Date(SANDBOX_TEST_AT),
    updatedAt: new Date(SANDBOX_TEST_AT),
    startedAt: new Date(SANDBOX_TEST_AT),
    pausedAt: null,
    stoppedAt: new Date(SANDBOX_TEST_AT),
    archivedAt: null,
    tokens: [
      {
        tokenKey: SANDBOX_TEST_TOKEN,
        symbol: 'CAKE',
        chain: 'bsc',
        contractAddress: SANDBOX_TEST_TOKEN.slice('bsc:'.length),
        enabled: true,
      },
    ],
  };
}

const runnerConfig = {
  tokenKeys: [SANDBOX_TEST_TOKEN],
  seed: 1,
  settings: DEFAULT_SETTINGS,
  paper: DEFAULT_PAPER_SETTINGS,
};

async function reportSource(): Promise<SandboxReportSource> {
  const open = makeOpenLedger();
  const log = new MemoryEventLog();
  await log.append(eventInput('snapshot-0'));
  await log.append(eventInput('snapshot-1'));
  const events = log.events();
  const equityPoint = makeEquityPoint(open.marked, SANDBOX_TEST_AT, open.ledger.cashUsd);
  const run = runSnapshot({
    runId: RUN_ID,
    ledger: open.ledger,
    equityUsd: open.marked.equityUsd,
    engineState: makeEngineState(),
    eventCount: events.length,
    eventHash: log.hash(),
  });

  return {
    run,
    config: runnerConfig,
    events,
    equity: [equityPoint],
    intents: open.intents,
    marks: { [SANDBOX_TEST_TOKEN]: open.marked.positions[0]?.marketPriceUsd ?? '105.00000000' },
  };
}

function tinyPriceSource(exactMark: string): SandboxReportSource {
  const price = '0.00000012';
  const intent: OrderIntent = {
    intentId: 'intent-tiny',
    tokenId: SANDBOX_TEST_TOKEN,
    side: 'buy',
    strategyKey: 'trend_pullback',
    strategyVersion: 1,
    reasonCode: Reason.TREND_PULLBACK_ENTRY,
    sizeUsd: '1.00',
    amount: null,
    stopLossPct: null,
    takeProfitPct: null,
    decisionPriceUsd: price,
    clockTime: SANDBOX_TEST_AT,
  };
  const plan = planBuyFill({
    intent,
    candle: {
      tokenId: SANDBOX_TEST_TOKEN,
      timeframe: '1h',
      openTime: SANDBOX_TEST_AT,
      open: price,
      high: price,
      low: price,
      close: price,
      volumeUsd: '1000000.00000000',
    },
    cashUsd: '1000.00',
    equityUsd: '1000.00',
    cashBufferPct: 0,
    settings: DEFAULT_PAPER_SETTINGS,
    hasPosition: false,
  });
  if (plan.status !== 'filled') throw new Error(`tiny-price fixture buy was ${plan.status}`);
  const ledger = applyBuyFill(createLedger('1000.00'), plan, intent, SANDBOX_TEST_AT).state;
  const marked = markPortfolio(ledger, { [SANDBOX_TEST_TOKEN]: exactMark });
  const record: IntentRecord = {
    intentId: intent.intentId,
    tokenId: intent.tokenId,
    side: 'buy',
    strategyKey: intent.strategyKey,
    strategyVersion: intent.strategyVersion,
    status: 'filled',
    requestedUsd: plan.requestedUsd,
    requestedAmount: null,
    filledUsd: plan.filledUsd,
    filledAmount: plan.amount,
    priceUsd: plan.priceUsd,
    feeUsd: plan.feeUsd,
    reasonCode: plan.reasonCode,
    strategyReasonCode: intent.reasonCode,
    reasonText: plan.reasonText,
    decisionTime: SANDBOX_TEST_AT,
    fillTime: SANDBOX_TEST_AT,
  };

  // Only a valid count/hash pair is needed for the pure report fixture.
  const event = {
    ...eventInput('snapshot-tiny'),
    seq: 0,
    recordedAt: new Date(SANDBOX_TEST_AT).toISOString(),
    prevHash: '0'.repeat(64),
    hash: 'a'.repeat(64),
  };
  return {
    run: runSnapshot({
      runId: RUN_ID,
      ledger,
      equityUsd: marked.equityUsd,
      engineState: makeEngineState(),
      eventCount: 1,
      eventHash: event.hash,
    }),
    config: runnerConfig,
    events: [event],
    equity: [
      {
        clockTime: SANDBOX_TEST_AT,
        equityUsd: marked.equityUsd,
        cashUsd: ledger.cashUsd,
        positionsValueUsd: marked.positionsValueUsd,
        drawdownPct: '0.00',
      },
    ],
    intents: [record],
    marks: { [SANDBOX_TEST_TOKEN]: exactMark },
  };
}

describe('sandbox report service', () => {
  it('builds a deterministic live-paper report from the persisted event chain', async () => {
    const source = await reportSource();
    const first = buildSandboxReport(source);
    const second = buildSandboxReport(await reportSource());

    expect(first.reportHash).toMatch(/^[0-9a-f]{64}$/);
    expect(second.reportHash).toBe(first.reportHash);
    expect(first.eventCount).toBe(2);
    expect(first.eventHash).toBe(source.run.eventHash);
    expect(first.positions).toHaveLength(1);
    expect(first.positions[0]?.tokenId).toBe(SANDBOX_TEST_TOKEN);
    expect(first.counterfactuals).toEqual([]);
    expect(first.reconciliationOk).toBe(true);
    expect(first.metrics.finalEquityUsd).toBe(source.run.equityUsd);
    // Identity comes from the persisted chain: config version is shared and the
    // data snapshot is the last persisted tick.
    expect(first.configVersion).toBe('config-1');
    expect(first.dataSnapshotId).toBe('snapshot-1');
  });

  it('labels the JSON wrapper and Markdown without changing the core hash', async () => {
    const report = buildSandboxReport(await reportSource());
    const notes = sandboxReportNotes(report, 2);
    const response = toSandboxReportResponse(report, 2, notes);
    const markdown = renderSandboxReportMarkdown(report, notes);

    expect(response.executionMode).toBe('live-paper');
    expect(response.report.reportHash).toBe(report.reportHash);
    expect(response.pendingIntents).toBe(2);
    expect(response.notes.join(' ')).toContain('2 pending intent(s) are excluded');
    expect(markdown.startsWith('# Live paper run report')).toBe(true);
    expect(markdown).toContain('> Execution mode: `live-paper`');
    expect(markdown).toContain('## Summary');
    expect(markdown).toContain('## Reconciliation');
    expect(markdown).toContain('2 pending intent(s) are excluded');
    expect(markdown).toContain('Counterfactuals are omitted for live-paper runs');
    expect(markdown).toContain(report.reportHash);
  });

  it('recomputes metrics from the exact 18dp mark for a sub-1e-6 token', () => {
    const exactMark = '0.000000123456789012';
    const source = tinyPriceSource(exactMark);
    const report = buildSandboxReport(source);

    expect(report.metrics.finalEquityUsd).toBe(source.run.equityUsd);
    expect(report.metrics.finalEquityUsd).toBe(source.equity[0]?.equityUsd);
    // The report display scale stays 8 decimals; the exact mark is only used to
    // recompute the 2-decimal USD value.
    expect(report.positions[0]?.marketPriceUsd).toBe('0.00000012');

    // The persisted projection keeps the exact mark and the read mapper rounds
    // it to the same 8-decimal display as the report.
    const ledger = source.run.ledgerState;
    if (ledger === null) throw new Error('tiny-price fixture has no ledger');
    const marked = markPortfolio(ledger, source.marks);
    const row = buildSandboxPositionRows(RUN_ID, ledger, marked.positions, source.marks)[0];
    if (row === undefined) throw new Error('tiny-price fixture has no position');
    expect(row.marketPriceUsd).toBe(exactMark);
    const apiPosition = toSandboxPosition({
      ...row,
      updatedAt: new Date(SANDBOX_TEST_AT),
    } satisfies SandboxPositionRecord);
    expect(apiPosition.marketPriceUsd).toBe('0.00000012');
  });

  it('refuses a report when an 8dp display price contradicts the persisted equity', () => {
    const exactMark = '0.000000123456789012';
    const source = tinyPriceSource(exactMark);
    const truncated = {
      ...source,
      marks: { [SANDBOX_TEST_TOKEN]: formatUnits(exactMark) },
    };

    expect(() => buildSandboxReport(truncated)).toThrow(SandboxReportConsistencyError);
  });

  it('refuses a report when the run head does not match the event chain', async () => {
    const source = await reportSource();
    const tampered = {
      ...source,
      run: { ...source.run, eventHash: 'b'.repeat(64) },
    };

    expect(() => buildSandboxReport(tampered)).toThrow(/event audit/i);
  });

  it('refuses a report without an equity point', async () => {
    const source = await reportSource();
    expect(() => buildSandboxReport({ ...source, equity: [] })).toThrow(/equity point/i);
  });
});

describe('sandbox report service read failures', () => {
  function repository(overrides: {
    run?: () => Promise<SandboxRunSnapshot>;
    events?: () => Promise<never>;
  }) {
    return {
      loadRun:
        overrides.run ??
        (async () => {
          const source = await reportSource();
          return source.run;
        }),
      listAllEvents: overrides.events ?? (async () => []),
      listAllEquityPoints: async () => [],
      listTerminalIntents: async () => [],
      listPositions: async () => [],
      countIntents: async () => 0,
    };
  }

  it('maps a corrupt persisted run to the typed report-not-ready 409', async () => {
    const service = new SandboxReportService(
      repository({
        run: async () => {
          throw new SandboxPersistenceError('SANDBOX_STATE_INVALID', 'corrupt ledger');
        },
      }) as never,
    );

    const error = await service.getReport('22222222-2222-4222-8222-222222222222', RUN_ID).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({
      code: 'SANDBOX_REPORT_NOT_READY',
    });
  });

  it('maps a corrupt event payload read to the typed report-not-ready 409', async () => {
    const service = new SandboxReportService(
      repository({
        events: async () => {
          throw new SandboxPersistenceError('SANDBOX_EVENT_PAYLOAD_INVALID', 'bad event payload');
        },
      }) as never,
    );

    const error = await service.getReport('22222222-2222-4222-8222-222222222222', RUN_ID).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({
      code: 'SANDBOX_REPORT_NOT_READY',
    });
  });
});
