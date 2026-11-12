import { z } from 'zod';
import { rollingHigh, sma } from './indicators';
import { buy, dec, hold, sell, type StrategyDefinition } from './types';

const momentumParamsSchema = z
  .object({
    fastPeriod: z.number().int().min(2).max(120).default(5),
    slowPeriod: z.number().int().min(3).max(240).default(20),
    minChange24hPct: z.number().min(-50).max(50).default(1),
    takeProfitPct: z.number().min(0.1).max(100).default(5),
    stopLossPct: z.number().min(0.1).max(50).default(3),
  })
  .refine((value) => value.slowPeriod > value.fastPeriod, {
    message: 'slowPeriod must be greater than fastPeriod',
    path: ['slowPeriod'],
  });

export const momentumBreakout: StrategyDefinition = {
  key: 'momentum_breakout',
  version: 1,
  icon: 'rocket',
  name: 'Импульсный пробой',
  description:
    'Покупает импульс, когда быстрая SMA выше медленной, а изменение за 24 часа положительное.',
  defaultParams: momentumParamsSchema.parse({}),
  parseParams: (value) => momentumParamsSchema.parse(value),
  evaluate: (ctx) => {
    const params = momentumParamsSchema.parse(ctx.params);
    const price = dec(ctx.priceUsd);
    const fast = sma(ctx.history, params.fastPeriod);
    const slow = sma(ctx.history, params.slowPeriod);

    if (ctx.position) {
      const avg = dec(ctx.position.avgCostUsd);
      if (price.gte(avg.mul(1 + params.takeProfitPct / 100))) return sell('тейк-профит');
      if (price.lte(avg.mul(1 - params.stopLossPct / 100))) return sell('стоп-лосс');
      if (fast && slow && fast.lt(slow)) return sell('быстрая SMA ниже медленной');
      return hold('позиция в пределах риска');
    }

    if (!fast || !slow) return hold('недостаточно истории');
    if (
      ctx.change24hPct === null ||
      dec(ctx.change24hPct).lt(dec(String(params.minChange24hPct)))
    ) {
      return hold('импульс 24ч ниже порога');
    }
    if (fast.lte(slow)) return hold('быстрая SMA не выше медленной');
    return buy('импульсный пробой');
  },
};

const meanReversionParamsSchema = z.object({
  lookback: z.number().int().min(3).max(240).default(20),
  entryDropPct: z.number().min(0.1).max(50).default(3),
  exitAbovePct: z.number().min(0).max(50).default(0.5),
  takeProfitPct: z.number().min(0.1).max(100).default(5),
  stopLossPct: z.number().min(0.1).max(50).default(5),
});

export const meanReversion: StrategyDefinition = {
  key: 'mean_reversion',
  version: 1,
  icon: 'refresh',
  name: 'Возврат к среднему',
  description: 'Покупает просадку ниже средней и продаёт при возврате к средней.',
  defaultParams: meanReversionParamsSchema.parse({}),
  parseParams: (value) => meanReversionParamsSchema.parse(value),
  evaluate: (ctx) => {
    const params = meanReversionParamsSchema.parse(ctx.params);
    const price = dec(ctx.priceUsd);
    const avg = sma(ctx.history, params.lookback);
    if (!avg) return hold('недостаточно истории');

    if (ctx.position) {
      const cost = dec(ctx.position.avgCostUsd);
      if (price.gte(avg.mul(1 + params.exitAbovePct / 100))) return sell('возврат к среднему');
      if (price.gte(cost.mul(1 + params.takeProfitPct / 100))) return sell('тейк-профит');
      if (price.lte(cost.mul(1 - params.stopLossPct / 100))) return sell('стоп-лосс');
      return hold('ожидание возврата');
    }

    if (price.lte(avg.mul(1 - params.entryDropPct / 100))) return buy('цена ниже среднего');
    return hold('цена недостаточно ниже среднего');
  },
};

const gridRangeParamsSchema = z.object({
  anchorLookback: z.number().int().min(5).max(240).default(20),
  gridStepPct: z.number().min(0.2).max(20).default(1.5),
  maxAdds: z.number().int().min(1).max(20).default(4),
  takeProfitPct: z.number().min(0.1).max(100).default(1.5),
  stopLossPct: z.number().min(0.1).max(50).default(6),
});

