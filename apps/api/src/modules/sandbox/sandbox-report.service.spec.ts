import {
  DEFAULT_PAPER_SETTINGS,
  DEFAULT_SETTINGS,
  MemoryEventLog,
  type SandboxEventInput,
} from '@nexter/sandbox-core';
import { describe, expect, it } from 'vitest';
import {
  makeEngineState,
  makeEquityPoint,
  makeOpenLedger,
  SANDBOX_TEST_AT,
  SANDBOX_TEST_TOKEN,
} from '../../../test/helpers/sandbox-fixtures';
import {
  buildSandboxReport,
  renderSandboxReportMarkdown,
  toSandboxReportResponse,
  type SandboxReportSource,
} from './sandbox-report.service';
import type { SandboxRunSnapshot } from './sandbox.types';

async function reportSource(): Promise<SandboxReportSource> {
  const open = makeOpenLedger();
  const log = new MemoryEventLog();
  const event: SandboxEventInput = {
    runId: '11111111-1111-4111-8111-111111111111',
    clockTime: new Date(SANDBOX_TEST_AT).toISOString(),
    module: 'run',
    eventType: 'run.ticked',
    severity: 'info',
    dataSnapshotId: 'snapshot-1',
    configVersion: 'config-1',
    seed: 1,
  };
  await log.append(event);
  const events = log.events();
  const equityPoint = makeEquityPoint(open.marked, SANDBOX_TEST_AT, open.ledger.cashUsd);
  const run: SandboxRunSnapshot = {
    id: event.runId,
    userId: '22222222-2222-4222-8222-222222222222',
    name: 'Report fixture',
    status: 'stopped',
    initialCapitalUsd: open.ledger.initialCapitalUsd,
    cashUsd: open.ledger.cashUsd,
    equityUsd: open.marked.equityUsd,
    peakEquityUsd: open.ledger.initialCapitalUsd,
    dayStartEquityUsd: open.ledger.initialCapitalUsd,
    settings: {},
    engineState: makeEngineState(),
    ledgerState: open.ledger,
    lastBarClose: new Date(SANDBOX_TEST_AT),
    eventSeq: events.length,
    eventHash: log.hash(),
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

  return {
    run,
    config: {
      tokenKeys: [SANDBOX_TEST_TOKEN],
      seed: 1,
      settings: DEFAULT_SETTINGS,
      paper: DEFAULT_PAPER_SETTINGS,
    },
    events,
    equity: [equityPoint],
    intents: open.intents,
    marks: { [SANDBOX_TEST_TOKEN]: open.marked.positions[0]?.marketPriceUsd ?? '105.00000000' },
  };
}

describe('sandbox report service', () => {
  it('builds a deterministic live-paper report from persisted state', async () => {
    const source = await reportSource();
    const first = buildSandboxReport(source);
    const second = buildSandboxReport(await reportSource());

    expect(first.reportHash).toMatch(/^[0-9a-f]{64}$/);
    expect(second.reportHash).toBe(first.reportHash);
    expect(first.eventCount).toBe(1);
    expect(first.eventHash).toBe(source.run.eventHash);
    expect(first.positions).toHaveLength(1);
    expect(first.positions[0]?.tokenId).toBe(SANDBOX_TEST_TOKEN);
    expect(first.counterfactuals).toEqual([]);
    expect(first.reconciliationOk).toBe(true);
    expect(first.metrics.finalEquityUsd).toBe(source.run.equityUsd);
  });

  it('labels the JSON wrapper and Markdown without changing the core hash', async () => {
    const report = buildSandboxReport(await reportSource());
    const response = toSandboxReportResponse(report);
    const markdown = renderSandboxReportMarkdown(report);

    expect(response.executionMode).toBe('live-paper');
    expect(response.report.reportHash).toBe(report.reportHash);
    expect(markdown.startsWith('# Live paper run report')).toBe(true);
    expect(markdown).toContain('> Execution mode: `live-paper`');
    expect(markdown).toContain('## Summary');
    expect(markdown).toContain('## Reconciliation');
    expect(markdown).toContain('Counterfactuals are omitted for live-paper runs');
    expect(markdown).toContain(report.reportHash);
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
