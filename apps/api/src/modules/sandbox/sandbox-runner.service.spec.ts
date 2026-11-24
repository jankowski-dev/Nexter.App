import { describe, expect, it, vi } from 'vitest';
import {
  createLedger,
  DEFAULT_PAPER_SETTINGS,
  DEFAULT_SETTINGS,
  MemoryEventLog,
  type Candle,
} from '@nexter/sandbox-core';
import { SandboxRunnerService } from './sandbox-runner.service';
import type { SandboxPendingIntent, SandboxTokenRecord } from './sandbox.repository';
import type { SandboxRunSnapshot, SandboxRunnerConfig } from './sandbox.types';

const USER = '22222222-2222-4222-8222-222222222222';
const RUN = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'bsc:0x1111111111111111111111111111111111111111';
const START = Date.UTC(2026, 0, 1);
const HOUR = 3_600_000;

function config(): SandboxRunnerConfig {
  return { tokenKeys: [TOKEN], seed: 1, settings: DEFAULT_SETTINGS, paper: DEFAULT_PAPER_SETTINGS };
}

function candles(count = 220): Candle[] {
  return Array.from({ length: count }, (_, index) => ({
    tokenId: TOKEN,
    timeframe: '1h',
    openTime: START + index * HOUR,
    open: '100.00000000',
    high: '100.00000000',
    low: '100.00000000',
    close: '100.00000000',
    volumeUsd: '100000.00000000',
  }));
}

function lastClose(series: readonly Candle[]): number {
  const last = series[series.length - 1];
  if (!last) throw new Error('fixture has no candles');
  return last.openTime + HOUR;
}

function runSnapshot(options: { lastBarClose?: Date | null; status?: string } = {}) {
  const ledger = createLedger('1000.00');
  const run: SandboxRunSnapshot = {
    id: RUN,
    userId: USER,
    name: 'Runner fixture',
    status: (options.status ?? 'running') as SandboxRunSnapshot['status'],
    initialCapitalUsd: '1000.00',
    cashUsd: '1000.00',
    equityUsd: '1000.00',
    peakEquityUsd: '1000.00',
    dayStartEquityUsd: '1000.00',
    settings: config() as unknown as Record<string, unknown>,
    engineState: { tokens: {} },
    ledgerState: ledger,
    lastBarClose: options.lastBarClose ?? null,
    eventSeq: 0,
    eventHash: '0'.repeat(64),
    lastTickAt: null,
    error: null,
    createdAt: new Date(START),
    updatedAt: new Date(START),
    startedAt: new Date(START),
    pausedAt: null,
    stoppedAt: null,
    archivedAt: null,
    tokens: [
      {
        tokenKey: TOKEN,
        symbol: 'CAKE',
        chain: 'bsc',
        contractAddress: TOKEN.slice('bsc:'.length),
        enabled: true,
      },
    ],
  };
  return run;
}

function tokenRecord(): SandboxTokenRecord {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    userId: USER,
    tokenKey: TOKEN,
    symbol: 'CAKE',
    name: 'PancakeSwap',
    chain: 'bsc',
    contractAddress: TOKEN.slice('bsc:'.length),
    coingeckoId: null,
    enabled: true,
    createdAt: new Date(START),
    updatedAt: new Date(START),
  };
}

