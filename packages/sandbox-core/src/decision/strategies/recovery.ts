import { DEFAULT_STRATEGY_SETTINGS } from '../defaults';
import { closes, formatPct, formatUsd, numeric, sma } from '../indicators';
import { Reason } from '../reason-codes';
import type { RecoveryParams, Regime } from '../types';
import type { StrategyContext, StrategyDefinition, StrategySignal } from './index';

/**
 * Recovery: after a crash or downtrend, wait for `confirmBars` consecutive
 * closes above the fast SMA, then buy once. The confirmation counter lives in
 * strategy state as a native number (rule input, never money).
 */
const STRATEGY_VERSION = 1;
const CONFIDENCE = 0.5;
const ELIGIBLE_REGIMES: readonly Regime[] = ['RECOVERY'];

function signal(
  action: StrategySignal['action'],
  reasonCode: StrategySignal['reasonCode'],
  reasonText: string,
  nextState: Readonly<Record<string, unknown>>,
  riskWeight: number,
  stopLossPct: string | null = null,
): StrategySignal {
  return {
    action,
    reasonCode,
    reasonText,
    confidence: CONFIDENCE,
    riskWeight,
    stopLossPct,
    takeProfitPct: null,
    nextState,
  };
}

export const recoveryStrategy: StrategyDefinition<RecoveryParams> = {
  key: 'recovery',
  version: STRATEGY_VERSION,
  eligibleRegimes: ELIGIBLE_REGIMES,
  defaultParams: DEFAULT_STRATEGY_SETTINGS.recovery,
  evaluate(ctx: StrategyContext, params: RecoveryParams): StrategySignal {
    const prices = closes(ctx.candles);
    const close = prices.length > 0 ? (prices[prices.length - 1] as number) : null;
    const fast = sma(prices, params.fastPeriod);

    if (close === null || fast === null || !Number.isFinite(fast)) {
      return signal(
        'hold',
        Reason.STRATEGY_NO_DATA,
        'Recovery: insufficient candles for the fast SMA',
        ctx.state,
        params.riskWeight,
      );
    }

    const position = ctx.position;
    if (position === null) {
      if (ctx.regime !== 'RECOVERY') {
        return signal(
          'hold',
          Reason.STRATEGY_NOT_ELIGIBLE,
          `Recovery is not eligible in the ${ctx.regime} regime`,
          { aboveFastBars: 0 },
          params.riskWeight,
        );
      }

      const previousCount = numeric(ctx.state.aboveFastBars) ?? 0;
      const count = close > fast ? previousCount + 1 : 0;
      if (count >= params.confirmBars) {
        return signal(
          'buy',
          Reason.RECOVERY_ENTRY,
          `Recovery entry: ${count}/${params.confirmBars} closes above fast SMA ${formatUsd(fast)} confirmed at ${formatUsd(close)}`,
          { aboveFastBars: 0 },
          params.riskWeight,
          formatPct(params.stopPct),
        );
      }

      return signal(
        'hold',
        Reason.RECOVERY_CONFIRMING,
        `Recovery confirming: ${count}/${params.confirmBars} closes above fast SMA ${formatUsd(fast)}`,
        { aboveFastBars: count },
        params.riskWeight,
      );
    }

    const avgCost = Number(position.avgCostUsd);
    if (!Number.isFinite(avgCost) || avgCost <= 0) {
      return signal(
        'hold',
        Reason.STRATEGY_NO_DATA,
        'Recovery: position average cost (avgCostUsd) is not a finite positive number',
        ctx.state,
        params.riskWeight,
      );
    }

    const stopLevel = avgCost * (1 - params.stopPct / 100);
    if (close <= stopLevel) {
      return signal(
        'sell',
        Reason.RECOVERY_STOP,
        `Recovery stop: close ${formatUsd(close)} fell to the hard stop ${formatUsd(stopLevel)}`,
        { aboveFastBars: 0 },
        params.riskWeight,
      );
    }

    if (close < fast) {
      return signal(
        'sell',
        Reason.RECOVERY_TREND_BREAK,
        `Recovery trend break: close ${formatUsd(close)} fell below fast SMA ${formatUsd(fast)}`,
        { aboveFastBars: 0 },
        params.riskWeight,
      );
    }

    return signal(
      'hold',
      Reason.RECOVERY_HOLD,
      `Recovery hold: close ${formatUsd(close)} stays above fast SMA ${formatUsd(fast)}`,
      { aboveFastBars: 0 },
      params.riskWeight,
    );
  },
};
