import { describe, expect, it } from 'vitest';
import {
  parseSandboxTokenKey,
  SANDBOX_HISTORICAL_EXECUTION_MODE,
  sandboxCoverageQuerySchema,
  sandboxCoverageResponseSchema,
  sandboxCoverageSchema,
  sandboxEquityQuerySchema,
  sandboxEquityResponseSchema,
  sandboxEventsQuerySchema,
  sandboxEventsResponseSchema,
  sandboxIntentSchema,
  sandboxOverviewSchema,
  sandboxPageQuerySchema,
  sandboxPositionSchema,
  sandboxReplayCoverageSchema,
  sandboxReplayCreateRequestSchema,
  sandboxReplayDetailSchema,
  sandboxReplayListQuerySchema,
  sandboxReplayListResponseSchema,
  sandboxReplayPeriodSchema,
  sandboxReplayPreflightRequestSchema,
  sandboxReplayPreflightResponseSchema,
  sandboxReplayReportResponseSchema,
  sandboxReplayStatusSchema,
  sandboxReplaySummarySchema,
  sandboxReportResponseSchema,
  sandboxRunConfigSchema,
  sandboxRunCreateRequestSchema,
  sandboxRunDetailSchema,
  sandboxRunSchema,
  sandboxRunStartRequestSchema,
  sandboxRunSummarySchema,
  sandboxRunUpdateRequestSchema,
  sandboxRunsQuerySchema,
  sandboxRunsResponseSchema,
  sandboxStatusSchema,
  sandboxTokenCreateRequestSchema,
  sandboxTokenKeySchema,
  sandboxTokenRefreshResponseSchema,
  sandboxTokenSchema,
  sandboxTokenUpdateRequestSchema,
  sandboxTradeSchema,
} from './sandbox';

const bscKey = 'bsc:0x1111111111111111111111111111111111111111';

describe('sandbox status', () => {
  it('parses the feature flag payload', () => {
    expect(sandboxStatusSchema.parse({ enabled: true, version: 'sandbox-stage-2' })).toEqual({
      enabled: true,
      version: 'sandbox-stage-2',
    });
    expect(sandboxStatusSchema.parse({ enabled: false, version: 'sandbox-stage-2' }).enabled).toBe(
      false,
    );
  });

  it('rejects a missing flag or version', () => {
    expect(sandboxStatusSchema.safeParse({ enabled: true }).success).toBe(false);
    expect(sandboxStatusSchema.safeParse({ version: 'v1' }).success).toBe(false);
    expect(sandboxStatusSchema.safeParse({ enabled: 'yes', version: 'v1' }).success).toBe(false);
  });
});

describe('sandbox token keys', () => {
  it('parses EVM and Binance provider keys', () => {
    expect(parseSandboxTokenKey(bscKey)).toEqual({
      chain: 'bsc',
      identifier: '0x1111111111111111111111111111111111111111',
      contractAddress: '0x1111111111111111111111111111111111111111',
      baseSymbol: null,
    });

    expect(parseSandboxTokenKey('ethereum:0xAbCdEf1111111111111111111111111111111111')).toEqual({
      chain: 'ethereum',
      identifier: '0xabcdef1111111111111111111111111111111111',
      contractAddress: '0xabcdef1111111111111111111111111111111111',
      baseSymbol: null,
    });

    expect(parseSandboxTokenKey('binance:BTCUSDT')).toEqual({
      chain: 'binance',
      identifier: 'BTCUSDT',
      contractAddress: null,
      baseSymbol: 'BTC',
    });
  });

  it.each([
    'solana:0x1111111111111111111111111111111111111111',
    'bsc:0x123',
    'binance:btcusdt',
    'binance:BTC',
    '',
    'bsc:',
  ])('rejects invalid key %s', (key) => {
    expect(parseSandboxTokenKey(key)).toBeNull();
    expect(sandboxTokenKeySchema.safeParse(key).success).toBe(false);
  });
});

