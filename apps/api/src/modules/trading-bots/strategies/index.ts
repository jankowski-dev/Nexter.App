import { z } from 'zod';
import { Decimal } from 'decimal.js';
import {
  bollingerBands,
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
      if (price.gte(avg.mul(1 + params.takeProfitPct / 100))) return sell('тейк-профит');
      if (price.lte(avg.mul(1 - params.stopLossPct / 100))) return sell('стоп-лосс');

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
      if (price.gte(avg.mul(1 + params.takeProfitPct / 100))) return sell('тейк-профит');
      if (price.lte(avg.mul(1 - params.stopLossPct / 100))) return sell('стоп-лосс');
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
    const bands = bollingerBands(ctx.history, params.period, params.stdDev);

    if (ctx.position) {
      const avg = dec(ctx.position.avgCostUsd);
      if (price.gte(avg.mul(1 + params.takeProfitPct / 100))) return sell('тейк-профит');
      if (price.lte(avg.mul(1 - params.stopLossPct / 100))) return sell('стоп-лосс');
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
      if (price.gte(avg.mul(1 + params.takeProfitPct / 100))) {
        return sell('тейк-профит', { breakdownLevel: null });
      }
      if (price.lte(avg.mul(1 - params.stopLossPct / 100))) {
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
