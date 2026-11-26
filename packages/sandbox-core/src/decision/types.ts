import type { MarketView } from '../data/market-view';
import type { Timestamp } from '../types';
import type { ReasonCode } from './reason-codes';

export type Regime =
  'TREND_UP' | 'TREND_DOWN' | 'RANGE' | 'CRASH' | 'RECOVERY' | 'ILLIQUID' | 'UNKNOWN';

export type StrategyKey = 'trend_pullback' | 'range_reversion' | 'recovery';
export type TokenPhase = 'SLEEPING' | 'ARMED' | 'IN_POSITION' | 'COOLDOWN' | 'BLOCKED';
export type SignalAction = 'buy' | 'sell' | 'hold';
export type IntentSide = 'buy' | 'sell';

export interface RegimeFeatures {
  readonly bars: number;
  readonly lastClose: string | null;
  readonly fastSma: string | null;
  readonly slowSma: string | null;
  readonly longSma: string | null;
  readonly atrPct: string | null;
  readonly recentHigh: string | null;
  readonly recentLow: string | null;
  readonly avgVolumeUsd: string | null;
  readonly drawdownPct: string | null;
  readonly staleBars: number;
}

export interface RegimeState {
  readonly regime: Regime;
  readonly reasonCode: ReasonCode;
  readonly candidate: Regime | null;
  readonly candidateBars: number;
  readonly since: Timestamp;
  readonly rulesVersion: string;
  readonly features: RegimeFeatures;
}

export interface PortfolioPosition {
  readonly tokenId: string;
  readonly strategyKey: StrategyKey;
  readonly strategyVersion: number;
  readonly amount: string;
  readonly avgCostUsd: string;
  readonly marketPriceUsd: string;
  readonly marketValueUsd: string;
  readonly openedAt: Timestamp;
  readonly stopLossPct: string | null;
  readonly takeProfitPct: string | null;
}

export interface PortfolioSnapshot {
  readonly equityUsd: string;
  readonly cashUsd: string;
  readonly dayStartEquityUsd: string;
  readonly peakEquityUsd: string;
  readonly positions: readonly PortfolioPosition[];
}

export interface TokenRuntimeState {
  readonly tokenId: string;
  readonly regime: RegimeState;
  readonly phase: TokenPhase;
  readonly cooldownUntil: Timestamp | null;
  readonly strategyState: Readonly<Record<string, unknown>>;
}

export interface EngineState {
  readonly tokens: Readonly<Record<string, TokenRuntimeState>>;
}

export interface OrderIntent {
  readonly intentId: string;
  readonly tokenId: string;
  readonly side: IntentSide;
  readonly strategyKey: StrategyKey;
  readonly strategyVersion: number;
  readonly reasonCode: ReasonCode;
  readonly sizeUsd: string;
  readonly amount: string | null;
  readonly stopLossPct: string | null;
  readonly takeProfitPct: string | null;
  readonly decisionPriceUsd: string;
  readonly clockTime: Timestamp;
}

export interface TokenStateView {
  readonly tokenId: string;
  readonly phase: TokenPhase;
  readonly reasonCode: ReasonCode;
}

export interface DecisionInput {
  readonly runId: string;
  readonly seed: number;
  readonly configVersion: string;
  readonly dataSnapshotId: string;
  readonly clockTime: Timestamp;
  readonly tokenIds: readonly string[];
  readonly market: MarketView;
  readonly portfolio: PortfolioSnapshot;
  readonly state: EngineState;
  readonly settings: SandboxDecisionSettings;
}

export interface DecisionResult {
  readonly clockTime: Timestamp;
  readonly intents: readonly OrderIntent[];
  readonly tokenViews: readonly TokenStateView[];
  readonly state: EngineState;
  readonly eventCount: number;
  readonly eventHash: string;
}

export interface TrendBreakoutParams {
  readonly enabled: boolean;
  readonly lookbackHours: number;
  readonly minVolumeRatio: number;
  readonly maxAtrPct: number;
}

export interface TrendPullbackParams {
  readonly fastPeriod: number;
  readonly slowPeriod: number;
  readonly pullbackPct: number;
  readonly atrStopMult: number;
  readonly trailActivationPct: number;
  readonly trailPct: number;
  /** Optional research breakout fallback; absent means disabled. */
  readonly breakout?: TrendBreakoutParams;
}

export interface RangeReversionParams {
  readonly lookback: number;
  readonly bandAtrMult: number;
  readonly stopAtrMult: number;
}

export interface RecoveryParams {
  readonly fastPeriod: number;
  readonly confirmBars: number;
  readonly stopPct: number;
  readonly riskWeight: number;
}

export interface StrategySettings {
  readonly trendPullback: TrendPullbackParams;
  readonly rangeReversion: RangeReversionParams;
  readonly recovery: RecoveryParams;
}

export interface RegimeSettings {
  readonly fastHours: number;
  readonly slowHours: number;
  readonly longHours: number;
  readonly atrPeriod: number;
  readonly rangeWindowHours: number;
  readonly liquidityWindowHours: number;
  readonly trendSpreadPct: number;
  readonly trendMaxAtrPct: number;
  readonly rangeSpreadPct: number;
  readonly rangeMaxAtrPct: number;
  readonly crashDrawdownPct: number;
  readonly crashAtrPct: number;
  readonly recoveryConfirmBars: number;
  readonly regimeDwellBars: number;
  readonly minLiquidityUsd: string;
  /** Optional research mode; absent means the legacy volume gate. */
  readonly liquidityMode?: 'volume' | 'execution';
}

export interface SandboxDecisionSettings {
  readonly timeframe: string;
  readonly maxPositions: number;
  readonly maxTokenExposurePct: number;
  readonly maxStrategyExposurePct: number;
  readonly cashBufferPct: number;
  readonly dailyLossLimitPct: number;
  readonly maxDrawdownPct: number;
  readonly perTradeRiskPct: number;
  readonly minOrderUsd: string;
  readonly liquidityCapPct: number;
  readonly defaultStopPct: number;
  readonly regime: RegimeSettings;
  readonly strategies: StrategySettings;
}
