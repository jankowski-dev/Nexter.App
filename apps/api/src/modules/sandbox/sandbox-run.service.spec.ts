import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  applyBuyFill,
  createLedger,
  DEFAULT_PAPER_SETTINGS,
  DEFAULT_SETTINGS,
  planBuyFill,
  Reason,
  type PaperLedgerState,
} from '@nexter/sandbox-core';
import { SandboxRunService, toRunContract } from './sandbox-run.service';
import type { SandboxTokenRecord } from './sandbox.repository';
import type { SandboxRunSnapshot, SandboxRunStatus, SandboxRunnerConfig } from './sandbox.types';

const USER = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const RUN = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'bsc:0x1111111111111111111111111111111111111111';
const AT = Date.UTC(2026, 0, 1);
const HOUR = 3_600_000;

function config(tokenKeys: string[] = [TOKEN]): SandboxRunnerConfig {
  return { tokenKeys, seed: 1, settings: DEFAULT_SETTINGS, paper: DEFAULT_PAPER_SETTINGS };
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
    createdAt: new Date(AT),
    updatedAt: new Date(AT),
  };
}

function ledgerWithPosition(): PaperLedgerState {
  const initial = createLedger('1000.00');
  const intent = {
    intentId: 'intent-open',
    tokenId: TOKEN,
    side: 'buy' as const,
    strategyKey: 'trend_pullback' as const,
    strategyVersion: 1,
    reasonCode: Reason.TREND_PULLBACK_ENTRY,
    sizeUsd: '200.00',
    amount: null,
    stopLossPct: '3.00',
    takeProfitPct: null,
    decisionPriceUsd: '99.00000000',
    clockTime: AT,
  };
  const plan = planBuyFill({
    intent,
    candle: {
      tokenId: TOKEN,
      timeframe: '1h',
      openTime: AT,
      open: '100.00000000',
      high: '100.00000000',
      low: '100.00000000',
      close: '100.00000000',
      volumeUsd: '100000.00000000',
    },
    cashUsd: initial.cashUsd,
    equityUsd: '1000.00',
    cashBufferPct: 0,
    settings: DEFAULT_PAPER_SETTINGS,
    hasPosition: false,
  });
  return applyBuyFill(initial, plan, intent, AT).state;
}

function makeRun(overrides: Partial<SandboxRunSnapshot> = {}): SandboxRunSnapshot {
  const status = (overrides.status ?? 'draft') as SandboxRunStatus;
  const draft = status === 'draft';
  const ledger = overrides.ledgerState ?? (draft ? null : createLedger('1000.00'));
  return {
    id: RUN,
    userId: USER,
    name: 'My sandbox',
    status,
    initialCapitalUsd: '1000.00',
    cashUsd: ledger?.cashUsd ?? '1000.00',
    equityUsd: ledger?.cashUsd ?? '1000.00',
    peakEquityUsd: '1000.00',
    dayStartEquityUsd: '1000.00',
    settings: config() as unknown as Record<string, unknown>,
    engineState: overrides.engineState ?? (draft ? null : { tokens: {} }),
    ledgerState: ledger,
    lastBarClose: null,
    eventSeq: 0,
    eventHash: '0'.repeat(64),
    lastTickAt: null,
    error: null,
    createdAt: new Date(AT),
    updatedAt: new Date(AT),
    startedAt: draft ? null : new Date(AT),
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
    ...overrides,
  };
}

