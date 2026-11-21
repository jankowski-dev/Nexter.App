import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const dist = path.resolve('apps/api/dist');
const { buildSearchFolds, generateSearchVariants } = require(
  `${dist}/modules/ai-trading/ai-search.helpers.js`,
);
const { screenVariant } = require(`${dist}/modules/ai-trading/ai-search.screen.js`);
const { runWorkerPool } = require(`${dist}/modules/ai-trading/ai-search.pool.js`);
const { strategyDefinitions } = require(`${dist}/modules/trading-bots/strategies/index.js`);

const total = Number(process.env.PILOT_VARIANTS ?? 50000);
const workers = Number(process.env.PILOT_WORKERS ?? 4);

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
const t0 = performance.now();
const variants = generateSearchVariants(strategyDefinitions, total, 7);
const t1 = performance.now();
const reasons = {};
let screened = [];
for (const variant of variants) {
  const result = screenVariant(variant, folds.folds);
  if (result.ok) screened.push(variant);
  else reasons[result.reason] = (reasons[result.reason] ?? 0) + 1;
}
const t2 = performance.now();
const workerPath = path.resolve(`${dist}/modules/ai-trading/ai-search.worker.js`);
const pool = await runWorkerPool(screened, [folds.folds[0]], '1h', {
  workerCount: workers,
  workerPath,
});
const t3 = performance.now();
const survivors = pool.results.filter(
  (result) => result.aggregate && result.aggregate.trades >= 1,
).length;
console.log(
  JSON.stringify(
    {
      totalRequested: total,
      generated: variants.length,
      screened: screened.length,
      screenReasons: reasons,
      oneFoldSurvivors: survivors,
      oneFoldSurvivorPct: ((survivors / Math.max(1, screened.length)) * 100).toFixed(2),
      timingsMs: {
        generate: Math.round(t1 - t0),
        screen: Math.round(t2 - t1),
        oneFold: Math.round(t3 - t2),
      },
      workers,
      cancelled: pool.cancelled,
    },
    null,
    2,
  ),
);
