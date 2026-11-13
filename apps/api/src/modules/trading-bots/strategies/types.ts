import { Decimal, decimal } from '../../../shared/money/decimal';

export interface StrategySample {
  priceUsd: string;
  capturedAt: Date;
}

export interface StrategyPosition {
  amount: string;
  avgCostUsd: string;
  costBasisUsd: string;
}

export type StrategyState = Record<string, unknown>;

export interface StrategyContext {
  now: Date;
  params: Record<string, unknown>;
  priceUsd: string;
  change24hPct: string | null;
  history: StrategySample[];
  position: StrategyPosition | null;
  buyCount: number;
  /** Defaults to true; backtests can disable protective exits. */
  stopLossEnabled?: boolean;
  takeProfitEnabled?: boolean;
  /** Persisted per bot/token or per backtest run. */
  state?: StrategyState;
}

export interface StrategyDecision {
  action: 'buy' | 'sell' | 'hold';
  reason: string;
  nextState?: StrategyState;
}

export interface StrategyParamField {
  key: string;
  label: string;
  hint?: string;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  integer?: boolean;
}

export interface StrategyDefinition {
  key: string;
  version: number;
  name: string;
  description: string;
  guide: string;
  bestFor: string;
  risks: string;
  icon: string;
  kind: 'system' | 'custom';
  defaultParams: Record<string, unknown>;
  paramFields: StrategyParamField[];
  parseParams: (value: Record<string, unknown>) => Record<string, unknown>;
  evaluate: (ctx: StrategyContext) => StrategyDecision;
}

export function hold(reason: string, nextState?: StrategyState): StrategyDecision {
  return nextState ? { action: 'hold', reason, nextState } : { action: 'hold', reason };
}

export function buy(reason: string, nextState?: StrategyState): StrategyDecision {
  return nextState ? { action: 'buy', reason, nextState } : { action: 'buy', reason };
}

export function sell(reason: string, nextState?: StrategyState): StrategyDecision {
  return nextState ? { action: 'sell', reason, nextState } : { action: 'sell', reason };
}

export function dec(value: string): Decimal {
  return decimal(value);
}