export const gridRange: StrategyDefinition = {
  key: 'grid_range',
  version: 1,
  icon: 'grid',
  name: 'Сетка в диапазоне',
  description: 'Покупает ступени ниже якоря и продаёт ступень выше средней.',
  defaultParams: gridRangeParamsSchema.parse({}),
  parseParams: (value) => gridRangeParamsSchema.parse(value),
  evaluate: (ctx) => {
    const params = gridRangeParamsSchema.parse(ctx.params);
    const price = dec(ctx.priceUsd);
    const high = rollingHigh(ctx.history, params.anchorLookback);
    if (!high) return hold('недостаточно истории');

    if (ctx.position) {
      const avg = dec(ctx.position.avgCostUsd);
      if (price.gte(avg.mul(1 + params.takeProfitPct / 100))) return sell('шаг сетки вверх');
      if (price.lte(avg.mul(1 - params.stopLossPct / 100))) return sell('стоп-лосс');
      if (ctx.buyCount < params.maxAdds && price.lte(avg.mul(1 - params.gridStepPct / 100))) {
        return buy('следующая ступень сетки');
      }
      return hold('внутри сетки');
    }

    if (price.lte(high.mul(1 - params.gridStepPct / 100))) return buy('первая ступень сетки');
    return hold('цена у якоря');
  },
};

const trendPullbackParamsSchema = z
  .object({
    fastPeriod: z.number().int().min(2).max(120).default(8),
    slowPeriod: z.number().int().min(3).max(240).default(30),
    pullbackPct: z.number().min(0.1).max(20).default(1),
    takeProfitPct: z.number().min(0.1).max(100).default(5),
    stopLossPct: z.number().min(0.1).max(50).default(3),
  })
  .refine((value) => value.slowPeriod > value.fastPeriod, {
    message: 'slowPeriod must be greater than fastPeriod',
    path: ['slowPeriod'],
  });

export const trendPullback: StrategyDefinition = {
  key: 'trend_pullback',
  version: 1,
  icon: 'trend',
  name: 'Откат в тренде',
  description: 'Покупает откат к быстрой SMA в восходящем тренде.',
  defaultParams: trendPullbackParamsSchema.parse({}),
  parseParams: (value) => trendPullbackParamsSchema.parse(value),
  evaluate: (ctx) => {
    const params = trendPullbackParamsSchema.parse(ctx.params);
    const price = dec(ctx.priceUsd);
    const fast = sma(ctx.history, params.fastPeriod);
    const slow = sma(ctx.history, params.slowPeriod);
    if (!fast || !slow) return hold('недостаточно истории');

    if (ctx.position) {
      const avg = dec(ctx.position.avgCostUsd);
      if (price.gte(avg.mul(1 + params.takeProfitPct / 100))) return sell('тейк-профит');
      if (price.lte(avg.mul(1 - params.stopLossPct / 100))) return sell('стоп-лосс');
      if (fast.lt(slow)) return sell('тренд сломан');
      return hold('позиция в тренде');
    }

    if (fast.lte(slow)) return hold('нет восходящего тренда');
    if (price.lte(fast.mul(1 - params.pullbackPct / 100))) return buy('откат к быстрой SMA');
    return hold('нет отката');
  },
};

const dcaDipParamsSchema = z.object({
  anchorLookback: z.number().int().min(5).max(240).default(20),
  dipPct: z.number().min(0.2).max(50).default(3),
  maxAdds: z.number().int().min(1).max(10).default(3),
  takeProfitPct: z.number().min(0.1).max(100).default(5),
  stopLossPct: z.number().min(0.1).max(50).default(8),
});

export const dcaDip: StrategyDefinition = {
  key: 'dca_dip',
  version: 1,
  icon: 'layers',
  name: 'Докупка на просадке',
  description: 'Докупает на просадке от якоря или средней с ограничением числа докупок.',
  defaultParams: dcaDipParamsSchema.parse({}),
  parseParams: (value) => dcaDipParamsSchema.parse(value),
  evaluate: (ctx) => {
    const params = dcaDipParamsSchema.parse(ctx.params);
    const price = dec(ctx.priceUsd);
    const high = rollingHigh(ctx.history, params.anchorLookback);
    if (!high) return hold('недостаточно истории');

    if (ctx.position) {
      const avg = dec(ctx.position.avgCostUsd);
      if (price.gte(avg.mul(1 + params.takeProfitPct / 100))) return sell('тейк-профит');
      if (price.lte(avg.mul(1 - params.stopLossPct / 100))) return sell('стоп-лосс');
      if (ctx.buyCount < params.maxAdds && price.lte(avg.mul(1 - params.dipPct / 100))) {
        return buy('докупка на просадке');
      }
      return hold('ожидание просадки');
    }

    if (price.lte(high.mul(1 - params.dipPct / 100))) return buy('первая просадка');
    return hold('нет просадки');
  },
};

export const strategyDefinitions = [
  momentumBreakout,
  meanReversion,
  gridRange,
  trendPullback,
  dcaDip,
];

export const strategyByKey = new Map(strategyDefinitions.map((item) => [item.key, item]));

export function strategyTemplates() {
  return strategyDefinitions.map((item) => ({
    key: item.key,
    name: item.name,
    description: item.description,
    icon: item.icon,
    defaultParams: item.defaultParams,
  }));
}
