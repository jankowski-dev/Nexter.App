import { z } from 'zod';
import { rollingHigh, sma } from './indicators';
import { buy, dec, hold, sell, type StrategyDefinition, type StrategyState } from './types';

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
  kind: 'system',
  name: 'Импульсный пробой',
  description:
    'Покупает импульс, когда быстрая SMA выше медленной, а изменение за 24 часа положительное.',
  guide:
    'Стратегия ищет ускорение цены. Сначала проверяет, что быстрая SMA выше медленной — это подтверждает восходящий тренд. Затем ждёт положительный импульс за 24 часа выше заданного порога и покупает по закрытию дня. В позиции следит за тейк-профитом, стоп-лоссом и разворотом SMA; при развороте закрывает позицию, даже если TP/SL ещё не достигнуты.',
  bestFor:
    'Плавный или импульсный рост, новые тренды после консолидации, токены с устойчивым momentum.',
  risks:
    'В боковике даёт ложные пробои и быстро накапливает мелкие убытки. Вход может происходить уже после значительной части движения, а разворот SMA иногда запаздывает.',
  paramFields: [
    { key: 'fastPeriod', label: 'Быстрая SMA', min: 2, max: 120, step: 1, integer: true },
    { key: 'slowPeriod', label: 'Медленная SMA', min: 3, max: 240, step: 1, integer: true },
    {
      key: 'minChange24hPct',
      label: 'Мин. импульс за 24 часа',
      min: -50,
      max: 50,
      step: 0.1,
      unit: '%',
    },
    { key: 'takeProfitPct', label: 'Тейк-профит', min: 0.1, max: 100, step: 0.1, unit: '%' },
    { key: 'stopLossPct', label: 'Стоп-лосс', min: 0.1, max: 50, step: 0.1, unit: '%' },
  ],
  defaultParams: momentumParamsSchema.parse({}),
  parseParams: (value) => momentumParamsSchema.parse(value),
  evaluate: (ctx) => {
    const params = momentumParamsSchema.parse(ctx.params);
    const price = dec(ctx.priceUsd);
    const fast = sma(ctx.history, params.fastPeriod);
    const slow = sma(ctx.history, params.slowPeriod);

    if (ctx.position) {
      const avg = dec(ctx.position.avgCostUsd);
      if (ctx.takeProfitEnabled !== false && price.gte(avg.mul(1 + params.takeProfitPct / 100))) {
        return sell('тейк-профит');
      }
      if (ctx.stopLossEnabled !== false && price.lte(avg.mul(1 - params.stopLossPct / 100))) {
        return sell('стоп-лосс');
      }
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
  kind: 'system',
  name: 'Возврат к среднему',
  description: 'Покупает просадку ниже средней и продаёт при возврате к средней.',
  guide:
    'Стратегия покупает временное отклонение цены ниже средней: цена должна опуститься на заданный процент ниже SMA за выбранное окно. Выход происходит при возврате к средней, достижении тейк-профита или стоп-лосса. Это ставка на отскок, а не на продолжение падения.',
  bestFor:
    'Боковик, здоровые откаты внутри растущего тренда, ликвидные токены с выраженными возвратами к средней.',
  risks:
    'В сильном падающем тренде «дешёвая» цена может оставаться дешёвой очень долго; возможны повторные входы в падающий актив. Требует дисциплины по стоп-лоссу.',
  paramFields: [
    { key: 'lookback', label: 'Окно средней', min: 3, max: 240, step: 1, integer: true },
    {
      key: 'entryDropPct',
      label: 'Просадка для входа',
      hint: 'На сколько цена должна быть ниже средней',
      min: 0.1,
      max: 50,
      step: 0.1,
      unit: '%',
    },
    {
      key: 'exitAbovePct',
      label: 'Выход выше средней',
      min: 0,
      max: 50,
      step: 0.1,
      unit: '%',
    },
    { key: 'takeProfitPct', label: 'Тейк-профит', min: 0.1, max: 100, step: 0.1, unit: '%' },
    { key: 'stopLossPct', label: 'Стоп-лосс', min: 0.1, max: 50, step: 0.1, unit: '%' },
  ],
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
      if (ctx.takeProfitEnabled !== false && price.gte(cost.mul(1 + params.takeProfitPct / 100))) {
        return sell('тейк-профит');
      }
      if (ctx.stopLossEnabled !== false && price.lte(cost.mul(1 - params.stopLossPct / 100))) {
        return sell('стоп-лосс');
      }
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
  kind: 'system',
  name: 'Сетка в диапазоне',
  description: 'Покупает ступени ниже якоря и продаёт ступень выше средней.',
  guide:
    'Стратегия строит сетку от недавнего максимума или якоря. Каждая ступень ниже якоря — отдельная покупка; продажа происходит при отскоке на шаг сетки выше средней цены или по тейк-профиту. Число докупок ограничено `maxAdds`, поэтому позиция не растёт бесконечно.',
  bestFor:
    'Боковик с понятными границами, активы с достаточной ликвидностью и регулярными отскоками.',
  risks:
    'В сильном нисходящем тренде сетка накапливает позицию против движения и быстро расходует кэш. Требует широкого диапазона и контроля максимального числа докупок.',
  paramFields: [
    { key: 'anchorLookback', label: 'Окно якоря', min: 5, max: 240, step: 1, integer: true },
    { key: 'gridStepPct', label: 'Шаг сетки', min: 0.2, max: 20, step: 0.1, unit: '%' },
    { key: 'maxAdds', label: 'Макс. докупок', min: 1, max: 20, step: 1, integer: true },
    { key: 'takeProfitPct', label: 'Тейк-профит', min: 0.1, max: 100, step: 0.1, unit: '%' },
    { key: 'stopLossPct', label: 'Стоп-лосс', min: 0.1, max: 50, step: 0.1, unit: '%' },
  ],
  defaultParams: gridRangeParamsSchema.parse({}),
  parseParams: (value) => gridRangeParamsSchema.parse(value),
  evaluate: (ctx) => {
    const params = gridRangeParamsSchema.parse(ctx.params);
    const price = dec(ctx.priceUsd);
    const high = rollingHigh(ctx.history, params.anchorLookback);
    if (!high) return hold('недостаточно истории');

    if (ctx.position) {
      const avg = dec(ctx.position.avgCostUsd);
      if (ctx.takeProfitEnabled !== false && price.gte(avg.mul(1 + params.takeProfitPct / 100))) {
        return sell('шаг сетки вверх');
      }
      if (ctx.stopLossEnabled !== false && price.lte(avg.mul(1 - params.stopLossPct / 100))) {
        return sell('стоп-лосс');
      }
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
  kind: 'system',
  name: 'Откат в тренде',
  description: 'Покупает откат к быстрой SMA в восходящем тренде.',
  guide:
    'Стратегия ищет восходящий тренд по соотношению быстрой и медленной SMA. Внутри тренда она ждёт откат к быстрой средней на заданную глубину и покупает по закрытию дня. Выход — по тейк-профиту, стоп-лоссу или при сломе тренда, когда быстрая SMA опускается ниже медленной.',
  bestFor:
    'Плавный восходящий тренд с регулярными откатами; активы, которые не прыгают на десятки процентов за день.',
  risks:
    'При резкой смене тренда выход по SMA может произойти позже стоп-лосса. В боковике или при частых разворотах возможны ложные входы и серия мелких убытков.',
  paramFields: [
    { key: 'fastPeriod', label: 'Быстрая SMA', min: 2, max: 120, step: 1, integer: true },
    { key: 'slowPeriod', label: 'Медленная SMA', min: 3, max: 240, step: 1, integer: true },
    { key: 'pullbackPct', label: 'Глубина отката', min: 0.1, max: 20, step: 0.1, unit: '%' },
    { key: 'takeProfitPct', label: 'Тейк-профит', min: 0.1, max: 100, step: 0.1, unit: '%' },
    { key: 'stopLossPct', label: 'Стоп-лосс', min: 0.1, max: 50, step: 0.1, unit: '%' },
  ],
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
      if (ctx.takeProfitEnabled !== false && price.gte(avg.mul(1 + params.takeProfitPct / 100))) {
        return sell('тейк-профит');
      }
      if (ctx.stopLossEnabled !== false && price.lte(avg.mul(1 - params.stopLossPct / 100))) {
        return sell('стоп-лосс');
      }
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
  kind: 'system',
  name: 'Докупка на просадке',
  description: 'Докупает на просадке от якоря или средней с ограничением числа докупок.',
  guide:
    'Стратегия покупает первую просадку от якоря, а затем докупает на заранее заданных шагах ниже средней цены. Количество докупок ограничено `maxAdds`. Выход — по тейк-профиту или стоп-лоссу. Это стратегия усреднения, а не поиска точного дна.',
  bestFor:
    'Долгосрочное накопление актива с понятным диапазоном, достаточный свободный кэш и готовность терпеть просадку.',
  risks:
    'В затяжном падении докупки могут закончиться раньше разворота, а средняя цена останется выше рынка. Требует строгого лимита на общий риск и свободный кэш.',
  paramFields: [
    { key: 'anchorLookback', label: 'Окно якоря', min: 5, max: 240, step: 1, integer: true },
    { key: 'dipPct', label: 'Просадка для докупки', min: 0.2, max: 50, step: 0.1, unit: '%' },
    { key: 'maxAdds', label: 'Макс. докупок', min: 1, max: 10, step: 1, integer: true },
    { key: 'takeProfitPct', label: 'Тейк-профит', min: 0.1, max: 100, step: 0.1, unit: '%' },
    { key: 'stopLossPct', label: 'Стоп-лосс', min: 0.1, max: 50, step: 0.1, unit: '%' },
  ],
  defaultParams: dcaDipParamsSchema.parse({}),
  parseParams: (value) => dcaDipParamsSchema.parse(value),
  evaluate: (ctx) => {
    const params = dcaDipParamsSchema.parse(ctx.params);
    const price = dec(ctx.priceUsd);
    const high = rollingHigh(ctx.history, params.anchorLookback);
    if (!high) return hold('недостаточно истории');

    if (ctx.position) {
      const avg = dec(ctx.position.avgCostUsd);
      if (ctx.takeProfitEnabled !== false && price.gte(avg.mul(1 + params.takeProfitPct / 100))) {
        return sell('тейк-профит');
      }
      if (ctx.stopLossEnabled !== false && price.lte(avg.mul(1 - params.stopLossPct / 100))) {
        return sell('стоп-лосс');
      }
      if (ctx.buyCount < params.maxAdds && price.lte(avg.mul(1 - params.dipPct / 100))) {
        return buy('докупка на просадке');
      }
      return hold('ожидание просадки');
    }

    if (price.lte(high.mul(1 - params.dipPct / 100))) return buy('первая просадка');
    return hold('нет просадки');
  },
};

const crashProtectedGridParamsSchema = z
  .object({
    gridStepPct: z.number().min(0.2).max(20).default(1.5),
    maxAdds: z.number().int().min(1).max(20).default(4),
    takeProfitPct: z.number().min(0.1).max(100).default(2.5),
    crashTriggerPct: z.number().min(1).max(90).default(10),
    resumeDropPct: z.number().min(2).max(95).default(30),
    closeLossThresholdPct: z.number().min(0).max(100).default(10),
  })
  .refine((value) => value.resumeDropPct > value.crashTriggerPct, {
    message: 'resumeDropPct must be greater than crashTriggerPct',
    path: ['resumeDropPct'],
  });

interface CrashGridState {
  hwm: ReturnType<typeof dec>;
  mode: 'normal' | 'crash';
  adds: number;
}

function readCrashGridState(
  value: Record<string, unknown> | undefined,
  priceUsd: string,
): CrashGridState {
  let hwm = dec(priceUsd);
  if (value && typeof value.highWaterMark === 'string') {
    try {
      const parsed = dec(value.highWaterMark);
      if (parsed.gt(0)) hwm = parsed;
    } catch {
      // Fall back to the current price.
    }
  }
  const mode = value?.mode === 'crash' ? 'crash' : 'normal';
  const addsRaw = Number(value?.adds);
  const adds = Number.isFinite(addsRaw) && addsRaw >= 0 ? Math.floor(addsRaw) : 0;
  return { hwm, mode, adds };
}

function crashGridState(
  hwm: ReturnType<typeof dec>,
  mode: 'normal' | 'crash',
  adds: number,
): StrategyState {
  return { highWaterMark: hwm.toString(), mode, adds };
}

export const crashProtectedGrid: StrategyDefinition = {
  key: 'crash_protected_grid',
  version: 1,
  icon: 'shield',
  kind: 'custom',
  name: 'Защитная сетка',
  description:
    'Сетка с защитным режимом на обвале: закрывает прибыльные и низкоубыточные позиции, пережидает падение и возобновляет работу ниже.',
  guide:
    'Обычный режим покупает ступени ниже опоры и продаёт по тейк-профиту. Стратегия запоминает максимум цены (high-water mark). Если цена падает от него на crashTriggerPct, покупки останавливаются: позиция закрывается, если её P&L не хуже −closeLossThresholdPct; более глубокий убыток остаётся открытым. Пауза держится до падения на resumeDropPct от максимума. На этом уровне опора сбрасывается на текущую цену, счётчик докупок обнуляется и сетка снова начинает работать. Если цена обновляет максимум, защитный режим снимается автоматически.',
  bestFor:
    'Волатильные активы с резкими обвалами и отскоками, где нужно переждать падение, а не докупать в свободном падении.',
  risks:
    'Глубоко убыточная позиция остаётся открытой и может пережить длительный обвал. После сброса опоры новая сетка может снова попасть под падение. Нужен свободный кэш и готовность к просадке.',
  paramFields: [
    { key: 'gridStepPct', label: 'Шаг сетки', min: 0.2, max: 20, step: 0.1, unit: '%' },
    { key: 'maxAdds', label: 'Макс. докупок', min: 1, max: 20, step: 1, integer: true },
    { key: 'takeProfitPct', label: 'Тейк-профит сетки', min: 0.1, max: 100, step: 0.1, unit: '%' },
    {
      key: 'crashTriggerPct',
      label: 'Порог обвала для паузы',
      hint: 'Падение от максимума, после которого покупки останавливаются',
      min: 1,
      max: 90,
      step: 0.5,
      unit: '%',
    },
    {
      key: 'resumeDropPct',
      label: 'Порог возобновления',
      hint: 'Падение от максимума, после которого сетка снова работает',
      min: 2,
      max: 95,
      step: 0.5,
      unit: '%',
    },
    {
      key: 'closeLossThresholdPct',
      label: 'Закрывать при убытке до',
      hint: 'На обвале закрываются позиции с P&L не хуже этого уровня',
      min: 0,
      max: 100,
      step: 0.5,
      unit: '%',
    },
  ],
  defaultParams: crashProtectedGridParamsSchema.parse({}),
  parseParams: (value) => crashProtectedGridParamsSchema.parse(value),
  evaluate: (ctx) => {
    const params = crashProtectedGridParamsSchema.parse(ctx.params);
    const price = dec(ctx.priceUsd);
    const state = readCrashGridState(ctx.state, ctx.priceUsd);
    const position = ctx.position;
    const avgCost = position ? dec(position.avgCostUsd) : null;
    if (typeof ctx.state?.highWaterMark !== 'string' && avgCost && avgCost.gt(state.hwm)) {
      state.hwm = avgCost;
    }
    const pnlPct =
      position && avgCost && avgCost.gt(0) ? price.minus(avgCost).div(avgCost).mul(100) : null;
    const canCloseOnCrash =
      position !== null && pnlPct !== null && pnlPct.gte(-params.closeLossThresholdPct);

    let hwm = price.gt(state.hwm) ? price : state.hwm;
    let mode = state.mode;
    if (price.gte(state.hwm)) {
      hwm = price;
      mode = 'normal';
    }

    const dropPct = hwm.gt(0) ? hwm.minus(price).div(hwm).mul(100) : dec('0');

    if (dropPct.gte(params.resumeDropPct)) {
      if (canCloseOnCrash) {
        return sell('защитное закрытие на обвале', crashGridState(price, 'normal', 0));
      }
      return buy('возобновление сетки после обвала', crashGridState(price, 'normal', 1));
    }

    if (mode === 'crash' || dropPct.gte(params.crashTriggerPct)) {
      if (canCloseOnCrash) {
        return sell('защитное закрытие на обвале', crashGridState(hwm, 'crash', 0));
      }
      return hold('обвал: покупки приостановлены', crashGridState(hwm, 'crash', state.adds));
    }

    if (position && avgCost) {
      if (price.gte(avgCost.mul(1 + params.takeProfitPct / 100))) {
        return sell('тейк-профит', crashGridState(hwm, 'normal', 0));
      }
      if (state.adds < params.maxAdds && price.lte(avgCost.mul(1 - params.gridStepPct / 100))) {
        return buy('ступень защитной сетки', crashGridState(hwm, 'normal', state.adds + 1));
      }
      return hold('внутри сетки', crashGridState(hwm, 'normal', state.adds));
    }

    if (price.lte(hwm.mul(1 - params.gridStepPct / 100))) {
      return buy('первая ступень защитной сетки', crashGridState(hwm, 'normal', 1));
    }

    return hold('цена у опоры', crashGridState(hwm, 'normal', 0));
  },
};

export const strategyDefinitions = [
  momentumBreakout,
  meanReversion,
  gridRange,
  trendPullback,
  dcaDip,
  crashProtectedGrid,
];

export const strategyByKey = new Map(strategyDefinitions.map((item) => [item.key, item]));

export function strategyTemplates() {
  return strategyDefinitions.map((item) => ({
    key: item.key,
    name: item.name,
    description: item.description,
    guide: item.guide,
    bestFor: item.bestFor,
    risks: item.risks,
    icon: item.icon,
    kind: item.kind,
    defaultParams: item.defaultParams,
    paramFields: item.paramFields,
  }));
}