describe('sandbox token contracts', () => {
  it('parses a token row', () => {
    const parsed = sandboxTokenSchema.parse({
      id: '11111111-1111-4111-8111-111111111111',
      tokenKey: bscKey,
      symbol: 'CAKE',
      name: 'PancakeSwap',
      chain: 'bsc',
      contractAddress: '0x1111111111111111111111111111111111111111',
      coingeckoId: 'pancakeswap-token',
      enabled: true,
      createdAt: '2026-11-24T00:00:00.000Z',
      updatedAt: '2026-11-24T00:00:00.000Z',
    });

    expect(parsed.tokenKey).toBe(bscKey);
    expect(parsed.contractAddress).not.toBeNull();
  });

  it('trims create fields and accepts an EVM key without a repeated contract address', () => {
    const parsed = sandboxTokenCreateRequestSchema.parse({
      tokenKey: `  ${bscKey}  `,
      symbol: '  cake ',
      name: ' PancakeSwap ',
      coingeckoId: 'pancakeswap-token',
    });

    expect(parsed).toEqual({
      tokenKey: bscKey,
      symbol: 'cake',
      name: 'PancakeSwap',
      coingeckoId: 'pancakeswap-token',
    });
  });

  it('rejects an EVM contract address that does not match the key', () => {
    expect(
      sandboxTokenCreateRequestSchema.safeParse({
        tokenKey: bscKey,
        symbol: 'CAKE',
        name: 'PancakeSwap',
        contractAddress: '0x2222222222222222222222222222222222222222',
      }).success,
    ).toBe(false);
  });

  it('rejects a contract address on a Binance pair', () => {
    expect(
      sandboxTokenCreateRequestSchema.safeParse({
        tokenKey: 'binance:BTCUSDT',
        symbol: 'BTC',
        name: 'Bitcoin',
        contractAddress: bscKey.slice(4),
      }).success,
    ).toBe(false);
  });

  it.each([{ symbol: '' }, { name: 'x'.repeat(81) }, { coingeckoId: 'Not A Slug' }])(
    'rejects invalid create payload %j',
    (patch) => {
      expect(
        sandboxTokenCreateRequestSchema.safeParse({
          tokenKey: bscKey,
          symbol: 'CAKE',
          name: 'PancakeSwap',
          ...patch,
        }).success,
      ).toBe(false);
    },
  );

  it('requires at least one patch field and rejects an immutable tokenKey', () => {
    expect(sandboxTokenUpdateRequestSchema.safeParse({}).success).toBe(false);

    expect(
      sandboxTokenUpdateRequestSchema.safeParse({
        enabled: false,
        tokenKey: 'ethereum:0x2222222222222222222222222222222222222222',
      }).success,
    ).toBe(false);
    expect(sandboxTokenUpdateRequestSchema.safeParse({ chain: 'ethereum' }).success).toBe(false);
    expect(sandboxTokenUpdateRequestSchema.parse({ enabled: false })).toEqual({ enabled: false });
    expect(sandboxTokenUpdateRequestSchema.parse({ coingeckoId: null })).toEqual({
      coingeckoId: null,
    });
  });
});

describe('sandbox coverage contracts', () => {
  const coverage = {
    tokenKey: bscKey,
    timeframe: '1h',
    available: 4320,
    required: 4320,
    firstOpenTime: '2026-05-28T00:00:00.000Z',
    lastOpenTime: '2026-11-24T00:00:00.000Z',
    gaps: 0,
    synthetic: false,
    stale: false,
    status: 'ok',
    warning: null,
  };

  it('parses a full coverage row', () => {
    expect(sandboxCoverageSchema.parse(coverage)).toEqual(coverage);
  });

  it('rejects negative counts and unknown statuses', () => {
    expect(sandboxCoverageSchema.safeParse({ ...coverage, available: -1 }).success).toBe(false);
    expect(sandboxCoverageSchema.safeParse({ ...coverage, status: 'ready' }).success).toBe(false);
    expect(sandboxCoverageSchema.safeParse({ ...coverage, timeframe: '4h' }).success).toBe(false);
  });

  it('parses coverage responses and the optional token filter', () => {
    expect(sandboxCoverageResponseSchema.parse({ tokens: [coverage] }).tokens).toHaveLength(1);
    expect(sandboxCoverageQuerySchema.parse({})).toEqual({});
    expect(sandboxCoverageQuerySchema.parse({ tokenKey: bscKey })).toEqual({ tokenKey: bscKey });
    expect(sandboxCoverageQuerySchema.safeParse({ tokenKey: 'BTC' }).success).toBe(false);
  });

  it('parses a refresh response', () => {
    expect(
      sandboxTokenRefreshResponseSchema.parse({
        token: {
          id: '11111111-1111-4111-8111-111111111111',
          tokenKey: bscKey,
          symbol: 'CAKE',
          name: 'PancakeSwap',
          chain: 'bsc',
          contractAddress: '0x1111111111111111111111111111111111111111',
          coingeckoId: null,
          enabled: true,
          createdAt: '2026-11-24T00:00:00.000Z',
          updatedAt: '2026-11-24T00:00:00.000Z',
        },
        coverage,
        fetched: 4320,
      }).fetched,
    ).toBe(4320);
  });
});

