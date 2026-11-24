import type { Candle, Timestamp } from '../../types';
import type { ReasonCode } from '../reason-codes';
import type {
  PortfolioPosition,
  Regime,
  SignalAction,
  StrategyKey,
  StrategySettings,
} from '../types';
import { rangeReversionStrategy } from './range-reversion';
import { recoveryStrategy } from './recovery';
import { trendPullbackStrategy } from './trend-pullback';

export { rangeReversionStrategy, recoveryStrategy, trendPullbackStrategy };

/**
 * Single source of truth for the strategy registry keys, sorted by UTF-16 code
 * unit. The decision engine validates positions against this list, so adding a
 * strategy only requires updating the registry and this list together; the
 * `STRATEGY_KEYS` sync test fails if they drift.
 */
export const STRATEGY_KEYS: readonly StrategyKey[] = Object.freeze([
  'range_reversion',
  'recovery',
  'trend_pullback',
]);

/** Everything a strategy may read for one token bar. */
export interface StrategyContext {
  readonly now: Timestamp;
  readonly tokenId: string;
  readonly timeframe: string;
  readonly regime: Regime;
  readonly candles: readonly Candle[];
  readonly position: PortfolioPosition | null;
  readonly state: Readonly<Record<string, unknown>>;
}

/** A strategy decision plus the memory the engine persists for the next bar. */
export interface StrategySignal {
  readonly action: SignalAction;
  readonly reasonCode: ReasonCode;
  readonly reasonText: string;
  readonly confidence: number;
  readonly riskWeight: number;
  readonly stopLossPct: string | null;
  readonly takeProfitPct: string | null;
  readonly nextState: Readonly<Record<string, unknown>>;
}

/** Typed strategy definition; `P` is the strategy's parameter object. */
export interface StrategyDefinition<P extends object> {
  readonly key: StrategyKey;
  readonly version: number;
  readonly eligibleRegimes: readonly Regime[];
  readonly defaultParams: P;
  evaluate(ctx: StrategyContext, params: P): StrategySignal;
}

/** A definition with its params bound, so the engine can call `evaluate(ctx)`. */
export interface StrategyRuntime {
  readonly key: StrategyKey;
  readonly version: number;
  readonly eligibleRegimes: readonly Regime[];
  evaluate(ctx: StrategyContext): StrategySignal;
}

function bind<P extends object>(definition: StrategyDefinition<P>, params: P): StrategyRuntime {
  return {
    key: definition.key,
    version: definition.version,
    eligibleRegimes: definition.eligibleRegimes,
    evaluate: (ctx: StrategyContext): StrategySignal => definition.evaluate(ctx, params),
  };
}

/**
 * Builds the three runtimes once per decision cycle, closing over the typed
 * params so callers never pass `unknown` parameters through the engine.
 */
export function createStrategySet(
  settings: StrategySettings,
): Readonly<Record<StrategyKey, StrategyRuntime>> {
  return {
    trend_pullback: bind(trendPullbackStrategy, settings.trendPullback),
    range_reversion: bind(rangeReversionStrategy, settings.rangeReversion),
    recovery: bind(recoveryStrategy, settings.recovery),
  };
}

/** Maps a regime to the single strategy allowed to act in it. */
export function eligibleStrategyFor(regime: Regime): StrategyKey | null {
  switch (regime) {
    case 'TREND_UP':
      return 'trend_pullback';
    case 'RANGE':
      return 'range_reversion';
    case 'RECOVERY':
      return 'recovery';
    case 'TREND_DOWN':
    case 'CRASH':
    case 'ILLIQUID':
    case 'UNKNOWN':
      return null;
  }
}
