import { describe, expect, it } from 'vitest';
import {
  DECISION_ENGINE_VERSION,
  DEFAULT_REGIME_SETTINGS,
  DEFAULT_SETTINGS,
  DEFAULT_STRATEGY_SETTINGS,
  EMPTY_ENGINE_STATE,
  REGIME_RULES_VERSION,
  settingsVersion,
} from './defaults';
import type { SandboxDecisionSettings } from './types';

function cloneSettings(): SandboxDecisionSettings {
  return structuredClone(DEFAULT_SETTINGS);
}

describe('approved sandbox defaults', () => {
  it('matches the Stage 1B design table exactly', () => {
    expect(DEFAULT_SETTINGS).toEqual({
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
      regime: DEFAULT_REGIME_SETTINGS,
      strategies: DEFAULT_STRATEGY_SETTINGS,
    });
  });

  it('pins the regime settings', () => {
    expect(DEFAULT_REGIME_SETTINGS).toEqual({
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
    });
  });

  it('pins the strategy settings', () => {
    expect(DEFAULT_STRATEGY_SETTINGS).toEqual({
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
    });
  });

  it('exposes the engine and rules versions and an empty state', () => {
    expect(DECISION_ENGINE_VERSION).toBe('decision-engine-v1');
    expect(REGIME_RULES_VERSION).toBe('regime-rules-v1');
    expect(EMPTY_ENGINE_STATE).toEqual({ tokens: {} });
  });
});

describe('settingsVersion', () => {
  it('keeps the frozen Stage 1B default hash stable for existing replays', () => {
    // APR replay 933da2de-… stores this exact settingsVersion. Optional
    // research fields must not be injected into the default object.
    expect(settingsVersion(DEFAULT_SETTINGS)).toBe(
      'cc3d30cf416f7fac9a96b96d40868050cce7e68cb300f47d17fc92b789f1a26c',
    );
  });

  it('is a stable sha256 hex string across calls', () => {
    const settings = cloneSettings();
    const first = settingsVersion(settings);
    const second = settingsVersion(settings);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toBe(first);
  });

  it('changes when a single setting changes', () => {
    const settings = cloneSettings();
    const baseline = settingsVersion(settings);
    const changed: SandboxDecisionSettings = { ...settings, maxPositions: 4 };
    expect(settingsVersion(changed)).not.toBe(baseline);

    const nested: SandboxDecisionSettings = {
      ...settings,
      regime: { ...settings.regime, atrPeriod: 15 },
    };
    expect(settingsVersion(nested)).not.toBe(baseline);
  });

  it('does not depend on key insertion order', () => {
    const settings = cloneSettings();
    // Rebuild every level with a deliberately different insertion order.
    const reordered: SandboxDecisionSettings = {
      strategies: {
        recovery: {
          riskWeight: settings.strategies.recovery.riskWeight,
          stopPct: settings.strategies.recovery.stopPct,
          confirmBars: settings.strategies.recovery.confirmBars,
          fastPeriod: settings.strategies.recovery.fastPeriod,
        },
        rangeReversion: {
          stopAtrMult: settings.strategies.rangeReversion.stopAtrMult,
          bandAtrMult: settings.strategies.rangeReversion.bandAtrMult,
          lookback: settings.strategies.rangeReversion.lookback,
        },
        trendPullback: {
          trailPct: settings.strategies.trendPullback.trailPct,
          trailActivationPct: settings.strategies.trendPullback.trailActivationPct,
          atrStopMult: settings.strategies.trendPullback.atrStopMult,
          pullbackPct: settings.strategies.trendPullback.pullbackPct,
          slowPeriod: settings.strategies.trendPullback.slowPeriod,
          fastPeriod: settings.strategies.trendPullback.fastPeriod,
        },
      },
      regime: {
        minLiquidityUsd: settings.regime.minLiquidityUsd,
        regimeDwellBars: settings.regime.regimeDwellBars,
        recoveryConfirmBars: settings.regime.recoveryConfirmBars,
        crashAtrPct: settings.regime.crashAtrPct,
        crashDrawdownPct: settings.regime.crashDrawdownPct,
        rangeMaxAtrPct: settings.regime.rangeMaxAtrPct,
        rangeSpreadPct: settings.regime.rangeSpreadPct,
        trendMaxAtrPct: settings.regime.trendMaxAtrPct,
        trendSpreadPct: settings.regime.trendSpreadPct,
        liquidityWindowHours: settings.regime.liquidityWindowHours,
        rangeWindowHours: settings.regime.rangeWindowHours,
        atrPeriod: settings.regime.atrPeriod,
        longHours: settings.regime.longHours,
        slowHours: settings.regime.slowHours,
        fastHours: settings.regime.fastHours,
      },
      defaultStopPct: settings.defaultStopPct,
      liquidityCapPct: settings.liquidityCapPct,
      minOrderUsd: settings.minOrderUsd,
      perTradeRiskPct: settings.perTradeRiskPct,
      maxDrawdownPct: settings.maxDrawdownPct,
      dailyLossLimitPct: settings.dailyLossLimitPct,
      cashBufferPct: settings.cashBufferPct,
      maxStrategyExposurePct: settings.maxStrategyExposurePct,
      maxTokenExposurePct: settings.maxTokenExposurePct,
      maxPositions: settings.maxPositions,
      timeframe: settings.timeframe,
    };
    expect(settingsVersion(reordered)).toBe(settingsVersion(settings));
  });
});