const runSettings = {
  timeframe: '1h' as const,
  maxPositions: 5,
  maxTokenExposurePct: 20,
  maxStrategyExposurePct: 40,
  cashBufferPct: 10,
  dailyLossLimitPct: 2,
  maxDrawdownPct: 15,
  perTradeRiskPct: 1,
  minOrderUsd: '10',
  liquidityCapPct: 1,
  defaultStopPct: 3,
  regime: {
    fastHours: 24,
    slowHours: 168,
    longHours: 720,
    atrPeriod: 14,
    rangeWindowHours: 72,
    liquidityWindowHours: 24,
    trendSpreadPct: 0.5,
    trendMaxAtrPct: 8,
    rangeSpreadPct: 0.75,
    rangeMaxAtrPct: 3.5,
    crashDrawdownPct: 12,
    crashAtrPct: 10,
    recoveryConfirmBars: 3,
    regimeDwellBars: 3,
    minLiquidityUsd: '50000',
  },
  strategies: {
    trendPullback: {
      fastPeriod: 24,
      slowPeriod: 168,
      pullbackPct: 2,
      atrStopMult: 2.5,
      trailActivationPct: 5,
      trailPct: 5,
    },
    rangeReversion: { lookback: 72, bandAtrMult: 1.5, stopAtrMult: 2 },
    recovery: { fastPeriod: 24, confirmBars: 3, stopPct: 3, riskWeight: 0.5 },
  },
};

const runPaper = {
  feeBps: 25,
  slippageBps: 10,
  liquidityCapPct: 1,
  maxPendingBars: 1,
  cooldownHoursAfterStop: 24,
  counterfactualHorizonHours: 24,
};

const runConfig = {
  tokenKeys: [bscKey],
  seed: 1,
  settings: runSettings,
  paper: runPaper,
};

describe('sandbox run contracts', () => {
  it('parses a frozen run config', () => {
    expect(sandboxRunConfigSchema.parse(runConfig)).toEqual(runConfig);
    expect(
      sandboxRunConfigSchema.safeParse({ ...runConfig, settings: { timeframe: '4h' } }).success,
    ).toBe(false);
    expect(
      sandboxRunConfigSchema.safeParse({ ...runConfig, tokenKeys: [bscKey, bscKey] }).success,
    ).toBe(false);
  });

  it('validates draft create/update requests and unique tokens', () => {
    const create = {
      name: 'My sandbox',
      initialCapitalUsd: '1000',
      tokenKeys: [bscKey],
      settings: runSettings,
      paper: runPaper,
    };
    expect(sandboxRunCreateRequestSchema.parse(create)).toEqual(create);
    expect(
      sandboxRunCreateRequestSchema.safeParse({ ...create, tokenKeys: [bscKey, bscKey] }).success,
    ).toBe(false);
    expect(
      sandboxRunCreateRequestSchema.safeParse({ ...create, initialCapitalUsd: '0' }).success,
    ).toBe(false);
    expect(sandboxRunUpdateRequestSchema.parse({ name: 'Renamed' })).toEqual({ name: 'Renamed' });
    expect(sandboxRunUpdateRequestSchema.safeParse({}).success).toBe(false);
  });

  it('defaults an empty start confirmation and parses a run', () => {
    expect(sandboxRunStartRequestSchema.parse(undefined)).toEqual({});
    expect(sandboxRunStartRequestSchema.parse({ allowPartial: true })).toEqual({
      allowPartial: true,
    });

    const run = {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'My sandbox',
      status: 'running',
      initialCapitalUsd: '1000.00',
      cashUsd: '1000.00',
      equityUsd: '1000.00',
      peakEquityUsd: '1000.00',
      dayStartEquityUsd: '1000.00',
      tokenKeys: [bscKey],
      tokens: [
        {
          tokenKey: bscKey,
          symbol: 'CAKE',
          chain: 'bsc',
          contractAddress: '0x1111111111111111111111111111111111111111',
          enabled: true,
        },
      ],
      settings: runSettings,
      paper: runPaper,
      lastBarClose: null,
      lastTickAt: null,
      error: null,
      createdAt: '2026-11-24T00:00:00.000Z',
      updatedAt: '2026-11-24T00:00:00.000Z',
      startedAt: '2026-11-24T00:00:00.000Z',
      pausedAt: null,
      stoppedAt: null,
      archivedAt: null,
    };
    expect(sandboxRunSchema.parse(run).status).toBe('running');
  });
});

