import { z } from 'zod';
import { Decimal } from 'decimal.js';
import type { BotCandle } from '@nexter/contracts';
import {
  bollingerBands,
  dailyAverageLevels,
  rollingHigh,
  rollingHighBefore,
  rollingLow,
  rollingLowBefore,
  sma,
} from './indicators';
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

const trailingStopParamsSchema = z.object({
  entryLookback: z.number().int().min(2).max(240).default(20),
  breakoutBufferPct: z.number().min(0).max(10).default(0.2),
  activationPct: z.number().min(0.1).max(100).default(2),
  trailPct: z.number().min(0.1).max(50).default(1.5),
  hardStopPct: z.number().min(0.1).max(50).default(5),
});

function readTrailingPeak(value: Record<string, unknown> | undefined, fallback: Decimal): Decimal {
  if (value && typeof value.peak === 'string') {
    try {
      const parsed = dec(value.peak);
      if (parsed.gt(0)) return parsed;
    } catch {
      // Fall back to the current price.
    }
  }
  return fallback;
}

export const trailingStop: StrategyDefinition = {
  stateful: true,
  key: 'trailing_stop',
  version: 1,
  icon: 'trend',
  kind: 'system',
  name: 'Трейлинг-стоп',
  description: 'Покупает пробой диапазона и ведёт позицию по скользящему стопу от максимума цены.',
  guide:
    'Стратегия ждёт, пока цена закроется выше максимума за выбранное окно с небольшим буфером, и покупает пробой. В позиции запоминается максимум цены. После роста на activationPct включается трейлинг-стоп: если цена откатывается на trailPct от максимума, позиция закрывается. До активации защищает жёсткий стоп на hardStopPct ниже средней цены. Скользящий стоп подтягивается только вверх и никогда не опускается.',
  bestFor:
    'Трендовые и импульсные активы, где нужно дать прибыли расти, но защитить её от разворота.',
  risks:
    'В боковике пробои часто оказываются ложными. Слишком узкий трейлинг выбивает из тренда на обычном откате, слишком широкий отдаёт большую часть прибыли. Жёсткий стоп ограничивает убыток, но не исключает гэп ниже него.',
  paramFields: [
    { key: 'entryLookback', label: 'Окно пробоя', min: 2, max: 240, step: 1, integer: true },
    {
      key: 'breakoutBufferPct',
      label: 'Буфер пробоя',
      hint: 'Насколько цена должна превысить предыдущий максимум',
      min: 0,
      max: 10,
      step: 0.1,
      unit: '%',
    },
    {
      key: 'activationPct',
      label: 'Активация трейлинга',
      hint: 'Прибыль от средней цены, после которой включается скользящий стоп',
      min: 0.1,
      max: 100,
      step: 0.1,
      unit: '%',
    },
    {
      key: 'trailPct',
      label: 'Откат для выхода',
      hint: 'Расстояние от максимума цены',
      min: 0.1,
      max: 50,
      step: 0.1,
      unit: '%',
    },
    { key: 'hardStopPct', label: 'Жёсткий стоп', min: 0.1, max: 50, step: 0.1, unit: '%' },
  ],
  defaultParams: trailingStopParamsSchema.parse({}),
  parseParams: (value) => trailingStopParamsSchema.parse(value),
  evaluate: (ctx) => {
    const params = trailingStopParamsSchema.parse(ctx.params);
    const price = dec(ctx.priceUsd);

    if (ctx.position) {
      const avg = dec(ctx.position.avgCostUsd);
      const peak = Decimal.max(readTrailingPeak(ctx.state, price), price, avg);
      const state = { peak: peak.toString() };

      if (ctx.stopLossEnabled !== false) {
        const hardStop = avg.mul(1 - params.hardStopPct / 100);
        if (price.lte(hardStop)) return sell('жёсткий стоп', { peak: price.toString() });
      }

      const activation = avg.mul(1 + params.activationPct / 100);
      if (peak.gte(activation)) {
        const trail = peak.mul(1 - params.trailPct / 100);
        if (price.lte(trail)) return sell('трейлинг-стоп', { peak: price.toString() });
        return hold('трейлинг активен', state);
      }

      return hold('ожидание активации трейлинга', state);
    }

    const priorHigh = rollingHigh(ctx.history.slice(0, -1), params.entryLookback);
    if (!priorHigh) return hold('недостаточно истории', { peak: price.toString() });

    const trigger = priorHigh.mul(1 + params.breakoutBufferPct / 100);
    if (price.gt(trigger)) return buy('пробой диапазона', { peak: price.toString() });

    return hold('нет пробоя', { peak: price.toString() });
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
  stateful: true,
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

const donchianParamsSchema = z.object({
  channelPeriod: z.number().int().min(5).max(200).default(20),
  exitPeriod: z.number().int().min(3).max(100).default(10),
  breakoutBufferPct: z.number().min(0).max(5).default(0.2),
  takeProfitPct: z.number().min(0.1).max(100).default(10),
  stopLossPct: z.number().min(0.1).max(50).default(5),
});

export const donchianBreakout: StrategyDefinition = {
  key: 'donchian_breakout',
  version: 1,
  icon: 'channel',
  kind: 'system',
  name: 'Пробой канала Дончиана',
  description:
    'Покупает пробой максимума за выбранное окно и выходит при пробое нижнего канала или по TP/SL.',
  guide:
    'Стратегия строит канал по закрытиям: вход — когда цена закрывается выше максимума предыдущих N свечей с небольшим буфером. В позиции она держит её до противоположного канала, тейк-профита или стоп-лосса. Это чистый trend-following без SMA и 24-часового импульса, поэтому он ловит начало движения иначе, чем momentum_breakout.',
  bestFor:
    'Сильные направленные движения, выход из длинной консолидации, тренды с последовательными максимумами.',
  risks:
    'В боковике даёт ложные пробои и быстро накапливает убытки. Вход происходит после движения, а разворот канала иногда запаздывает.',
  paramFields: [
    { key: 'channelPeriod', label: 'Окно канала', min: 5, max: 200, step: 1, integer: true },
    { key: 'exitPeriod', label: 'Окно выхода', min: 3, max: 100, step: 1, integer: true },
    {
      key: 'breakoutBufferPct',
      label: 'Буфер пробоя',
      min: 0,
      max: 5,
      step: 0.1,
      unit: '%',
    },
    { key: 'takeProfitPct', label: 'Тейк-профит', min: 0.1, max: 100, step: 0.1, unit: '%' },
    { key: 'stopLossPct', label: 'Стоп-лосс', min: 0.1, max: 50, step: 0.1, unit: '%' },
  ],
  defaultParams: donchianParamsSchema.parse({}),
  parseParams: (value) => donchianParamsSchema.parse(value),
  evaluate: (ctx) => {
    const params = donchianParamsSchema.parse(ctx.params);
    const price = dec(ctx.priceUsd);

    if (ctx.position) {
      const avg = dec(ctx.position.avgCostUsd);
      if (ctx.takeProfitEnabled !== false && price.gte(avg.mul(1 + params.takeProfitPct / 100))) {
        return sell('тейк-профит');
      }
      if (ctx.stopLossEnabled !== false && price.lte(avg.mul(1 - params.stopLossPct / 100))) {
        return sell('стоп-лосс');
      }

      const low = rollingLow(ctx.history, params.exitPeriod);
      if (low && price.lte(low)) return sell('пробой нижнего канала');
      return hold('позиция внутри канала');
    }

    const high = rollingHighBefore(ctx.history, params.channelPeriod);
    if (!high) return hold('недостаточно истории');
    if (price.gt(high.mul(1 + params.breakoutBufferPct / 100))) {
      return buy('пробой верхнего канала');
    }
    return hold('цена внутри канала');
  },
};

const bollingerParamsSchema = z.object({
  period: z.number().int().min(10).max(100).default(20),
  stdDev: z.number().min(0.5).max(5).default(2),
  exitAboveMeanPct: z.number().min(0).max(10).default(0.5),
  takeProfitPct: z.number().min(0.1).max(100).default(8),
  stopLossPct: z.number().min(0.1).max(50).default(5),
});

export const bollingerReversion: StrategyDefinition = {
  key: 'bollinger_reversion',
  version: 1,
  icon: 'bands',
  kind: 'system',
  name: 'Возврат к Bollinger',
  description: 'Покупает закрытие ниже нижней полосы Bollinger и продаёт при возврате к средней.',
  guide:
    'Стратегия считает среднюю и стандартное отклонение цены за период. Вход — когда цена закрывается ниже нижней полосы, то есть отклонение стало необычно большим. Выход — при возврате к средней (с небольшим буфером), по тейк-профиту или стоп-лоссу. В отличие от mean_reversion, порог входа адаптируется к волатильности.',
  bestFor:
    'Боковик, здоровые откаты в тренде, ликвидные активы с выраженными возвратами к средней.',
  risks:
    'В сильном падающем тренде цена может долго оставаться ниже нижней полосы; вход против тренда требует дисциплины по стопу.',
  paramFields: [
    { key: 'period', label: 'Период средней', min: 10, max: 100, step: 1, integer: true },
    { key: 'stdDev', label: 'Отклонение', min: 0.5, max: 5, step: 0.1 },
    {
      key: 'exitAboveMeanPct',
      label: 'Выход выше средней',
      min: 0,
      max: 10,
      step: 0.1,
      unit: '%',
    },
    { key: 'takeProfitPct', label: 'Тейк-профит', min: 0.1, max: 100, step: 0.1, unit: '%' },
    { key: 'stopLossPct', label: 'Стоп-лосс', min: 0.1, max: 50, step: 0.1, unit: '%' },
  ],
  defaultParams: bollingerParamsSchema.parse({}),
  parseParams: (value) => bollingerParamsSchema.parse(value),
  evaluate: (ctx) => {
    const params = bollingerParamsSchema.parse(ctx.params);
    const price = dec(ctx.priceUsd);
    const bands = bollingerBands(ctx.history, params.period, params.stdDev);

    if (ctx.position) {
      const avg = dec(ctx.position.avgCostUsd);
      if (ctx.takeProfitEnabled !== false && price.gte(avg.mul(1 + params.takeProfitPct / 100))) {
        return sell('тейк-профит');
      }
      if (ctx.stopLossEnabled !== false && price.lte(avg.mul(1 - params.stopLossPct / 100))) {
        return sell('стоп-лосс');
      }
      if (bands && price.gte(bands.mean.mul(1 + params.exitAboveMeanPct / 100))) {
        return sell('возврат к средней');
      }
      return hold('позиция ниже средней');
    }

    if (!bands) return hold('недостаточно истории');
    if (price.lt(bands.lower)) return buy('ниже нижней полосы');
    return hold('цена внутри полос');
  },
};

const squeezeParamsSchema = z.object({
  period: z.number().int().min(10).max(100).default(20),
  stdDev: z.number().min(1).max(4).default(2),
  squeezeThresholdPct: z.number().min(0.5).max(10).default(2),
  breakoutBufferPct: z.number().min(0).max(5).default(0.2),
  takeProfitPct: z.number().min(5).max(50).default(12),
  stopLossPct: z.number().min(1).max(20).default(5),
});

export const squeezeBreakout: StrategyDefinition = {
  key: 'squeeze_breakout',
  version: 1,
  icon: 'squeeze',
  kind: 'system',
  name: 'Выход из сжатия',
  description: 'Ждёт сжатия полос Bollinger и покупает пробой верхней полосы после него.',
  guide:
    'Стратегия измеряет ширину полос Bollinger относительно средней. Когда ширина падает ниже порога, рынок находится в сжатии — обычно перед движением. Вход происходит только при пробое верхней полосы с буфером; выход — при возврате под среднюю, по тейк-профиту или стоп-лоссу. Это попытка поймать начало движения, а не уже состоявшийся тренд.',
  bestFor:
    'Переход от боковика к тренду, периоды низкой волатильности с последующим расширением диапазона.',
  risks:
    'Ложные пробои после сжатия; на тонких рынках ширина полос может искажаться одной сделкой. Требует дисциплины по стопу.',
  paramFields: [
    { key: 'period', label: 'Период полос', min: 10, max: 100, step: 1, integer: true },
    { key: 'stdDev', label: 'Отклонение', min: 1, max: 4, step: 0.1 },
    {
      key: 'squeezeThresholdPct',
      label: 'Порог сжатия',
      min: 0.5,
      max: 10,
      step: 0.1,
      unit: '%',
    },
    {
      key: 'breakoutBufferPct',
      label: 'Буфер пробоя',
      min: 0,
      max: 5,
      step: 0.1,
      unit: '%',
    },
    { key: 'takeProfitPct', label: 'Тейк-профит', min: 5, max: 50, step: 0.1, unit: '%' },
    { key: 'stopLossPct', label: 'Стоп-лосс', min: 1, max: 20, step: 0.1, unit: '%' },
  ],
  defaultParams: squeezeParamsSchema.parse({}),
  parseParams: (value) => squeezeParamsSchema.parse(value),
  evaluate: (ctx) => {
    const params = squeezeParamsSchema.parse(ctx.params);
    const price = dec(ctx.priceUsd);
    const bands = bollingerBands(ctx.history.slice(0, -1), params.period, params.stdDev);

    if (ctx.position) {
      const avg = dec(ctx.position.avgCostUsd);
      if (ctx.takeProfitEnabled !== false && price.gte(avg.mul(1 + params.takeProfitPct / 100))) {
        return sell('тейк-профит');
      }
      if (ctx.stopLossEnabled !== false && price.lte(avg.mul(1 - params.stopLossPct / 100))) {
        return sell('стоп-лосс');
      }
      if (bands && price.lt(bands.mean)) return sell('возврат под среднюю');
      return hold('позиция выше средней');
    }

    if (!bands) return hold('недостаточно истории');
    if (bands.bandwidthPct.gt(params.squeezeThresholdPct)) return hold('нет сжатия');
    if (price.gt(bands.upper.mul(1 + params.breakoutBufferPct / 100))) {
      return buy('выход из сжатия');
    }
    return hold('сжатие без пробоя');
  },
};

const failedBreakoutParamsSchema = z.object({
  lookback: z.number().int().min(10).max(100).default(20),
  breakdownBufferPct: z.number().min(0).max(5).default(0.5),
  takeProfitPct: z.number().min(5).max(30).default(8),
  stopLossPct: z.number().min(1).max(20).default(4),
});

function readBreakdownLevel(state: Record<string, unknown> | undefined): Decimal | null {
  if (!state || typeof state.breakdownLevel !== 'string') return null;
  try {
    const level = dec(state.breakdownLevel);
    return level.gt(0) ? level : null;
  } catch {
    return null;
  }
}

export const failedBreakout: StrategyDefinition = {
  stateful: true,
  key: 'failed_breakout',
  version: 1,
  icon: 'reversal',
  kind: 'system',
  name: 'Неудавшийся пробой',
  description: 'Ждёт ложного пробоя поддержки и покупает возврат цены выше неё.',
  guide:
    'Стратегия запоминает уровень поддержки и ждёт, когда цена закроется ниже него с буфером. Это ещё не вход: если падение продолжится, покупки нет. Вход появляется только при возврате выше пробитого уровня — то есть когда пробой не подтвердился. Выход — по тейк-профиту или стоп-лоссу; состояние сбрасывается после закрытия позиции.',
  bestFor:
    'Боковик, высокая волатильность с ложными проколами, активы с выраженными уровнями поддержки.',
  risks:
    'Если пробой окажется настоящим, стратегия просто не входит — но может пропустить сильное движение. В пиле возможны повторные ложные сигналы и мелкие убытки.',
  paramFields: [
    { key: 'lookback', label: 'Окно поддержки', min: 10, max: 100, step: 1, integer: true },
    {
      key: 'breakdownBufferPct',
      label: 'Буфер пробоя',
      min: 0,
      max: 5,
      step: 0.1,
      unit: '%',
    },
    { key: 'takeProfitPct', label: 'Тейк-профит', min: 5, max: 30, step: 0.1, unit: '%' },
    { key: 'stopLossPct', label: 'Стоп-лосс', min: 1, max: 20, step: 0.1, unit: '%' },
  ],
  defaultParams: failedBreakoutParamsSchema.parse({}),
  parseParams: (value) => failedBreakoutParamsSchema.parse(value),
  evaluate: (ctx) => {
    const params = failedBreakoutParamsSchema.parse(ctx.params);
    const price = dec(ctx.priceUsd);

    if (ctx.position) {
      const avg = dec(ctx.position.avgCostUsd);
      if (ctx.takeProfitEnabled !== false && price.gte(avg.mul(1 + params.takeProfitPct / 100))) {
        return sell('тейк-профит', { breakdownLevel: null });
      }
      if (ctx.stopLossEnabled !== false && price.lte(avg.mul(1 - params.stopLossPct / 100))) {
        return sell('стоп-лосс', { breakdownLevel: null });
      }
      return hold('позиция открыта');
    }

    const remembered = readBreakdownLevel(ctx.state);
    if (remembered && price.gte(remembered)) {
      return buy('возврат после ложного пробоя', { breakdownLevel: null });
    }

    const support = rollingLowBefore(ctx.history, params.lookback);
    if (!support) return hold('недостаточно истории');
    if (price.lt(support.mul(1 - params.breakdownBufferPct / 100))) {
      return hold('пробой поддержки', { breakdownLevel: support.toString() });
    }
    return hold('цена выше поддержки');
  },
};

const dailyAverageParamsSchema = z.object({
  lookbackDays: z.number().int().min(5).max(60).default(20),
  entryBufferPct: z.number().min(0).max(10).default(0.5),
  exitBufferPct: z.number().min(0).max(10).default(0.5),
  takeProfitPct: z.number().min(0.1).max(100).default(5),
  stopLossPct: z.number().min(0.1).max(50).default(8),
  useMedian: z.boolean().default(false),
});

export const dailyAverage: StrategyDefinition = {
  key: 'daily_average',
  version: 1,
  icon: 'bands',
  kind: 'system',
  historySampling: 'hourly',
  name: 'Дневная средняя',
  description: 'Покупает у средней или медианной дневной низкой цены и продаёт у дневной высокой.',
  guide:
    'Стратегия собирает историю сделок в полные календарные дни UTC. День считается полным, когда его дата меньше текущей даты UTC; сегодняшние и будущие сэмплы игнорируются, поэтому незакрытый день не влияет на уровни. Для каждого полного дня считаются low, high, среднее и медиана по ценам сэмплов (закрытиям свечей или котировкам), а затем берутся последние `lookbackDays` полных дней. По ним считаются среднее арифметическое и медиана дневных low и high. При выключенном `useMedian` вход и выход используют средние значения, при включённом — медианы; медиана устойчивее к отдельным выбросам. Вход: цена не выше выбранного дневного low минус `entryBufferPct` (по умолчанию 0,5%). Выход: цена не ниже выбранного дневного high плюс `exitBufferPct`, либо тейк-профит/стоп-лосс от средней цены позиции; защитные выходы проверяются первыми. Если полных дней меньше `lookbackDays`, стратегия держит и не входит. Дневные low/high считаются по ценам сэмплов, а не по фитилям свечей, поэтому на 1h/4h истории это внутридневные закрытия, а на дневных свечах — одно значение в день. В живом роботе берётся по одному сэмплу котировки на час в пределах срока хранения истории (`BOT_SAMPLE_RETENTION_DAYS`, по умолчанию 30 дней); для `lookbackDays` больше доступного срока робот будет держать.',
  bestFor:
    'Боковик и регулярные откаты к дневным минимумам, ликвидные токены с выраженными дневными диапазонами и достаточной историей.',
  risks:
    'В затяжном падении цена может оставаться ниже среднего дневного low намного дольше, а «средний» уровень будет опускаться вместе с рынком. На тонких токенах дневной диапазон искажается отдельными сделками. Нужны полные дни истории: при нехватке данных робот не торгует. Стоп-лосс ограничивает убыток, но не исключает гэп ниже него.',
  paramFields: [
    {
      key: 'lookbackDays',
      label: 'Полных дней',
      hint: 'Сколько последних завершённых дней UTC усреднять',
      min: 5,
      max: 60,
      step: 1,
      integer: true,
    },
    {
      key: 'entryBufferPct',
      label: 'Буфер входа ниже low',
      hint: 'Насколько цена должна быть ниже выбранного дневного low',
      min: 0,
      max: 10,
      step: 0.1,
      unit: '%',
    },
    {
      key: 'exitBufferPct',
      label: 'Буфер выхода выше high',
      hint: 'Насколько цена должна быть выше выбранного дневного high',
      min: 0,
      max: 10,
      step: 0.1,
      unit: '%',
    },
    { key: 'takeProfitPct', label: 'Тейк-профит', min: 0.1, max: 100, step: 0.1, unit: '%' },
    { key: 'stopLossPct', label: 'Стоп-лосс', min: 0.1, max: 50, step: 0.1, unit: '%' },
    {
      key: 'useMedian',
      label: 'Медиана вместо среднего',
      hint: 'Выключено — среднее арифметическое дневных low/high; включено — медиана',
      type: 'boolean',
    },
  ],
  defaultParams: dailyAverageParamsSchema.parse({}),
  parseParams: (value) => dailyAverageParamsSchema.parse(value),
  evaluate: (ctx) => {
    const params = dailyAverageParamsSchema.parse(ctx.params);
    const price = dec(ctx.priceUsd);
    const levels = dailyAverageLevels(ctx.history, ctx.now, params.lookbackDays, params.useMedian);

    if (ctx.position) {
      const avg = dec(ctx.position.avgCostUsd);
      if (ctx.takeProfitEnabled !== false && price.gte(avg.mul(1 + params.takeProfitPct / 100))) {
        return sell('тейк-профит');
      }
      if (ctx.stopLossEnabled !== false && price.lte(avg.mul(1 - params.stopLossPct / 100))) {
        return sell('стоп-лосс');
      }
      if (!levels) return hold('недостаточно полных дней');
      if (price.gte(levels.high.mul(1 + params.exitBufferPct / 100))) {
        return sell('цена у дневной высокой');
      }
      return hold('ожидание дневной высокой');
    }

    if (!levels) return hold('недостаточно полных дней');
    if (price.lte(levels.low.mul(1 - params.entryBufferPct / 100))) {
      return buy('цена у дневной низкой');
    }
    return hold('цена выше дневной низкой');
  },
};

const staticLimitParamsSchema = z
  .object({
    buyPriceUsd: z.number().min(0).max(1e15).default(0),
    stopPriceUsd: z.number().min(0).max(1e15).default(0),
    takeProfitPriceUsd: z.number().min(0).max(1e15).default(0),
  })
  .refine(
    (value) => {
      const configured =
        value.buyPriceUsd > 0 || value.stopPriceUsd > 0 || value.takeProfitPriceUsd > 0;
      if (!configured) return true;
      return (
        value.stopPriceUsd > 0 &&
        value.buyPriceUsd > 0 &&
        value.takeProfitPriceUsd > 0 &&
        value.stopPriceUsd < value.buyPriceUsd &&
        value.buyPriceUsd < value.takeProfitPriceUsd
      );
    },
    {
      message: 'stopPriceUsd must be below buyPriceUsd and takeProfitPriceUsd above it',
      path: ['buyPriceUsd'],
    },
  );

function readStaticLimitPhase(state: Record<string, unknown> | undefined): 'armed' | 'waiting' {
  return state?.phase === 'waiting' ? 'waiting' : 'armed';
}

const adaptiveRegimeParamsSchema = z
  .object({
    trendFastDays: z.number().int().min(3).max(14).default(7),
    trendSlowDays: z.number().int().min(14).max(60).default(30),
    trendLongDays: z.number().int().min(60).max(180).default(90),
    pullbackPct: z.number().min(1).max(10).default(3),
    atrStopMult: z.number().min(1).max(5).default(2.5),
    trailPct: z.number().min(1).max(10).default(4),
    crashDrawdownPct: z.number().min(5).max(20).default(10),
    maxAdds: z.number().int().min(1).max(3).default(2),
  })
  .refine((value) => value.trendFastDays < value.trendSlowDays, {
    message: 'trendFastDays must be less than trendSlowDays',
    path: ['trendFastDays'],
  })
  .refine((value) => value.trendSlowDays <= value.trendLongDays, {
    message: 'trendSlowDays must not exceed trendLongDays',
    path: ['trendSlowDays'],
  });

interface DailyBar {
  day: string;
  high: Decimal;
  low: Decimal;
  close: Decimal;
}

function adaptiveDailyBars(ctx: {
  candles?: BotCandle[];
  history: Array<{ priceUsd: string; capturedAt: Date }>;
  now: Date;
}): DailyBar[] {
  const today = ctx.now.toISOString().slice(0, 10);
  const rows = new Map<string, { high: Decimal; low: Decimal; close: Decimal }>();
  if (ctx.candles && ctx.candles.length > 0) {
    for (const candle of ctx.candles) {
      const day = new Date(candle.date).toISOString().slice(0, 10);
      if (day >= today) continue;
      const high = dec(candle.highUsd);
      const low = dec(candle.lowUsd);
      const close = dec(candle.closeUsd);
      const row = rows.get(day);
      if (!row) {
        rows.set(day, { high, low, close });
      } else {
        row.high = Decimal.max(row.high, high);
        row.low = Decimal.min(row.low, low);
        row.close = close;
      }
    }
  } else {
    for (const sample of ctx.history) {
      const day = sample.capturedAt.toISOString().slice(0, 10);
      if (day >= today) continue;
      const price = dec(sample.priceUsd);
      const row = rows.get(day);
      if (!row) {
        rows.set(day, { high: price, low: price, close: price });
      } else {
        row.high = Decimal.max(row.high, price);
        row.low = Decimal.min(row.low, price);
        row.close = price;
      }
    }
  }
  return [...rows.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([day, row]) => ({ day, ...row }));
}

function adaptiveSma(values: Decimal[], period: number): Decimal | null {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((sum, value) => sum.plus(value), new Decimal(0)).div(period);
}

function adaptiveAtrPct(bars: DailyBar[], period = 14): Decimal {
  if (bars.length < 2) return new Decimal(0);
  const trueRanges: Decimal[] = [];
  for (let index = 1; index < bars.length; index += 1) {
    const bar = bars[index] as DailyBar;
    const previous = bars[index - 1] as DailyBar;
    const highLow = bar.high.minus(bar.low);
    const highClose = bar.high.minus(previous.close).abs();
    const lowClose = bar.low.minus(previous.close).abs();
    trueRanges.push(Decimal.max(highLow, highClose, lowClose));
  }
  const slice = trueRanges.slice(-period);
  if (slice.length === 0) return new Decimal(0);
  const atr = slice.reduce((sum, value) => sum.plus(value), new Decimal(0)).div(slice.length);
  const last = bars[bars.length - 1] as DailyBar;
  return last.close.gt(0) ? atr.div(last.close).mul(100) : new Decimal(0);
}

export const adaptiveRegime: StrategyDefinition = {
  key: 'adaptive_regime',
  version: 1,
  icon: 'layers',
  kind: 'system',
  stateful: true,
  aiEligible: false,
  historySampling: 'hourly',
  candleTimeframe: '1d',
  name: 'Адаптивный режим',
  description:
    'Меняет поведение по режиму: покупает откат в тренде, ведёт трейлингом, быстро выходит при обвале и пережидает в кэше.',
  guide:
    'Стратегия классифицирует дневной режим по трём средним (быстрая, медленная и длинная) и волатильности ATR. В устойчивом росте покупает откат к быстрой средней, добавляет по тренду и ведёт позицию трейлинг-стопом после активации. При падении от максимума выше порога crashDrawdownPct или при стопе по ATR выходит и уходит в cooldown на 24 часа. Если быстрая средняя ниже медленной, стратегия не входит и держит кэш. Recovery — ожидание подтверждения тренда после cooldown. Это long-only стратегия без shorting; она не предсказывает будущее, а реагирует на текущий режим.',
  bestFor:
    'Токены с чередованием трендов и откатов, где важно не ловить обвал и не торговать в боковике.',
  risks:
    'В резком развороте режим определяется с задержкой; crash-стоп ограничивает убыток, но не исключает гэп. При нехватке дневных свечей длинный фильтр ослабляется. Частые развороты могут вызывать серию небольших стопов, поэтому cooldown обязателен.',
  paramFields: [
    {
      key: 'trendFastDays',
      label: 'Быстрый тренд, дней',
      min: 3,
      max: 14,
      step: 1,
      integer: true,
    },
    {
      key: 'trendSlowDays',
      label: 'Медленный тренд, дней',
      min: 14,
      max: 60,
      step: 1,
      integer: true,
    },
    {
      key: 'trendLongDays',
      label: 'Длинный тренд, дней',
      min: 60,
      max: 180,
      step: 5,
      integer: true,
    },
    { key: 'pullbackPct', label: 'Глубина отката', min: 1, max: 10, step: 0.1, unit: '%' },
    { key: 'atrStopMult', label: 'Стоп по ATR', min: 1, max: 5, step: 0.1, unit: '×' },
    { key: 'trailPct', label: 'Трейлинг', min: 1, max: 10, step: 0.1, unit: '%' },
    {
      key: 'crashDrawdownPct',
      label: 'Порог обвала',
      min: 5,
      max: 20,
      step: 0.5,
      unit: '%',
    },
    { key: 'maxAdds', label: 'Добавлений', min: 1, max: 3, step: 1, integer: true },
  ],
  defaultParams: adaptiveRegimeParamsSchema.parse({}),
  parseParams: (value) => adaptiveRegimeParamsSchema.parse(value),
  evaluate: (ctx) => {
    const params = adaptiveRegimeParamsSchema.parse(ctx.params);
    const price = dec(ctx.priceUsd);
    const bars = adaptiveDailyBars(ctx);
    const closes = bars.map((bar) => bar.close);
    const fast = adaptiveSma(closes, params.trendFastDays);
    const slow = adaptiveSma(closes, params.trendSlowDays);
    const long = adaptiveSma(
      closes,
      Math.min(params.trendLongDays, Math.max(params.trendSlowDays, closes.length)),
    );
    const atrPct = Decimal.max(adaptiveAtrPct(bars), new Decimal('0.5'));
    const state = (ctx.state ?? {}) as Record<string, unknown>;
    const previousHwm = typeof state.hwm === 'string' ? dec(state.hwm) : null;
    const previousTrail = typeof state.trailStop === 'string' ? dec(state.trailStop) : null;
    const cooldownUntil =
      typeof state.cooldownUntil === 'string' ? new Date(state.cooldownUntil) : null;
    const inCooldown = cooldownUntil !== null && ctx.now.getTime() < cooldownUntil.getTime();
    const trendUp =
      fast !== null &&
      slow !== null &&
      fast.gt(slow) &&
      (long === null || slow.gt(long)) &&
      price.gt(slow);

    const cooldownState = (): StrategyState => ({
      phase: 'COOLDOWN',
      cooldownUntil: new Date(ctx.now.getTime() + 24 * 3_600_000).toISOString(),
      hwm: price.toFixed(18),
    });
    const sellAndCooldown = (reason: string) => sell(reason, cooldownState());

    if (ctx.position) {
      const avg = dec(ctx.position.avgCostUsd);
      const hwm = previousHwm === null ? price : Decimal.max(previousHwm, price);
      if (
        price.lte(
          avg.mul(new Decimal(1).minus(new Decimal(params.atrStopMult).mul(atrPct).div(100))),
        )
      ) {
        return sellAndCooldown('стоп по ATR');
      }
      if (hwm.gt(0) && hwm.minus(price).div(hwm).mul(100).gte(params.crashDrawdownPct)) {
        return sellAndCooldown('обвал');
      }
      if (fast !== null && slow !== null && fast.lt(slow)) {
        return sellAndCooldown('слом тренда');
      }
      const trailActive = price.gte(avg.mul(1.08)) || previousTrail !== null;
      if (trailActive) {
        const candidateTrail = hwm.mul(1 - params.trailPct / 100);
        const trail =
          previousTrail === null ? candidateTrail : Decimal.max(previousTrail, candidateTrail);
        if (price.lte(trail)) {
          return sellAndCooldown('трейлинг-стоп');
        }
        if (
          trendUp &&
          ctx.buyCount < params.maxAdds &&
          fast !== null &&
          price.lte(fast.mul(1 - params.pullbackPct / 100))
        ) {
          return buy('добавление на откате', {
            phase: 'PULLBACK',
            hwm: hwm.toFixed(18),
            trailStop: trail.toFixed(18),
            cooldownUntil: null,
          });
        }
        return hold('удержание тренда', {
          phase: 'UPTREND',
          hwm: hwm.toFixed(18),
          trailStop: trail.toFixed(18),
          cooldownUntil: null,
        });
      }
      if (
        trendUp &&
        ctx.buyCount < params.maxAdds &&
        fast !== null &&
        price.lte(fast.mul(1 - params.pullbackPct / 100))
      ) {
        return buy('добавление на откате', {
          phase: 'PULLBACK',
          hwm: hwm.toFixed(18),
          trailStop: null,
          cooldownUntil: null,
        });
      }
      return hold('удержание', {
        phase: 'UPTREND',
        hwm: hwm.toFixed(18),
        trailStop: null,
        cooldownUntil: null,
      });
    }

    if (inCooldown) {
      return hold('cooldown', { ...state, phase: 'COOLDOWN' });
    }
    if (!trendUp) {
      return hold('нет тренда', {
        phase: 'DORMANT',
        hwm: price.toFixed(18),
        trailStop: null,
        cooldownUntil: null,
      });
    }
    if (fast !== null && price.lte(fast.mul(1 - params.pullbackPct / 100))) {
      return buy('откат в тренде', {
        phase: 'UPTREND',
        hwm: price.toFixed(18),
        trailStop: null,
        cooldownUntil: null,
      });
    }
    return hold('ожидание отката', {
      phase: 'DORMANT',
      hwm: price.toFixed(18),
      trailStop: null,
      cooldownUntil: null,
    });
  },
};

export const staticLimit: StrategyDefinition = {
  stateful: true,
  key: 'static_limit',
  version: 1,
  icon: 'limit',
  kind: 'system',
  aiEligible: false,
  name: 'Статичный лимит',
  description:
    'Покупает по заданной цене, затем выходит по статическому стопу или тейку и ждёт восстановления цены для нового цикла.',
  guide:
    'Классическая лимитная покупка для бумажного бота с одним токеном. Пока цена выше buyPriceUsd, стратегия ждёт. Когда цена опускается до лимита, она покупает. В позиции выход только по stopPriceUsd или takeProfitPriceUsd; стоп проверяется первым. После выхода стратегия ждёт, пока цена поднимется обратно до buyPriceUsd, и только затем снова разрешает вход. Это защищает от немедленной повторной покупки ниже лимита после стопа. Цены задаются в USD и не зависят от текущей цены.',
  bestFor:
    'Ручной paper-бот с одним токеном, когда владелец хочет заранее задать конкретные уровни входа, стопа и тейка.',
  risks:
    'Если цена не дойдёт до лимита, сделки не будет. После стопа повторный вход произойдёт только после возврата выше лимита, поэтому часть движения может быть пропущена. Гэп ниже стопа исполняется по текущей цене, а не по стоп-цене.',
  paramFields: [
    {
      key: 'buyPriceUsd',
      label: 'Цена покупки',
      hint: 'Абсолютная цена в USD; бот купит при цене не выше этой',
      min: 0,
      max: 1e15,
      unit: '$',
    },
    {
      key: 'stopPriceUsd',
      label: 'Стоп-цена',
      hint: 'Должна быть ниже цены покупки',
      min: 0,
      max: 1e15,
      unit: '$',
    },
    {
      key: 'takeProfitPriceUsd',
      label: 'Тейк-цена',
      hint: 'Должна быть выше цены покупки',
      min: 0,
      max: 1e15,
      unit: '$',
    },
  ],
  defaultParams: staticLimitParamsSchema.parse({}),
  parseParams: (value) => staticLimitParamsSchema.parse(value),
  evaluate: (ctx) => {
    const params = staticLimitParamsSchema.parse(ctx.params);
    const buyPrice = dec(String(params.buyPriceUsd));
    const stopPrice = dec(String(params.stopPriceUsd));
    const takePrice = dec(String(params.takeProfitPriceUsd));
    if (buyPrice.lte(0) || stopPrice.lte(0) || takePrice.lte(0)) {
      return hold('задайте цену покупки, стоп и тейк');
    }

    const price = dec(ctx.priceUsd);
    const phase = readStaticLimitPhase(ctx.state);

    if (ctx.position) {
      if (ctx.stopLossEnabled !== false && price.lte(stopPrice)) {
        return sell('стоп-лосс', { phase: 'waiting' });
      }
      if (ctx.takeProfitEnabled !== false && price.gte(takePrice)) {
        return sell('тейк-профит', { phase: 'waiting' });
      }
      return hold('позиция между стопом и тейком', { phase });
    }

    if (phase === 'waiting') {
      if (price.gte(buyPrice)) {
        return hold('цена вернулась к лимиту', { phase: 'armed' });
      }
      return hold('ожидание восстановления выше лимита', { phase: 'waiting' });
    }

    if (price.lte(buyPrice)) return buy('лимитная покупка', { phase: 'armed' });
    return hold('ожидание цены покупки', { phase: 'armed' });
  },
};

export const strategyDefinitions = [
  momentumBreakout,
  meanReversion,
  gridRange,
  trendPullback,
  dcaDip,
  trailingStop,
  crashProtectedGrid,
  donchianBreakout,
  bollingerReversion,
  squeezeBreakout,
  failedBreakout,
  dailyAverage,
  adaptiveRegime,
  staticLimit,
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
