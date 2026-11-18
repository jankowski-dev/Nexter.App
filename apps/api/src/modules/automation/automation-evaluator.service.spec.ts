import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AutomationEvaluatorService } from './automation-evaluator.service';

const asset = {
  id: 'asset-1',
  chainId: 'chain-1',
  chainCode: 'bsc',
  symbol: 'BASED',
  name: 'BASED',
  decimals: 18,
  contractAddress: '0x1d28d989f9e3ccb8b15d0cec601734514f958e4d',
  coingeckoId: null,
  logoUrl: null,
  isStablecoin: false,
  isCashEquivalent: false,
  isVerified: true,
};

function rule(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rule-1',
    userId: 'user-1',
    name: 'Test rule',
    kind: 'stop_loss',
    assetId: asset.id,
    tradeGroupId: 'group-1',
    status: 'armed',
    executionMode: 'dry_run',
    params: { stopLossPct: 10 },
    maxOrderUsd: null,
    cooldownMinutes: 60,
    lastTriggeredAt: null,
    triggerCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as never;
}

function runtime(overrides: Record<string, unknown> = {}) {
  return {
    automationEnabled: true,
    automationMode: 'dry_run',
    automationMaxOrderUsd: 250,
    automationMaxDailyUsd: 500,
    automationMaxActionsPerDay: 5,
    automationCooldownMinutes: 60,
    automationDefaultStopLossPct: 10,
    automationDefaultTakeProfitPct: 20,
    automationDefaultTrailingPct: 8,
    automationDefaultBuyDropPct: 10,
    automationDefaultBuyAmountUsd: 100,
    botQuoteMaxAgeSeconds: 300,
    ...overrides,
  } as never;
}

function quote(priceUsd: string) {
  return {
    priceUsd,
    change24hPct: '0',
    change7dPct: null,
    change30dPct: null,
    change1yPct: null,
    marketCapUsd: null,
    source: 'test',
    liquidityUsd: null,
    fetchedAt: new Date(),
    changedAt: new Date(),
  };
}

function group(priceCost = '1', remaining = '100') {
  return {
    group: {
      id: 'group-1',
      asset,
      status: 'open',
      openedAt: new Date().toISOString(),
      closedAt: null,
      buyUsd: '100',
      sellUsd: '0',
      realizedPnlUsd: '0',
      unrealizedPnlUsd: null,
      totalPnlUsd: null,
      priceUpdatedAt: null,
      priceFetchedAt: null,
      priceSource: null,
      gasUsd: '0',
      remainingAmount: remaining,
      costBasisUsd: '100',
      remainingCostBasisUsd: priceCost,
      returnPct: null,
      holdingDays: 1,
      source: 'manual',
      notes: null,
      quality: {},
    },
    legs: [],
    lots: [],
    consumptions: [],
    audit: [],
  } as never;
}

function createEvaluator(options: {
  rule: ReturnType<typeof rule>;
  price: string;
  runtime?: ReturnType<typeof runtime>;
  trade?: ReturnType<typeof group>;
  usage?: { count: number; total: string };
  state?: unknown[];
}) {
  const usageResult = options.usage ?? { count: 0, total: '0' };
  const db = {
    select: () => ({
      from: () => ({
        where: () =>
          Object.assign(Promise.resolve([usageResult]), {
            limit: async () => options.state ?? [],
          }),
      }),
    }),
  };
  const settings = { getRuntime: vi.fn().mockResolvedValue(options.runtime ?? runtime()) };
  const quotes = {
    getQuotes: vi.fn().mockResolvedValue(new Map([[asset.id, quote(options.price)]])),
  };
  const tradeGroups = {
    get: vi.fn().mockResolvedValue(options.trade ?? group()),
  };
  const evaluator = new AutomationEvaluatorService(
    db as never,
    settings as never,
    quotes as never,
    tradeGroups as never,
  );
  return evaluator;
}

describe('AutomationEvaluatorService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('proposes a stop-loss close when the loss exceeds the threshold', async () => {
    const evaluator = createEvaluator({
      rule: rule(),
      price: '0.8',
      trade: group('100', '100'),
    });

    const result = await evaluator.evaluate(rule());

    expect(result.status).toBe('would_execute');
    expect(result.reason).toContain('Стоп-лосс');
    expect(result.amount).toBe('100.000000000000000000');
    expect(result.usdValue).toBe('80.00');
  });

  it('skips a stop-loss while the loss is below the threshold', async () => {
    const evaluator = createEvaluator({
      rule: rule(),
      price: '0.95',
      trade: group('100', '100'),
    });

    const result = await evaluator.evaluate(rule());

    expect(result.status).toBe('skipped');
    expect(result.reason).toContain('не достигла');
  });

  it('proposes a partial take-profit close', async () => {
    const evaluator = createEvaluator({
      rule: rule({ kind: 'take_profit', params: { takeProfitPct: 20, partialPct: 50 } }),
      price: '1.3',
      trade: group('100', '100'),
    });

    const result = await evaluator.evaluate(
      rule({ kind: 'take_profit', params: { takeProfitPct: 20, partialPct: 50 } }),
    );

    expect(result.status).toBe('would_execute');
    expect(result.amount).toBe('50.000000000000000000');
    expect(result.reason).toContain('Тейк-профит');
  });

  it('respects the cooldown', async () => {
    const evaluator = createEvaluator({
      rule: rule({ lastTriggeredAt: new Date() }),
      price: '0.5',
    });

    const result = await evaluator.evaluate(rule({ lastTriggeredAt: new Date() }));

    expect(result.status).toBe('skipped');
    expect(result.reason).toContain('Пауза');
  });

  it('caps an auto-buy by the daily limit', async () => {
    const evaluator = createEvaluator({
      rule: rule({
        kind: 'buy',
        tradeGroupId: null,
        params: { target: 'drop_from_high', dropPct: 10, amountUsd: '400' },
      }),
      price: '0.5',
      usage: { count: 0, total: '400' },
      state: [
        {
          ruleId: 'rule-1',
          highWaterUsd: '1',
          lastActionAt: null,
          metadata: {},
          updatedAt: new Date(),
        },
      ],
    });

    const result = await evaluator.evaluate(
      rule({
        kind: 'buy',
        tradeGroupId: null,
        params: { target: 'drop_from_high', dropPct: 10, amountUsd: '400' },
      }),
    );

    expect(result.status).toBe('would_execute');
    expect(result.usdValue).toBe('100.00');
  });
});