const runId = '11111111-1111-4111-8111-111111111111';
const hash = 'a'.repeat(64);

const runSummary = {
  id: runId,
  name: 'My sandbox',
  status: 'running',
  initialCapitalUsd: '1000.00',
  cashUsd: '799.50',
  equityUsd: '857.85',
  peakEquityUsd: '1000.00',
  returnPct: '-14.22',
  drawdownPct: '14.2150',
  tokenCount: 1,
  lastBarClose: '2026-11-24T00:00:00.000Z',
  lastTickAt: '2026-11-24T00:00:05.000Z',
  startedAt: '2026-11-24T00:00:00.000Z',
  stoppedAt: null,
  archivedAt: null,
  error: null,
  createdAt: '2026-11-24T00:00:00.000Z',
  updatedAt: '2026-11-24T00:00:05.000Z',
};

const position = {
  tokenId: bscKey,
  strategyKey: 'trend_pullback',
  strategyVersion: 1,
  amount: '1.99500000',
  avgCostUsd: '100.25000000',
  costBasisUsd: '200.00',
  marketPriceUsd: '105.00000000',
  marketValueUsd: '209.48',
  openedAt: '2026-11-24T00:00:00.000Z',
  stopLossPct: '3.0000',
  takeProfitPct: null,
  entryIntentId: 'intent-1',
  feesPaidUsd: '0.50',
  updatedAt: '2026-11-24T00:00:05.000Z',
};

const trade = {
  tradeId: 'trade-1',
  tokenId: bscKey,
  strategyKey: 'trend_pullback',
  strategyVersion: 1,
  entryAt: '2026-11-24T00:00:00.000Z',
  entryPriceUsd: '100.00000000',
  entryAmount: '1.99500000',
  entryNotionalUsd: '199.50',
  entryFeeUsd: '0.50',
  entryCostBasisUsd: '200.00',
  entryIntentId: 'intent-1',
  exitAt: null,
  exitPriceUsd: null,
  exitAmount: '0.00000000',
  exitNotionalUsd: '0.00',
  exitFeeUsd: '0.00',
  exitReasonCode: null,
  exitIntentId: null,
  realizedPnlUsd: '0.00',
  status: 'open',
  updatedAt: '2026-11-24T00:00:05.000Z',
};

const intent = {
  intentId: 'intent-1',
  tokenId: bscKey,
  side: 'buy',
  strategyKey: 'trend_pullback',
  strategyVersion: 1,
  status: 'filled',
  requestedUsd: '200.00',
  requestedAmount: null,
  filledUsd: '199.50',
  filledAmount: '1.99500000',
  priceUsd: '100.00000000',
  stopLossPct: '3.0000',
  takeProfitPct: null,
  feeUsd: '0.50',
  reasonCode: 'FILL_FILLED',
  strategyReasonCode: 'TREND_PULLBACK_ENTRY',
  reasonText: 'filled',
  decisionTime: '2026-11-24T00:00:00.000Z',
  fillTime: '2026-11-24T00:00:00.000Z',
};