function harness(options: { locked?: boolean; commitError?: Error } = {}) {
  let run = runSnapshot();
  let pending: SandboxPendingIntent[] = [];
  let commitError = options.commitError;
  const series = candles();
  const createdPending: SandboxPendingIntent[][] = [];

  const repo = {
    loadRun: vi.fn(async (id: string) => (id === run.id ? run : null)),
    listTokens: vi.fn(async () => (run.userId === USER ? [tokenRecord()] : [])),
    listRunningRuns: vi.fn(async () =>
      run.status === 'running' ? [{ id: run.id, userId: run.userId }] : [],
    ),
    loadCandles: vi.fn(async () => series),
    touchRunTick: vi.fn(async (_id: string, at: Date) => {
      run = { ...run, lastTickAt: at };
    }),
    markRunFailed: vi.fn(async (_id: string, error: string) => {
      run = { ...run, status: 'failed', error };
    }),
    lockRunForTick: vi.fn(async () => ({
      status: run.status,
      archivedAt: run.archivedAt,
      lastBarClose: run.lastBarClose,
    })),
    expirePendingIntents: vi.fn(async () => 0),
    listPendingIntents: vi.fn(async () => pending),
    insertPendingIntents: vi.fn(
      async (
        _tx: unknown,
        _id: string,
        intents: readonly {
          intentId: string;
          tokenId: string;
          side: 'buy' | 'sell';
          strategyKey: string;
          strategyVersion: number;
          sizeUsd: string;
          amount: string | null;
          decisionPriceUsd: string;
          clockTime: number;
          reasonCode: string;
        }[],
      ) => {
        const rows: SandboxPendingIntent[] = intents.map((intent) => ({
          runId: run.id,
          intentId: intent.intentId,
          tokenId: intent.tokenId,
          side: intent.side,
          strategyKey: intent.strategyKey as SandboxPendingIntent['strategyKey'],
          strategyVersion: intent.strategyVersion,
          requestedUsd: intent.side === 'buy' ? intent.sizeUsd : null,
          requestedAmount: intent.side === 'sell' ? intent.amount : null,
          priceUsd: intent.decisionPriceUsd,
          stopLossPct: null,
          takeProfitPct: null,
          strategyReasonCode: intent.reasonCode,
          reasonText: 'queued',
          decisionTime: new Date(intent.clockTime),
        }));
        createdPending.push(rows);
        pending = [...pending, ...rows];
        return rows.length;
      },
    ),
    commitTick: vi.fn(
      async (
        _id: string,
        work: (session: {
          tx: unknown;
          run: SandboxRunSnapshot;
          eventLog: MemoryEventLog;
        }) => Promise<{
          lastBarClose: Date;
          equityUsd: string;
          cashUsd: string;
          peakEquityUsd: string;
          dayStartEquityUsd: string;
          engineState: SandboxRunSnapshot['engineState'];
          ledgerState: SandboxRunSnapshot['ledgerState'];
          intents: readonly unknown[];
        }>,
      ) => {
        if (commitError) throw commitError;
        const eventLog = new MemoryEventLog();
        const tick = await work({ tx: {}, run, eventLog });
        run = {
          ...run,
          lastBarClose: tick.lastBarClose,
          equityUsd: tick.equityUsd,
          cashUsd: tick.cashUsd,
          peakEquityUsd: tick.peakEquityUsd,
          dayStartEquityUsd: tick.dayStartEquityUsd,
          engineState: tick.engineState,
          ledgerState: tick.ledgerState,
          lastTickAt: new Date(),
        };
        return {
          eventSeq: eventLog.events().length,
          eventHash: eventLog.hash(),
          positions: 0,
          trades: 0,
          ledgerEntries: 0,
          intents: tick.intents.length,
        };
      },
    ),
  };

  const client = {
    query: vi.fn(async (sql: string) =>
      sql.includes('try_advisory_lock')
        ? { rows: [{ locked: options.locked ?? true }] }
        : { rows: [] },
    ),
    release: vi.fn(),
  };
  const pool = { connect: vi.fn(async () => client) };
  const data = {
    latestPrice: vi.fn(async () => ({
      tokenId: TOKEN,
      priceUsd: '100.00000000',
      volumeUsd: '100000.00000000',
      barOpenTime: new Date(lastClose(series)),
      asOf: new Date(),
    })),
  };
  const audit = { log: vi.fn(async () => undefined) };
  const service = new SandboxRunnerService(
    pool as never,
    true,
    repo as never,
    data as never,
    audit as never,
  );

  return {
    service,
    repo,
    data,
    audit,
    series,
    client,
    pool,
    getRun: () => run,
    setRun: (next: SandboxRunSnapshot) => {
      run = next;
    },
    setPending: (next: SandboxPendingIntent[]) => {
      pending = next;
    },
    setCommitError: (error: Error | undefined) => {
      commitError = error;
    },
    createdPending,
  };
}

describe('SandboxRunnerService', () => {
  it('skips when the advisory lock is held elsewhere', async () => {
    const h = harness({ locked: false });

    await h.service.runOnce(new Date(START));

    expect(h.repo.listRunningRuns).not.toHaveBeenCalled();
    expect(h.client.release).toHaveBeenCalled();
  });

  it('only updates last_tick_at and skips provider calls before the next bar', async () => {
    const h = harness();
    h.setRun(runSnapshot({ lastBarClose: new Date(lastClose(h.series)) }));

    await h.service.runOnce(new Date(lastClose(h.series) + 30 * 60_000));

    expect(h.repo.touchRunTick).toHaveBeenCalledWith(RUN, expect.any(Date));
    expect(h.repo.commitTick).not.toHaveBeenCalled();
    expect(h.data.latestPrice).not.toHaveBeenCalled();
  });

  it('advances one run on a new bar and does not double-tick it', async () => {
    const h = harness();
    const now = new Date(lastClose(h.series));

    await h.service.runOnce(now);
    expect(h.repo.commitTick).toHaveBeenCalledTimes(1);
    expect(h.getRun().lastBarClose?.getTime()).toBe(lastClose(h.series));

    await h.service.runOnce(now);
    expect(h.repo.commitTick).toHaveBeenCalledTimes(1);
    expect(h.repo.touchRunTick).toHaveBeenCalled();
  });

  it('marks a run failed and audits a decision/reconciliation error', async () => {
    const h = harness({ commitError: new Error('ledger reconciliation failed') });

    await h.service.runOnce(new Date(lastClose(h.series)));

    expect(h.repo.markRunFailed).toHaveBeenCalledWith(RUN, 'ledger reconciliation failed');
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'sandbox.run_failed', entityId: RUN }),
    );
  });

  it('does not fail the run when the quote provider is unavailable', async () => {
    const h = harness();
    h.data.latestPrice.mockRejectedValue(new Error('provider 429'));

    await h.service.runOnce(new Date(lastClose(h.series)));

    expect(h.repo.commitTick).toHaveBeenCalledTimes(1);
    expect(h.repo.markRunFailed).not.toHaveBeenCalled();
  });

  it('does not advance paused or stopped runs', async () => {
    const h = harness();
    h.setRun(runSnapshot({ status: 'paused' }));

    await h.service.runOnce(new Date(lastClose(h.series)));

    expect(h.repo.commitTick).not.toHaveBeenCalled();
    expect(h.repo.touchRunTick).not.toHaveBeenCalled();
  });

  it('lets a pause that wins the row lock skip the in-flight tick', async () => {
    const h = harness();
    h.repo.lockRunForTick.mockResolvedValueOnce({
      status: 'paused',
      archivedAt: null,
      lastBarClose: null,
    });

    await h.service.runOnce(new Date(lastClose(h.series)));

    expect(h.repo.lockRunForTick).toHaveBeenCalled();
    expect(h.getRun().lastBarClose).toBeNull();
    expect(h.repo.markRunFailed).not.toHaveBeenCalled();
  });
});
