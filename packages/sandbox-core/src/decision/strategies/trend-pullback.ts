import { DEFAULT_REGIME_SETTINGS, DEFAULT_STRATEGY_SETTINGS } from '../defaults';
import { atrPct, closes, formatPct, formatUsd, numeric, sma } from '../indicators';
import { Reason } from '../reason-codes';
import type { Regime, TrendPullbackParams } from '../types';
import type { StrategyContext, StrategyDefinition, StrategySignal } from './index';

/**
 * Trend pullback: buy a short pullback while the fast SMA still leads the slow
 * SMA inside a TREND_UP regime, then protect with an ATR stop, a trend break
 * and a trailing stop.
 *
 * Strategy settings carry no ATR period, so this strategy pins the regime
 * classifier's default ATR window to keep decisions deterministic. The ATR is
 * only a rule input; stop percentages stay two-decimal strings.
 */
export const TREND_PULLBACK_ATR_PERIOD = DEFAULT_REGIME_SETTINGS.atrPeriod;

const STRATEGY_VERSION = 1;
const CONFIDENCE = 0.6;
const RISK_WEIGHT = 1;
const ELIGIBLE_REGIMES: readonly Regime[] = ['TREND_UP'];

function signal(
  action: StrategySignal['action'],
  reasonCode: StrategySignal['reasonCode'],
  reasonText: string,
  nextState: Readonly<Record<string, unknown>>,
  stopLossPct: string | null = null,
): StrategySignal {
  return {
    action,
    reasonCode,
    reasonText,
    confidence: CONFIDENCE,
    riskWeight: RISK_WEIGHT,
    stopLossPct,
    takeProfitPct: null,
    nextState,
  };
}

export const trendPullbackStrategy: StrategyDefinition<TrendPullbackParams> = {
  key: 'trend_pullback',
  version: STRATEGY_VERSION,
  eligibleRegimes: ELIGIBLE_REGIMES,
  defaultParams: DEFAULT_STRATEGY_SETTINGS.trendPullback,
  evaluate(ctx: StrategyContext, params: TrendPullbackParams): StrategySignal {
    const prices = closes(ctx.candles);
    const close = prices.length > 0 ? (prices[prices.length - 1] as number) : null;
    const fast = sma(prices, params.fastPeriod);
    const slow = sma(prices, params.slowPeriod);
    const atr = atrPct(ctx.candles, TREND_PULLBACK_ATR_PERIOD);

    if (close === null || fast === null || slow === null || atr === null) {
      return signal(
        'hold',
        Reason.STRATEGY_NO_DATA,
        'Trend pullback: insufficient candles for fast SMA, slow SMA or ATR',
        ctx.state,
      );
    }

    const position = ctx.position;
    if (position === null) {
      if (ctx.regime !== 'TREND_UP') {
        return signal(
          'hold',
          Reason.STRATEGY_NOT_ELIGIBLE,
          `Trend pullback is not eligible in the ${ctx.regime} regime`,
          ctx.state,
        );
      }

      const entryLevel = fast * (1 - params.pullbackPct / 100);
      const nextState = { hwm: close, trailActive: false };
      if (fast > slow && close > slow && close <= entryLevel) {
        return signal(
          'buy',
          Reason.TREND_PULLBACK_ENTRY,
          `Trend pullback entry: close ${formatUsd(close)} is at or below ${formatUsd(entryLevel)} while fast SMA ${formatUsd(fast)} leads slow SMA ${formatUsd(slow)}`,
          nextState,
          formatPct(params.atrStopMult * atr),
        );
      }

      return signal(
        'hold',
        Reason.TREND_PULLBACK_HOLD,
        `Trend pullback hold: close ${formatUsd(close)} is above the pullback level ${formatUsd(entryLevel)}`,
        nextState,
      );
    }

    const avgCost = Number(position.avgCostUsd);
    const hwm = Math.max(numeric(ctx.state.hwm) ?? avgCost, close);
    const trailActive =
      ctx.state.trailActive === true || hwm >= avgCost * (1 + params.trailActivationPct / 100);
    const nextState = { hwm, trailActive };
    const stopLevel = avgCost * (1 - (params.atrStopMult * atr) / 100);

    if (close <= stopLevel) {
      return signal(
        'sell',
        Reason.TREND_PULLBACK_STOP,
        `Trend pullback stop: close ${formatUsd(close)} fell to the ATR stop ${formatUsd(stopLevel)}`,
        nextState,
      );
    }

    if (fast < slow) {
      return signal(
        'sell',
        Reason.TREND_PULLBACK_TREND_BREAK,
        `Trend pullback trend break: fast SMA ${formatUsd(fast)} fell below slow SMA ${formatUsd(slow)}`,
        nextState,
      );
    }

    const trailLevel = hwm * (1 - params.trailPct / 100);
    if (trailActive && close <= trailLevel) {
      return signal(
        'sell',
        Reason.TREND_PULLBACK_TRAIL,
        `Trend pullback trailing stop: close ${formatUsd(close)} fell to ${formatUsd(trailLevel)} from high ${formatUsd(hwm)}`,
        nextState,
      );
    }

    return signal(
      'hold',
      Reason.TREND_PULLBACK_HOLD,
      `Trend pullback hold: close ${formatUsd(close)} stays above the trailing level ${formatUsd(trailLevel)}`,
      nextState,
    );
  },
};
