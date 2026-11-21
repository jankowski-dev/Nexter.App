import { existsSync } from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { AiSearchTimeframe } from '@nexter/contracts';
import type { VariantFoldEvaluation } from './ai-search.evaluate';
import { splitVariants, type SearchFold, type SearchVariant } from './ai-search.helpers';

export interface WorkerLike {
  on(event: 'message' | 'error' | 'exit', listener: (value: unknown) => void): unknown;
  postMessage(message: unknown): void;
  terminate(): Promise<number> | number | void;
}

export type WorkerFactory = (workerPath: string) => WorkerLike;

export interface WorkerPoolOptions {
  workerCount: number;
  workerPath: string;
  createWorker?: WorkerFactory;
  onProgress?: (evaluated: number) => void;
  control?: { cancelled: boolean };
  cancelPollMs?: number;
}

export interface WorkerPoolResult {
  results: VariantFoldEvaluation[];
  cancelled: boolean;
}

export function defaultWorkerPath(): string {
  return path.join(__dirname, 'ai-search.worker.js');
}

function defaultWorkerFactory(workerPath: string): WorkerLike {
  return new Worker(workerPath) as unknown as WorkerLike;
}

export function shouldUseWorkers(
  env: Record<string, string | undefined>,
  workerCount: number,
  workerExists: boolean,
): boolean {
  return env.NODE_ENV !== 'test' && workerCount > 1 && workerExists;
}

export function runWorkerPool(
  variants: SearchVariant[],
  folds: SearchFold[],
  timeframe: AiSearchTimeframe,
  options: WorkerPoolOptions,
): Promise<WorkerPoolResult> {
  const chunks = splitVariants(variants, options.workerCount);
  if (chunks.length === 0) return Promise.resolve({ results: [], cancelled: false });

  const factory = options.createWorker ?? defaultWorkerFactory;
  const workers: WorkerLike[] = [];
  const resolvers: Array<(value: VariantFoldEvaluation[]) => void> = [];
  const progress = new Array<number>(chunks.length).fill(0);
  let cancelled = false;

  const reportProgress = () => {
    options.onProgress?.(progress.reduce((total, value) => total + value, 0));
  };

  const cancelTimer = setInterval(() => {
    if (!options.control?.cancelled || cancelled) return;
    cancelled = true;
    for (const worker of workers) void worker.terminate();
    for (const resolve of resolvers) resolve([]);
  }, options.cancelPollMs ?? 250);

  return Promise.all(
    chunks.map(
      (chunk, index) =>
        new Promise<VariantFoldEvaluation[]>((resolve, reject) => {
          resolvers[index] = resolve;
          let done = false;
          const worker = factory(options.workerPath);
          workers.push(worker);
          const finish = (value: VariantFoldEvaluation[]) => {
            if (done) return;
            done = true;
            resolve(value);
          };
          const fail = (error: Error) => {
            if (done) return;
            done = true;
            reject(error);
          };

          worker.on('message', (message) => {
            const payload = message as {
              type?: string;
              evaluated?: number;
              results?: VariantFoldEvaluation[];
              error?: string;
            };
            if (payload.type === 'progress') {
              progress[index] = payload.evaluated ?? 0;
              reportProgress();
              return;
            }
            if (payload.type === 'done') {
              progress[index] = chunk.length;
              reportProgress();
              finish(payload.results ?? []);
              return;
            }
            if (payload.type === 'error') {
              fail(new Error(payload.error ?? 'search worker failed'));
            }
          });
          worker.on('error', (error) =>
            fail(error instanceof Error ? error : new Error(String(error))),
          );
          worker.on('exit', (code) => {
            if (!done && !cancelled) {
              fail(new Error(`search worker exited with code ${String(code)}`));
            }
          });
          worker.postMessage({ variants: chunk, folds, timeframe });
        }),
    ),
  )
    .then((results) => ({ results: results.flat(), cancelled }))
    .finally(() => {
      clearInterval(cancelTimer);
      for (const worker of workers) {
        try {
          void worker.terminate();
        } catch {
          // Already terminated.
        }
      }
    });
}

export function workerFileExists(workerPath = defaultWorkerPath()): boolean {
  return existsSync(workerPath);
}