function harness(initial: SandboxRunSnapshot = makeRun()) {
  let run = initial;
  let pendingSell = false;
  const repo = {
    loadRun: vi.fn(async (id: string) => (id === run.id ? run : null)),
    listTokens: vi.fn(async (userId: string) => (userId === USER ? [tokenRecord()] : [])),
    createRun: vi.fn(async () => run.id),
    updateDraftRun: vi.fn(async (_userId: string, _id: string, patch: Record<string, unknown>) => {
      if (run.status !== 'draft' || run.archivedAt !== null) return false;
      run = {
        ...run,
        name: (patch.name as string | undefined) ?? run.name,
        initialCapitalUsd: (patch.initialCapitalUsd as string | undefined) ?? run.initialCapitalUsd,
        cashUsd: (patch.initialCapitalUsd as string | undefined) ?? run.cashUsd,
        equityUsd: (patch.initialCapitalUsd as string | undefined) ?? run.equityUsd,
        peakEquityUsd: (patch.initialCapitalUsd as string | undefined) ?? run.peakEquityUsd,
        dayStartEquityUsd: (patch.initialCapitalUsd as string | undefined) ?? run.dayStartEquityUsd,
        settings: (patch.settings as Record<string, unknown> | undefined) ?? run.settings,
        updatedAt: new Date(AT),
      };
      return true;
    }),
    startRun: vi.fn(
      async (
        _userId: string,
        _id: string,
        input: {
          config: Record<string, unknown>;
          initialCapitalUsd: string;
          engineState: Record<string, unknown>;
          ledgerState: Record<string, unknown>;
          tokens: SandboxRunSnapshot['tokens'];
        },
      ) => {
        if (run.status !== 'draft') return false;
        run = {
          ...run,
          status: 'running',
          settings: input.config,
          initialCapitalUsd: input.initialCapitalUsd,
          cashUsd: input.initialCapitalUsd,
          equityUsd: input.initialCapitalUsd,
          peakEquityUsd: input.initialCapitalUsd,
          dayStartEquityUsd: input.initialCapitalUsd,
          engineState: input.engineState as unknown as SandboxRunSnapshot['engineState'],
          ledgerState: input.ledgerState as unknown as SandboxRunSnapshot['ledgerState'],
          tokens: input.tokens,
          startedAt: new Date(AT),
        };
        return true;
      },
    ),
    transitionRun: vi.fn(
      async (
        _userId: string,
        _id: string,
        from: string[],
        patch: Partial<SandboxRunSnapshot> & { status: SandboxRunStatus },
      ) => {
        if (!from.includes(run.status) || run.archivedAt !== null) return false;
        run = { ...run, ...patch, updatedAt: new Date(AT) };
        return true;
      },
    ),
    archiveRun: vi.fn(async () => {
      if ((run.status !== 'stopped' && run.status !== 'failed') || run.archivedAt !== null) {
        return false;
      }
      run = { ...run, archivedAt: new Date(AT) };
      return true;
    }),
    hasPendingSell: vi.fn(async () => pendingSell),
    insertManualCloseIntent: vi.fn(async () => true),
    expirePendingIntents: vi.fn(async () => 0),
  };
  const preflight = vi.fn(
    async (): Promise<{
      status: 'ok' | 'partial' | 'missing';
      warnings: string[];
      coverage: unknown[];
    }> => ({
      status: 'ok',
      warnings: [],
      coverage: [],
    }),
  );
  const tokens = { preflight };
  const data = {
    refreshToken: vi.fn(async () => ({
      fetched: 4320,
      upserted: 4320,
      source: 'geckoterminal',
      synthetic: false,
    })),
  };
  const audit = { log: vi.fn(async (_input: { action: string }) => undefined) };
  const service = new SandboxRunService(
    repo as never,
    tokens as never,
    data as never,
    audit as never,
  );

  return {
    service,
    repo,
    preflight,
    data,
    audit,
    getRun: () => run,
    setRun: (next: SandboxRunSnapshot) => {
      run = next;
    },
    setPendingSell: (value: boolean) => {
      pendingSell = value;
    },
  };
}

