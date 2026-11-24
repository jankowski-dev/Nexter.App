import { DEFAULT_REGIME_SETTINGS, DEFAULT_STRATEGY_SETTINGS } from '../defaults';
import { atrPct, closes, formatPct, formatUsd, highestHigh, lowestLow } from '../indicators';
import { Reason } from '../reason-codes';
import type { RangeReversionParams, Regime } from '../types';
import type { StrategyContext, StrategyDefinition, StrategySignal } from './index';

/**
 * Range reversion: buy when the close drops `bandAtrMult` ATR units below the
 * midpoint of the recent range, then exit at the midpoint or at a hard stop.
 *
 * The band is measured against the range midpoint, not the current price, so a
 * wide range cannot make the entry trigger easier just because price fell.
 */
export const RANGE_REVERSION_ATR_PERIOD = DEFAULT_REGIME_SETTINGS.atrPeriod;

const STRATEGY_VERSION = 1;
const CONFIDENCE = 0.55;
const RISK_WEIGHT = 1;
const ELIGIBLE_REGIMES: readonly Regime[] = ['RANGE'];

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

export const rangeReversionStrategy: StrategyDefinition<RangeReversionParams> = {
  key: 'range_reversion',
  version: STRATEGY_VERSION,
  eligibleRegimes: ELIGIBLE_REGIMES,
  defaultParams: DEFAULT_STRATEGY_SETTINGS.rangeReversion,
  evaluate(ctx: StrategyContext, params: RangeReversionParams): StrategySignal {
    const prices = closes(ctx.candles);
    const close = prices.length > 0 ? (prices[prices.length - 1] as number) : null;
    const atr = atrPct(ctx.candles, RANGE_REVERSION_ATR_PERIOD);
    const recentHigh = highestHigh(ctx.candles, params.lookback);
    const recentLow = lowestLow(ctx.candles, params.lookback);

    if (close === null || atr === null || recentHigh === null || recentLow === null) {
      return signal(
        'hold',
        Reason.STRATEGY_NO_DATA,
        'Range reversion: insufficient candles for ATR or the range window',
        ctx.state,
      );
    }

    const mid = (recentHigh + recentLow) / 2;
    const position = ctx.position;
    if (position === null) {
      if (ctx.regime !== 'RANGE') {
        return signal(
          'hold',
          Reason.STRATEGY_NOT_ELIGIBLE,
          `Range reversion is not eligible in the ${ctx.regime} regime`,
          ctx.state,
        );
      }

      const bandLevel = mid - ((params.bandAtrMult * atr) / 100) * mid;
      if (close <= bandLevel) {
        return signal(
          'buy',
          Reason.RANGE_REVERSION_ENTRY,
          `Range reversion entry: close ${formatUsd(close)} is at or below the lower band ${formatUsd(bandLevel)} around mid ${formatUsd(mid)}`,
          {},
          formatPct(params.stopAtrMult * atr),
        );
      }

      return signal(
        'hold',
        Reason.RANGE_REVERSION_HOLD,
        `Range reversion hold: close ${formatUsd(close)} is above the lower band ${formatUsd(bandLevel)}`,
        {},
      );
    }

    const avgCost = Number(position.avgCostUsd);
    const stopLevel = avgCost * (1 - (params.stopAtrMult * atr) / 100);
    if (close <= stopLevel) {
      return signal(
        'sell',
        Reason.RANGE_REVERSION_STOP,
        `Range reversion stop: close ${formatUsd(close)} fell to the ATR stop ${formatUsd(stopLevel)}`,
        {},
      );
    }

    if (close >= mid) {
      return signal(
        'sell',
        Reason.RANGE_REVERSION_MID,
        `Range reversion exit: close ${formatUsd(close)} reached the range midpoint ${formatUsd(mid)}`,
        {},
      );
    }

    return signal(
      'hold',
      Reason.RANGE_REVERSION_HOLD,
      `Range reversion hold: close ${formatUsd(close)} is below the midpoint ${formatUsd(mid)} and above the stop ${formatUsd(stopLevel)}`,
      {},
    );
  },
};
