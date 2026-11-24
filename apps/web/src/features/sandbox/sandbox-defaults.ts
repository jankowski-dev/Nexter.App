import type { SandboxDecisionSettings, SandboxPaperSettings } from '@nexter/contracts';

/**
 * Approved Stage 1B/1C defaults shown in the run setup form.
 *
 * The engine (`@nexter/sandbox-core`) is the source of truth: the API applies
 * these values when a create request omits `settings`/`paper`, so an untouched
 * form never sends a private copy. The UI mirrors them only to prefill the
 * editable fields and to implement "Сбросить настройки". Stage 2 must not
 * change Stage 1B/1C rules, so this copy is stable by design.
 */
export const SANDBOX_DEFAULT_SETTINGS: SandboxDecisionSettings = {
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

export const SANDBOX_DEFAULT_PAPER_SETTINGS: SandboxPaperSettings = {
  feeBps: 25,
  slippageBps: 10,
  liquidityCapPct: 1,
  maxPendingBars: 1,
  cooldownHoursAfterStop: 24,
  counterfactualHorizonHours: 24,
};

/** Design §3 default initial paper capital. */
export const SANDBOX_DEFAULT_INITIAL_CAPITAL_USD = '1000';

/** Stage 2 decisions run on closed 1h bars only. */
export const SANDBOX_TIMEFRAME_LABEL = '1h';