describe('SandboxRunService lifecycle', () => {
  it('creates a draft with defaults and audits it', async () => {
    const h = harness(makeRun({ status: 'draft' }));
    const created = await h.service.create(
      USER,
      {
        name: '  My sandbox  ',
        initialCapitalUsd: '1000',
        tokenKeys: [TOKEN],
      },
      {},
    );

    expect(h.repo.createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER,
        name: '  My sandbox  ',
        initialCapitalUsd: '1000.00',
      }),
    );
    expect(created).toMatchObject({
      id: RUN,
      status: 'draft',
      initialCapitalUsd: '1000.00',
      tokenKeys: [TOKEN],
    });
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'sandbox.run_created', entityId: RUN }),
    );
  });

  it('updates only a draft and rejects edits after start', async () => {
    const h = harness(makeRun({ status: 'draft' }));
    const updated = await h.service.updateDraft(
      USER,
      RUN,
      { name: 'Renamed', initialCapitalUsd: '1500' },
      {},
    );
    expect(updated).toMatchObject({ name: 'Renamed', initialCapitalUsd: '1500.00' });
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'sandbox.run_updated' }),
    );

    h.setRun(makeRun({ status: 'running' }));
    await expect(h.service.updateDraft(USER, RUN, { name: 'Nope' }, {})).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('rejects start without coverage and starts with explicit partial confirmation', async () => {
    const h = harness(makeRun({ status: 'draft' }));
    h.preflight.mockResolvedValueOnce({
      status: 'missing',
      warnings: ['Нет свечей'],
      coverage: [],
    });
    await expect(h.service.start(USER, RUN, {}, {})).rejects.toBeInstanceOf(ConflictException);

    h.preflight.mockResolvedValueOnce({
      status: 'partial',
      warnings: ['Мало свечей'],
      coverage: [],
    });
    await expect(h.service.start(USER, RUN, {}, {})).rejects.toBeInstanceOf(ConflictException);

    h.preflight.mockResolvedValueOnce({
      status: 'partial',
      warnings: ['Мало свечей'],
      coverage: [],
    });
    const started = await h.service.start(USER, RUN, { allowPartial: true }, {});
    expect(started.status).toBe('running');
    expect(h.data.refreshToken).toHaveBeenCalledWith(
      expect.objectContaining({ tokenKey: TOKEN }),
      expect.objectContaining({ now: expect.any(Date) }),
    );
    expect(h.repo.startRun).toHaveBeenCalledWith(
      USER,
      RUN,
      expect.objectContaining({
        initialCapitalUsd: '1000.00',
        engineState: { tokens: {} },
        tokens: [expect.objectContaining({ tokenKey: TOKEN })],
      }),
    );
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'sandbox.run_started' }),
    );
  });

  it('rejects a second start', async () => {
    const h = harness(makeRun({ status: 'running' }));
    await expect(h.service.start(USER, RUN, {}, {})).rejects.toBeInstanceOf(ConflictException);
  });

  it('runs pause, resume and stop transitions and audits each', async () => {
    const h = harness(makeRun({ status: 'running' }));

    expect((await h.service.pause(USER, RUN, {})).status).toBe('paused');
    expect((await h.service.resume(USER, RUN, {})).status).toBe('running');
    expect((await h.service.stop(USER, RUN, {})).status).toBe('stopped');

    expect(h.repo.expirePendingIntents).toHaveBeenCalledWith(
      RUN,
      'Run stopped before the pending intent could fill',
    );
    expect(h.audit.log.mock.calls.map((call) => call[0].action)).toEqual([
      'sandbox.run_paused',
      'sandbox.run_resumed',
      'sandbox.run_stopped',
    ]);
  });

  it('returns 409 for invalid lifecycle transitions', async () => {
    const paused = harness(makeRun({ status: 'paused' }));
    await expect(paused.service.pause(USER, RUN, {})).rejects.toBeInstanceOf(ConflictException);

    const stopped = harness(makeRun({ status: 'stopped' }));
    await expect(stopped.service.resume(USER, RUN, {})).rejects.toBeInstanceOf(ConflictException);
    await expect(stopped.service.stop(USER, RUN, {})).rejects.toBeInstanceOf(ConflictException);

    const running = harness(makeRun({ status: 'running' }));
    await expect(running.service.archive(USER, RUN, {})).rejects.toBeInstanceOf(ConflictException);
  });

  it('archives only terminal runs and returns the archived contract', async () => {
    const h = harness(makeRun({ status: 'stopped' }));
    const archived = await h.service.archive(USER, RUN, {});
    expect(archived.archivedAt).not.toBeNull();
    expect(h.repo.expirePendingIntents).toHaveBeenCalledWith(
      RUN,
      'Run archived before the pending intent could fill',
    );
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'sandbox.run_archived' }),
    );
  });

  it('hides another owner’s run', async () => {
    const h = harness(makeRun({ status: 'draft' }));
    await expect(h.service.pause(OTHER, RUN, {})).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('SandboxRunService close trade', () => {
  it('queues one manual sell intent and audits it', async () => {
    const ledger = ledgerWithPosition();
    const h = harness(makeRun({ status: 'running', ledgerState: ledger }));

    const run = await h.service.requestClose(USER, RUN, TOKEN, {});

    expect(run.status).toBe('running');
    expect(h.repo.insertManualCloseIntent).toHaveBeenCalledWith(
      RUN,
      expect.objectContaining({
        tokenId: TOKEN,
        side: 'sell',
        reasonCode: Reason.MANUAL_CLOSE,
        amount: ledger.positions[TOKEN]?.amount,
      }),
    );
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'sandbox.trade_close_requested' }),
    );
  });

  it('returns 409 when the pending index rejects a duplicate close during the insert', async () => {
    const h = harness(makeRun({ status: 'running', ledgerState: ledgerWithPosition() }));
    h.repo.insertManualCloseIntent.mockResolvedValueOnce(false);

    await expect(h.service.requestClose(USER, RUN, TOKEN, {})).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('rejects a close when the run is not running', async () => {
    const h = harness(makeRun({ status: 'paused', ledgerState: ledgerWithPosition() }));
    await expect(h.service.requestClose(USER, RUN, TOKEN, {})).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('rejects a close without a position or with a queued close', async () => {
    const empty = harness(makeRun({ status: 'running', ledgerState: createLedger('1000.00') }));
    await expect(empty.service.requestClose(USER, RUN, TOKEN, {})).rejects.toBeInstanceOf(
      ConflictException,
    );

    const queued = harness(makeRun({ status: 'running', ledgerState: ledgerWithPosition() }));
    queued.setPendingSell(true);
    await expect(queued.service.requestClose(USER, RUN, TOKEN, {})).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('rejects a token outside the run universe', async () => {
    const h = harness(makeRun({ status: 'running', ledgerState: ledgerWithPosition() }));
    await expect(
      h.service.requestClose(USER, RUN, 'bsc:0x2222222222222222222222222222222222222222', {}),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('toRunContract', () => {
  it('returns decimal strings and ISO timestamps', () => {
    const contract = toRunContract(
      makeRun({
        status: 'running',
        lastBarClose: new Date(AT),
        lastTickAt: new Date(AT + HOUR),
      }),
    );
    const parsed = contract as unknown as { lastBarClose: string; initialCapitalUsd: string };

    expect(parsed.lastBarClose).toBe(new Date(AT).toISOString());
    expect(parsed.initialCapitalUsd).toBe('1000.00');
  });
});
