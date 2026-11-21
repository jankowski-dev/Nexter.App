import { describe, expect, it } from 'vitest';
import type { VariantFoldEvaluation } from './ai-search.evaluate';
import { runWorkerPool, shouldUseWorkers, type WorkerLike } from './ai-search.pool';

const evaluation: VariantFoldEvaluation = {
  unknownStrategy: false,
  aggregate: {
    oosMedianReturnPct: '1.00',
    oosMeanReturnPct: '0.50',
    oosWorstReturnPct: '-1.00',
    maxDrawdownPct: '2.00',
    trades: 10,
    positiveFolds: 5,
    stabilityPct: '62.50',
    policyScore: '0.0000',
  },
};

type Behavior = 'done' | 'error' | 'hang';

function fakeFactory(behavior: Behavior) {
  return () => {
    const listeners: Record<string, (value: unknown) => void> = {};
    const worker: WorkerLike = {
      on(event, listener) {
        listeners[event] = listener as (value: unknown) => void;
      },
      postMessage(message) {
        const { variants } = message as { variants: unknown[] };
        if (behavior === 'hang') return;
        queueMicrotask(() => {
          if (behavior === 'error') {
            listeners.error?.(new Error('worker boom'));
            return;
          }
          listeners.message?.({ type: 'progress', evaluated: variants.length });
          listeners.message?.({
            type: 'done',
            results: variants.map(() => evaluation),
          });
        });
      },
      terminate() {
        return Promise.resolve(0);
      },
    };
    return worker;
  };
}

const variants = Array.from({ length: 4 }, (_, index) => ({
  strategyKey: 'momentum_breakout',
  params: { index },
}));

describe('runWorkerPool', () => {
  it('distributes variants and aggregates worker results', async () => {
    const progress: number[] = [];
    const result = await runWorkerPool(variants, [], '1h', {
      workerCount: 2,
      workerPath: 'fake-worker.js',
      createWorker: fakeFactory('done'),
      onProgress: (value) => progress.push(value),
    });

    expect(result.cancelled).toBe(false);
    expect(result.results).toHaveLength(4);
    expect(progress.at(-1)).toBe(4);
  });

  it('rejects when a worker fails', async () => {
    await expect(
      runWorkerPool(variants, [], '1h', {
        workerCount: 2,
        workerPath: 'fake-worker.js',
        createWorker: fakeFactory('error'),
      }),
    ).rejects.toThrow('worker boom');
  });

  it('terminates workers and returns cancelled when the control flips', async () => {
    const control = { cancelled: false };
    const promise = runWorkerPool(variants, [], '1h', {
      workerCount: 2,
      workerPath: 'fake-worker.js',
      createWorker: fakeFactory('hang'),
      control,
      cancelPollMs: 5,
    });
    setTimeout(() => {
      control.cancelled = true;
    }, 10);
    const result = await promise;
    expect(result.cancelled).toBe(true);
    expect(result.results).toEqual([]);
  });
});

describe('shouldUseWorkers', () => {
  it('requires production, more than one worker and a compiled file', () => {
    expect(shouldUseWorkers({ NODE_ENV: 'test' }, 4, true)).toBe(false);
    expect(shouldUseWorkers({}, 1, true)).toBe(false);
    expect(shouldUseWorkers({}, 4, false)).toBe(false);
    expect(shouldUseWorkers({}, 4, true)).toBe(true);
  });
});
