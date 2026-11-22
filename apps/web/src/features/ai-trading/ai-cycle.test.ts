import { describe, expect, it } from 'vitest';
import {
  aiCycleLimitDefaults,
  aiCycleRequestSchema,
  aiCycleStatusSchema,
  aiCycleStepKeys,
  aiCycleStepSchema,
  aiCyclesQuerySchema,
  aiCyclesResponseSchema,
  aiRecommendationSchema,
  aiSearchFunnelStageLabels,
  aiSearchNearMissSchema,
  readAiCycleLimit,
  updateAiSettingsRequestSchema,
  withAiCycleLimit,
} from '@nexter/contracts';

describe('AI cycle contracts', () => {
  it('applies defaults and validates limits', () => {
    const parsed = aiCycleRequestSchema.parse({
      assetId: '11111111-1111-4111-8111-111111111111',
      variants: 5000,
    });
    expect(parsed.timeframe).toBe('1h');
    expect(parsed.horizonDays).toBe(5);
    expect(parsed.maxDrafts).toBe(3);
    expect(
      aiCycleRequestSchema.parse({
        assetId: '11111111-1111-4111-8111-111111111111',
        variants: 50000,
      }).variants,
    ).toBe(50000);
    expect(
      aiCycleRequestSchema.parse({
        assetId: '11111111-1111-4111-8111-111111111111',
        variants: 200000,
      }).variants,
    ).toBe(200000);
    expect(() =>
      aiCycleRequestSchema.parse({
        assetId: '11111111-1111-4111-8111-111111111111',
        variants: 200001,
      }),
    ).toThrow();
    expect(() =>
      aiCycleRequestSchema.parse({
        assetId: '11111111-1111-4111-8111-111111111111',
        maxDrafts: 11,
      }),
    ).toThrow();
  });

  it('accepts the four ordered steps and rejects unknown keys', () => {
    const status = aiCycleStatusSchema.parse({
      cycleId: '11111111-1111-4111-8111-111111111111',
      status: 'running',
      steps: aiCycleStepKeys.map((key) => ({
        key,
        status: 'queued',
        message: null,
        error: null,
        startedAt: null,
        finishedAt: null,
      })),
      searchRunId: null,
      recommended: 0,
      draftsCreated: 0,
      error: null,
      createdAt: '2026-11-21T00:00:00.000Z',
      finishedAt: null,
    });
    expect(status.steps.map((step) => step.key)).toEqual([
      'data',
      'search',
      'recommendations',
      'drafts',
    ]);
    expect(status.steps[0]?.progressPct).toBeNull();
    const withProgress = aiCycleStatusSchema.parse({
      ...status,
      steps: status.steps.map((step, index) => ({ ...step, progressPct: index === 0 ? 42 : null })),
    });
    expect(withProgress.steps[0]?.progressPct).toBe(42);
    expect(() =>
      aiCycleStatusSchema.parse({
        ...status,
        steps: [{ ...status.steps[0], key: 'unknown' }],
      }),
    ).toThrow();
  });

  it('validates finite and unlimited cycle limit settings', () => {
    expect(
      updateAiSettingsRequestSchema.parse({ cycleLimit: { perDay: 5, unlimited: false } }),
    ).toEqual({ cycleLimit: { perDay: 5, unlimited: false } });
    expect(
      updateAiSettingsRequestSchema.parse({ cycleLimit: { perDay: 5, unlimited: true } }),
    ).toEqual({ cycleLimit: { perDay: 5, unlimited: true } });
    for (const perDay of [0, 201, 2.5]) {
      expect(() =>
        updateAiSettingsRequestSchema.parse({ cycleLimit: { perDay, unlimited: false } }),
      ).toThrow();
    }

    expect(readAiCycleLimit(null)).toEqual(aiCycleLimitDefaults);
    expect(readAiCycleLimit({ cycleLimit: { perDay: 8, unlimited: true } })).toEqual({
      perDay: 8,
      unlimited: true,
    });
    expect(readAiCycleLimit({ cycleLimit: { perDay: -1, unlimited: false } })).toEqual(
      aiCycleLimitDefaults,
    );
    expect(
      withAiCycleLimit({ model: 'deepseek-flash' }, { perDay: 8, unlimited: true }),
    ).toMatchObject({
      model: 'deepseek-flash',
      cycleLimit: { perDay: 8, unlimited: true },
    });
  });

  it('uses the shared funnel stage labels and keeps the search stage in cycle steps', () => {
    expect(aiSearchFunnelStageLabels).toEqual({
      screen: 'Сигналы',
      probe: 'Проба',
      budget: 'Бюджет',
      full: 'OOS',
      control: 'Контроль',
      holdout: 'Holdout',
    });

    const searchStep = aiCycleStepSchema.parse({
      key: 'search',
      status: 'running',
      message: 'Сигналы: 10 / 100',
      error: null,
      stage: 'screen',
      startedAt: '2026-11-21T00:00:00.000Z',
      finishedAt: null,
    });
    expect(searchStep.stage).toBe('screen');

    const legacyStep = aiCycleStepSchema.parse({
      key: 'search',
      status: 'succeeded',
      message: null,
      error: null,
      startedAt: '2026-11-21T00:00:00.000Z',
      finishedAt: '2026-11-21T00:01:00.000Z',
    });
    expect(legacyStep.stage).toBeNull();
  });

  it('parses a cycle history response and validates the limit', () => {
    const history = aiCyclesResponseSchema.parse({
      data: [
        {
          cycleId: '11111111-1111-4111-8111-111111111111',
          status: 'succeeded',
          assetId: '22222222-2222-4222-8222-222222222222',
          symbol: 'BASED',
          timeframe: '1h',
          steps: aiCycleStepKeys.map((key) => ({
            key,
            status: 'succeeded',
            message: null,
            error: null,
            startedAt: '2026-11-21T00:00:00.000Z',
            finishedAt: '2026-11-21T00:01:00.000Z',
          })),
          searchRunId: '33333333-3333-4333-8333-333333333333',
          recommended: 2,
          draftsCreated: 1,
          error: null,
          createdAt: '2026-11-21T00:00:00.000Z',
          finishedAt: '2026-11-21T00:05:00.000Z',
        },
      ],
    });
    expect(history.data[0]?.symbol).toBe('BASED');
    expect(history.data[0]?.steps.map((step) => step.key)).toEqual([
      'data',
      'search',
      'recommendations',
      'drafts',
    ]);

    expect(aiCyclesQuerySchema.parse({}).limit).toBe(20);
    expect(aiCyclesQuerySchema.parse({ limit: '5' }).limit).toBe(5);
    expect(() => aiCyclesQuerySchema.parse({ limit: 0 })).toThrow();
    expect(() => aiCyclesQuerySchema.parse({ limit: 51 })).toThrow();
  });

  it('parses holdout block fields and legacy rows without them', () => {
    const nearMiss = aiSearchNearMissSchema.parse({
      strategyKey: 'trend_pullback',
      strategyName: 'Откат в тренде',
      params: {},
      oosMedianReturnPct: '1.00',
      oosMeanReturnPct: '0.50',
      oosWorstReturnPct: '-3.00',
      maxDrawdownPct: '4.00',
      trades: 12,
      positiveFolds: 5,
      stabilityPct: '62.50',
      holdoutReturnPct: '-2.00',
      holdoutDrawdownPct: '5.00',
      policyScore: '1.00',
      reasons: ['holdout recent block negative'],
      holdoutBlockReturnsPct: ['1.00', '-2.00', '-1.00'],
      holdoutBlocksPositive: 1,
      holdoutBlocksNonNegative: 1,
      holdoutBlocksTraded: 2,
      holdoutBlocksTotal: 3,
    });
    expect(nearMiss.holdoutBlocksPositive).toBe(1);
    expect(nearMiss.holdoutBlocksTraded).toBe(2);
    const legacyInput: Record<string, unknown> = { ...nearMiss };
    delete legacyInput.holdoutBlockReturnsPct;
    delete legacyInput.holdoutBlocksPositive;
    delete legacyInput.holdoutBlocksNonNegative;
    delete legacyInput.holdoutBlocksTraded;
    delete legacyInput.holdoutBlocksTotal;
    const legacy = aiSearchNearMissSchema.parse(legacyInput);
    expect(legacy.holdoutBlockReturnsPct).toEqual([]);
    expect(legacy.holdoutBlocksPositive).toBe(0);
    expect(legacy.holdoutBlocksTraded).toBe(0);
    expect(legacy.holdoutBlocksTotal).toBe(0);
  });

  it('keeps holdout blocks on recommendations and defaults legacy rows', () => {
    const recommendation = {
      id: '11111111-1111-4111-8111-111111111111',
      assetId: '22222222-2222-4222-8222-222222222222',
      symbol: 'IRYS',
      name: 'Irys',
      timeframe: '1h',
      status: 'recommended',
      strategyKey: 'trend_pullback',
      strategyName: 'Откат в тренде',
      params: {},
      oosMedianReturnPct: '1.00',
      oosMeanReturnPct: '0.50',
      oosWorstReturnPct: '-3.00',
      maxDrawdownPct: '4.00',
      trades: 12,
      positiveFolds: 5,
      stabilityPct: '62.50',
      holdoutReturnPct: '2.00',
      policyScore: '1.00',
      suggestedAllocationUsd: '100.00',
      invalidationRules: [],
      linkedBotId: null,
      createdAt: '2026-11-21T00:00:00.000Z',
      expiresAt: '2026-11-26T00:00:00.000Z',
      expired: false,
      holdoutBlockReturnsPct: ['1.00', '2.00', '0.50'],
      holdoutBlocksPositive: 3,
      holdoutBlocksNonNegative: 3,
      holdoutBlocksTraded: 3,
      holdoutBlocksTotal: 3,
    };
    const parsed = aiRecommendationSchema.parse(recommendation);
    expect(parsed.holdoutBlocksPositive).toBe(3);
    expect(parsed.holdoutBlocksTraded).toBe(3);
    const legacyInput: Record<string, unknown> = { ...recommendation };
    delete legacyInput.holdoutBlockReturnsPct;
    delete legacyInput.holdoutBlocksPositive;
    delete legacyInput.holdoutBlocksNonNegative;
    delete legacyInput.holdoutBlocksTraded;
    delete legacyInput.holdoutBlocksTotal;
    const legacy = aiRecommendationSchema.parse(legacyInput);
    expect(legacy.holdoutBlockReturnsPct).toEqual([]);
    expect(legacy.holdoutBlocksPositive).toBe(0);
    expect(legacy.holdoutBlocksTraded).toBe(0);
    expect(legacy.holdoutBlocksTotal).toBe(0);
  });
});
