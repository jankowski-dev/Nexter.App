import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const dist = path.resolve('apps/api/dist');
const { buildSearchFolds, generateSearchVariants, minTradesFor } = require(
  `${dist}/modules/ai-trading/ai-search.helpers.js`,
);
const { screenVariant } = require(`${dist}/modules/ai-trading/ai-search.screen.js`);
const { runWorkerPool } = require(`${dist}/modules/ai-trading/ai-search.pool.js`);
const { evaluateVariantFolds } = require(`${dist}/modules/ai-trading/ai-search.evaluate.js`);
const { strategyDefinitions } = require(`${dist}/modules/trading-bots/strategies/index.js`);

const total = Number(process.env.PILOT_VARIANTS ?? 10000);
const workers = Number(process.env.PILOT_WORKERS ?? 4);
const fullLimit = Number(process.env.PILOT_FULL ?? 5000);

let price = 100;
const candles = [];
const start = Date.parse('2026-05-01T00:00:00Z');
for (let index = 0; index < 4320; index += 1) {
  price = Math.max(
    1,
    price *
      (1 + (Math.sin(index / 37) + Math.cos(index / 113)) * 0.002 + (Math.random() - 0.5) * 0.01),
  );
  const date = new Date(start + index * 3_600_000).toISOString().slice(0, 10);
  candles.push({
    date,
    openUsd: price.toFixed(8),
    highUsd: (price * 1.003).toFixed(8),
    lowUsd: (price * 0.997).toFixed(8),
    closeUsd: price.toFixed(8),
    volumeUsd: '1000000',
  });
}

const folds = buildSearchFolds(candles, '1h');
const workerPath = path.resolve(`${dist}/modules/ai-trading/ai-search.worker.js`);
const t0 = performance.now();
const variants = generateSearchVariants(strategyDefinitions, total, 7);
const t1 = performance.now();
const screenReasons = {};
const screened = [];
for (const variant of variants) {
  const result = screenVariant(variant, folds.folds);
  if (result.ok) screened.push(variant);
  else screenReasons[result.reason] = (screenReasons[result.reason] ?? 0) + 1;
}
const t2 = performance.now();
const coarse = await runWorkerPool(screened, [folds.folds[0]], '1h', {
  workerCount: workers,
  workerPath,
});
const t3 = performance.now();
const coarseRows = screened
  .map((variant, index) => ({ variant, result: coarse.results[index] }))
  .filter((row) => row.result?.aggregate && row.result.aggregate.trades >= 1)
  .sort(
    (left, right) =>
      Number(right.result.aggregate.policyScore) - Number(left.result.aggregate.policyScore),
  );
const fullVariants = coarseRows.slice(0, fullLimit).map((row) => row.variant);
const t4 = performance.now();
const full = await runWorkerPool(fullVariants, folds.folds, '1h', {
  workerCount: workers,
  workerPath,
});
const t5 = performance.now();
const fullRows = fullVariants
  .map((variant, index) => ({ variant, result: full.results[index] }))
  .filter((row) => row.result?.aggregate)
  .sort(
    (left, right) =>
      Number(right.result.aggregate.policyScore) - Number(left.result.aggregate.policyScore),
  );
const top = fullRows.slice(0, 10);
const minTrades = minTradesFor(folds.folds.length);
const holdoutFold = {
  candles: [...folds.holdoutWarmup, ...folds.holdout],
  warmupCandles: folds.holdoutWarmupCandles,
};
const holdoutResults = top.map(({ variant }) => {
  const result = evaluateVariantFolds(variant, [holdoutFold], '1h');
  return { variant, aggregate: result.aggregate };
});
const recommended = holdoutResults.filter(
  (item) =>
    item.aggregate &&
    Number(item.aggregate.oosMedianReturnPct) > 0 &&
    Number(item.aggregate.maxDrawdownPct) <= 20,
);

console.log(
  JSON.stringify(
    {
      totalRequested: total,
      generated: variants.length,
      hardRejected: variants.length - screened.length,
      screenReasons,
      coarseSurvivors: coarseRows.length,
      coarseSurvivorPct: ((coarseRows.length / Math.max(1, screened.length)) * 100).toFixed(2),
      fullEvaluated: fullRows.length,
      fullPassMinTrades: fullRows.filter((row) => row.result.aggregate.trades >= minTrades).length,
      holdoutTested: holdoutResults.length,
      recommendations: recommended.length,
      timingsMs: {
        generate: Math.round(t1 - t0),
        hardScreen: Math.round(t2 - t1),
        coarseOneFold: Math.round(t3 - t2),
        fullEightFolds: Math.round(t5 - t4),
      },
      workers,
    },
    null,
    2,
  ),
);
