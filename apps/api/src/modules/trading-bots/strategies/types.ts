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
}

export interface StrategyDecision {
  action: 'buy' | 'sell' | 'hold';
  reason: string;
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
  icon: string;
  kind: 'system' | 'custom';
  defaultParams: Record<string, unknown>;
  paramFields: StrategyParamField[];
  parseParams: (value: Record<string, unknown>) => Record<string, unknown>;
  evaluate: (ctx: StrategyContext) => StrategyDecision;
}

export function hold(reason: string): StrategyDecision {
  return { action: 'hold', reason };
}

export function buy(reason: string): StrategyDecision {
  return { action: 'buy', reason };
}

export function sell(reason: string): StrategyDecision {
  return { action: 'sell', reason };
}

export function dec(value: string): Decimal {
  return decimal(value);
}
