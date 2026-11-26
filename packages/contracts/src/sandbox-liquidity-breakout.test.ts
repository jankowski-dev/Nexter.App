import { describe, expect, it } from 'vitest';
import { sandboxDecisionSettingsSchema } from './sandbox';

function settings() {
  return {
    timeframe: '1h',
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
}

describe('sandbox research settings contracts', () => {
  it('keeps legacy settings byte-shape compatible when optional fields are absent', () => {
    const parsed = sandboxDecisionSettingsSchema.parse(settings());

    expect(parsed.regime).not.toHaveProperty('liquidityMode');
    expect(parsed.strategies.trendPullback).not.toHaveProperty('breakout');
  });

  it('accepts execution liquidity and a complete breakout block', () => {
    const input = settings();
    const parsed = sandboxDecisionSettingsSchema.parse({
      ...input,
      regime: { ...input.regime, liquidityMode: 'execution' },
      strategies: {
        ...input.strategies,
        trendPullback: {
          ...input.strategies.trendPullback,
          breakout: {
            enabled: true,
            lookbackHours: 24,
            minVolumeRatio: 1.5,
            maxAtrPct: 12,
          },
        },
      },
    });

    expect(parsed.regime.liquidityMode).toBe('execution');
    expect(parsed.strategies.trendPullback.breakout).toEqual({
      enabled: true,
      lookbackHours: 24,
      minVolumeRatio: 1.5,
      maxAtrPct: 12,
    });
  });

  it('rejects an unknown liquidity mode and an invalid breakout', () => {
    const input = settings();
    expect(
      sandboxDecisionSettingsSchema.safeParse({
        ...input,
        regime: { ...input.regime, liquidityMode: 'off' },
      }).success,
    ).toBe(false);
    expect(
      sandboxDecisionSettingsSchema.safeParse({
        ...input,
        strategies: {
          ...input.strategies,
          trendPullback: {
            ...input.strategies.trendPullback,
            breakout: { enabled: true, lookbackHours: 0, minVolumeRatio: 1, maxAtrPct: 12 },
          },
        },
      }).success,
    ).toBe(false);
  });
});
