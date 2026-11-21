import { parentPort } from 'node:worker_threads';
import type { AiSearchTimeframe } from '@nexter/contracts';
import { evaluateVariantFolds } from './ai-search.evaluate';
import type { SearchFold, SearchVariant } from './ai-search.helpers';

interface WorkerJob {
  variants: SearchVariant[];
  folds: SearchFold[];
  timeframe: AiSearchTimeframe;
}

if (!parentPort) {
  throw new Error('AI search worker must run inside a worker thread');
}

const port = parentPort;

port.on('message', (message: WorkerJob) => {
  try {
    const results = [];
    for (const [index, variant] of message.variants.entries()) {
      results.push(evaluateVariantFolds(variant, message.folds, message.timeframe));
      if ((index + 1) % 25 === 0) {
        port.postMessage({ type: 'progress', evaluated: index + 1 });
      }
    }
    port.postMessage({ type: 'done', results });
  } catch (error) {
    port.postMessage({
      type: 'error',
      error: error instanceof Error ? error.message : 'search worker failed',
    });
  }
});
