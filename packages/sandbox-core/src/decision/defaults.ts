import { sha256Hex, stableStringify } from '../util/hash';
import type {
  EngineState,
  RegimeSettings,
  SandboxDecisionSettings,
  StrategySettings,
} from './types';

export const DECISION_ENGINE_VERSION = 'decision-engine-v1';
export const REGIME_RULES_VERSION = 'regime-rules-v1';

export const DEFAULT_STRATEGY_SETTINGS: StrategySettings = {
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
};

export const DEFAULT_REGIME_SETTINGS: RegimeSettings = {
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
};

export const DEFAULT_SETTINGS: SandboxDecisionSettings = {
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
};

export function settingsVersion(settings: SandboxDecisionSettings): string {
  return sha256Hex(stableStringify(settings));
}

export const EMPTY_ENGINE_STATE: EngineState = { tokens: {} };