describe('sandbox read contracts', () => {
  it('parses run summaries and detail counts', () => {
    expect(sandboxRunSummarySchema.parse(runSummary)).toMatchObject({ id: runId });
    const detail = sandboxRunDetailSchema.parse({
      ...runSummary,
      dayStartEquityUsd: '1000.00',
      tokenKeys: [bscKey],
      tokens: [
        {
          tokenKey: bscKey,
          symbol: 'CAKE',
          chain: 'bsc',
          contractAddress: bscKey.slice(4),
          enabled: true,
        },
      ],
      settings: runSettings,
      paper: runPaper,
      pausedAt: null,
      executionMode: 'live-paper',
      openPositions: 1,
      openTrades: 1,
      closedTrades: 0,
      intents: 1,
      pendingIntents: 0,
      equityPoints: 1,
      ledgerEntries: 1,
      eventCount: 2,
      eventHash: hash,
    });
    expect(detail.executionMode).toBe('live-paper');
    expect(detail.eventCount).toBe(2);
  });

  it('parses position, trade, intent, events and equity responses', () => {
    expect(sandboxPositionSchema.parse(position).tokenId).toBe(bscKey);
    expect(sandboxTradeSchema.parse(trade).status).toBe('open');
    expect(sandboxIntentSchema.parse(intent).status).toBe('filled');

    const events = sandboxEventsResponseSchema.parse({
      events: [
        {
          seq: 0,
          clockTime: '2026-11-24T00:00:00.000Z',
          module: 'run',
          eventType: 'run.started',
          severity: 'info',
          tokenId: null,
          strategyId: null,
          regime: null,
          decision: null,
          alternatives: [],
          riskChecks: [],
          dataSnapshotId: 'snapshot-1',
          configVersion: 'config-1',
          seed: 1,
          correlationId: null,
          reasonCode: null,
          reasonText: null,
          recordedAt: '2026-11-24T00:00:00.000Z',
          prevHash: '0'.repeat(64),
          hash,
        },
      ],
      hasMore: false,
      nextAfterSeq: 0,
    });
    expect(events.events).toHaveLength(1);

    const equity = sandboxEquityResponseSchema.parse({
      points: [
        {
          clockTime: '2026-11-24T00:00:00.000Z',
          equityUsd: '857.85',
          cashUsd: '799.50',
          positionsValueUsd: '58.35',
          drawdownPct: '14.2150',
        },
      ],
      total: 1,
      limit: 500,
      offset: 0,
    });
    expect(equity.points[0]?.drawdownPct).toBe('14.2150');
  });

  it('applies query defaults and rejects out-of-bounds pagination', () => {
    expect(sandboxRunsQuerySchema.parse({})).toEqual({
      includeArchived: false,
      limit: 50,
      offset: 0,
    });
    expect(
      sandboxRunsQuerySchema.parse({ includeArchived: 'true', status: 'failed' }),
    ).toMatchObject({ includeArchived: true, status: 'failed' });
    expect(sandboxRunsQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(sandboxPageQuerySchema.parse({})).toEqual({ limit: 100, offset: 0 });
    expect(sandboxPageQuerySchema.safeParse({ offset: -1 }).success).toBe(false);
    expect(sandboxEquityQuerySchema.parse({})).toEqual({ limit: 500, offset: 0 });
    expect(sandboxEventsQuerySchema.parse({})).toEqual({ limit: 200 });
    expect(sandboxEventsQuerySchema.parse({ afterSeq: '10', limit: '50' })).toEqual({
      afterSeq: 10,
      limit: 50,
    });
    expect(sandboxEventsQuerySchema.safeParse({ limit: 1_001 }).success).toBe(false);
  });

  it('parses the overview and paginated run list', () => {
    const overview = sandboxOverviewSchema.parse({
      enabled: true,
      executionMode: 'live-paper',
      runs: {
        total: 1,
        draft: 0,
        running: 1,
        paused: 0,
        stopped: 0,
        failed: 0,
        archived: 0,
      },
      activeRuns: [runSummary],
      lastTickAt: '2026-11-24T00:00:05.000Z',
      universe: {
        tokens: 1,
        enabledTokens: 1,
        staleTokens: [],
        lastCandleAt: '2026-11-24T00:00:00.000Z',
      },
    });
    expect(overview.activeRuns).toHaveLength(1);

    const listed = sandboxRunsResponseSchema.parse({
      runs: [runSummary],
      total: 1,
      limit: 50,
      offset: 0,
    });
    expect(listed.runs[0]?.returnPct).toBe('-14.22');
  });

  it('parses a live-paper report wrapper and rejects a bad hash', () => {
    const report = {
      paperVersion: 'paper-run-v1',
      runId,
      seed: 1,
      configVersion: 'config-1',
      dataSnapshotId: 'snapshot-1',
      settingsVersion: 'settings-1',
      config: {
        runId,
        seed: 1,
        timeframe: '1h',
        tokenIds: [bscKey],
        initialCapitalUsd: '1000.00',
        feeBps: 25,
        slippageBps: 10,
        liquidityCapPct: 1,
        maxPendingBars: 1,
        cooldownHoursAfterStop: 24,
        counterfactualHorizonHours: 24,
      },
      period: {
        firstBar: 1_764_000_000_000,
        lastBar: 1_764_003_600_000,
        bars: 1,
        tokens: [bscKey],
      },
      metrics: {
        initialCapitalUsd: '1000.00',
        finalEquityUsd: '857.85',
        totalReturnPct: '-14.22',
        maxDrawdownPct: '14.22',
        peakEquityUsd: '1000.00',
        finalCashUsd: '799.50',
        finalPositionsValueUsd: '58.35',
        realizedPnlUsd: '0.00',
        unrealizedPnlUsd: '58.35',
        feesPaidUsd: '0.50',
        tradeCount: 0,
        wins: 0,
        losses: 0,
        winRatePct: null,
        profitFactor: null,
        averageWinUsd: null,
        averageLossUsd: null,
        timeInMarketPct: '0.00',
        averageExposurePct: '5.84',
        perStrategy: [],
        perToken: [],
      },
      equityCurve: [
        {
          clockTime: 1_764_000_000_000,
          equityUsd: '857.85',
          cashUsd: '799.50',
          positionsValueUsd: '58.35',
          drawdownPct: '14.22',
        },
      ],
      positions: [
        {
          tokenId: bscKey,
          strategyKey: 'trend_pullback',
          strategyVersion: 1,
          amount: '1.99500000',
          avgCostUsd: '100.25000000',
          marketPriceUsd: '105.00000000',
          marketValueUsd: '209.48',
          openedAt: 1_764_000_000_000,
          stopLossPct: '3.0000',
          takeProfitPct: null,
        },
      ],
      trades: [],
      intentJournal: [
        {
          intentId: 'intent-1',
          tokenId: bscKey,
          side: 'buy',
          strategyKey: 'trend_pullback',
          strategyVersion: 1,
          status: 'filled',
          requestedUsd: '200.00',
          requestedAmount: null,
          filledUsd: '199.50',
          filledAmount: '1.99500000',
          priceUsd: '100.00000000',
          feeUsd: '0.50',
          reasonCode: 'FILL_FILLED',
          strategyReasonCode: 'TREND_PULLBACK_ENTRY',
          reasonText: 'filled',
          decisionTime: 1_764_000_000_000,
          fillTime: 1_764_000_000_000,
        },
      ],
      counterfactuals: [],
      eventCount: 2,
      eventHash: hash,
      ledgerEntries: 1,
      reconciliationOk: true,
      reconciliationChecks: ['cash identity'],
      reportHash: hash,
    };

    const parsed = sandboxReportResponseSchema.parse({
      executionMode: 'live-paper',
      report,
      pendingIntents: 1,
      notes: ['pending intents are excluded', 'counterfactuals are omitted'],
    });
    expect(parsed.executionMode).toBe('live-paper');
    expect(parsed.report.reportHash).toBe(hash);
    expect(parsed.pendingIntents).toBe(1);
    expect(parsed.notes).toHaveLength(2);

    const bad = sandboxReportResponseSchema.safeParse({
      executionMode: 'live-paper',
      report: { ...report, reportHash: 'not-a-hash' },
      pendingIntents: 0,
      notes: [],
    });
    expect(bad.success).toBe(false);
  });
});

describe('sandbox historical replay contracts', () => {
  const fromTime = '2025-12-11T00:00:00.000Z';
  const toTime = '2026-01-10T00:00:00.000Z';
  const createdAt = '2026-01-10T00:01:00.000Z';
  const hash = 'a'.repeat(64);

  const summary = {
    id: '11111111-1111-4111-8111-111111111111',
    name: '30 дней',
    status: 'queued',
    tokenKeys: [bscKey],
    periodDays: 30,
    fromTime,
    toTime,
    initialCapitalUsd: '1000.00',
    finalEquityUsd: null,
    returnPct: null,
    maxDrawdownPct: null,
    reportHash: null,
    error: null,
    queuedAt: createdAt,
    startedAt: null,
    finishedAt: null,
    archivedAt: null,
    createdAt,
    updatedAt: createdAt,
  };

  it('accepts only the replay statuses and periods', () => {
    for (const status of ['queued', 'running', 'completed', 'failed', 'cancelled']) {
      expect(sandboxReplayStatusSchema.parse(status)).toBe(status);
    }
    expect(sandboxReplayStatusSchema.safeParse('archived').success).toBe(false);

    for (const period of [30, 90, 180]) {
      expect(sandboxReplayPeriodSchema.parse(period)).toBe(period);
    }
    expect(sandboxReplayPeriodSchema.safeParse(60).success).toBe(false);
    expect(sandboxReplayPeriodSchema.safeParse('30').success).toBe(false);
  });

  it('validates the create request and defaults allowPartial', () => {
    const parsed = sandboxReplayCreateRequestSchema.parse({
      name: 'Первый прогон',
      tokenKeys: [bscKey],
      periodDays: 90,
      initialCapitalUsd: '1000.00',
    });
    expect(parsed).toEqual({
      name: 'Первый прогон',
      tokenKeys: [bscKey],
      periodDays: 90,
      initialCapitalUsd: '1000.00',
      allowPartial: false,
    });

    expect(
      sandboxReplayCreateRequestSchema.safeParse({
        name: 'Прогон',
        tokenKeys: [bscKey],
        periodDays: 60,
        initialCapitalUsd: '1000.00',
      }).success,
    ).toBe(false);
    expect(
      sandboxReplayCreateRequestSchema.safeParse({
        name: 'Прогон',
        tokenKeys: [bscKey, bscKey, bscKey, bscKey],
        periodDays: 30,
        initialCapitalUsd: '1000.00',
      }).success,
    ).toBe(false);
    expect(
      sandboxReplayCreateRequestSchema.safeParse({
        name: 'Прогон',
        tokenKeys: [],
        periodDays: 30,
        initialCapitalUsd: '1000.00',
      }).success,
    ).toBe(false);
    expect(
      sandboxReplayCreateRequestSchema.safeParse({
        name: 'Прогон',
        tokenKeys: [bscKey],
        periodDays: 30,
        initialCapitalUsd: '0',
      }).success,
    ).toBe(false);
    expect(
      sandboxReplayCreateRequestSchema.safeParse({
        name: 'Прогон',
        tokenKeys: ['solana:0x1111111111111111111111111111111111111111'],
        periodDays: 30,
        initialCapitalUsd: '1000.00',
      }).success,
    ).toBe(false);
    expect(
      sandboxReplayCreateRequestSchema.safeParse({
        name: 'Прогон',
        tokenKeys: [bscKey],
        periodDays: 30,
        initialCapitalUsd: '1000.00',
        unexpected: true,
      }).success,
    ).toBe(false);
  });

  it('validates the preflight request and coverage payload', () => {
    expect(
      sandboxReplayPreflightRequestSchema.parse({
        tokenKeys: [bscKey],
        periodDays: 30,
      }),
    ).toEqual({ tokenKeys: [bscKey], periodDays: 30, allowPartial: false });

    const coverage = {
      tokenKey: bscKey,
      fromTime,
      toTime,
      available: 700,
      required: 720,
      prefixBars: 100,
      gaps: 20,
      synthetic: false,
      stale: false,
      status: 'partial',
      warning: 'Доступно 700 из 720 часовых свечей.',
    };
    expect(sandboxReplayCoverageSchema.parse(coverage)).toEqual(coverage);

    const preflight = {
      fromTime,
      toTime,
      status: 'partial',
      warnings: ['Доступно 700 из 720 часовых свечей.'],
      coverage: [coverage],
    };
    expect(sandboxReplayPreflightResponseSchema.parse(preflight)).toEqual(preflight);
  });

  it('parses the list query, summary, detail and list response', () => {
    expect(sandboxReplayListQuerySchema.parse({})).toEqual({
      includeArchived: false,
      limit: 50,
      offset: 0,
    });
    expect(
      sandboxReplayListQuerySchema.parse({
        status: 'completed',
        includeArchived: 'true',
        limit: '10',
        offset: '20',
      }),
    ).toEqual({
      status: 'completed',
      includeArchived: true,
      limit: 10,
      offset: 20,
    });

    const parsed = sandboxReplaySummarySchema.parse(summary);
    expect(parsed.status).toBe('queued');
    expect(parsed.finalEquityUsd).toBeNull();

    const detail = sandboxReplayDetailSchema.parse({
      ...summary,
      settings: {
        timeframe: '1h',
        maxPositions: 3,
        maxTokenExposurePct: 40,
        maxStrategyExposurePct: 40,
        cashBufferPct: 20,
        dailyLossLimitPct: 5,
        maxDrawdownPct: 25,
        perTradeRiskPct: 2,
        minOrderUsd: '10.00',
        liquidityCapPct: 25,
        defaultStopPct: 8,
        regime: {
          fastHours: 6,
          slowHours: 24,
          longHours: 72,
          atrPeriod: 14,
          rangeWindowHours: 24,
          liquidityWindowHours: 24,
          trendSpreadPct: 1,
          trendMaxAtrPct: 5,
          rangeSpreadPct: 1,
          rangeMaxAtrPct: 4,
          crashDrawdownPct: 12,
          crashAtrPct: 3,
          recoveryConfirmBars: 3,
          regimeDwellBars: 2,
          minLiquidityUsd: '25000.00',
        },
        strategies: {
          trendPullback: {
            fastPeriod: 9,
            slowPeriod: 21,
            pullbackPct: 1,
            atrStopMult: 2,
            trailActivationPct: 4,
            trailPct: 2,
          },
          rangeReversion: { lookback: 24, bandAtrMult: 2, stopAtrMult: 2 },
          recovery: { fastPeriod: 9, confirmBars: 3, stopPct: 5, riskWeight: 0.5 },
        },
      },
      paper: {
        feeBps: 25,
        slippageBps: 10,
        liquidityCapPct: 25,
        maxPendingBars: 2,
        cooldownHoursAfterStop: 24,
        counterfactualHorizonHours: 24,
      },
      seed: 7,
      eventCount: 10,
      eventHash: hash,
      dataSnapshotId: 'snap-1',
      candleSnapshotHash: hash,
    });
    expect(detail.seed).toBe(7);
    expect(detail.eventHash).toBe(hash);

    const list = sandboxReplayListResponseSchema.parse({
      replays: [summary],
      total: 1,
      limit: 50,
      offset: 0,
    });
    expect(list.replays).toHaveLength(1);

    expect(
      sandboxReplaySummarySchema.safeParse({ ...summary, reportHash: 'not-a-hash' }).success,
    ).toBe(false);
    expect(sandboxReplaySummarySchema.safeParse({ ...summary, status: 'archived' }).success).toBe(
      false,
    );
  });

  it('labels the replay report as historical paper', () => {
    expect(SANDBOX_HISTORICAL_EXECUTION_MODE).toBe('historical-paper');
    expect(
      sandboxReplayReportResponseSchema.safeParse({
        executionMode: 'live-paper',
        report: null,
        notes: [],
      }).success,
    ).toBe(false);
  });
});
