import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { gzipSync, gunzipSync } from 'node:zlib';
import {
  sandboxDecisionSettingsSchema,
  sandboxPaperSettingsSchema,
  SANDBOX_TIMEFRAME,
} from '@nexter/contracts';
import {
  runPaperFromCandles,
  sha256Hex,
  snapshotCandles,
  stableStringify,
  type Candle,
  type PaperRunSettings,
  type RunReport,
  type SandboxDecisionSettings,
} from '@nexter/sandbox-core';

/** DI token for the replay executor used by `SandboxReplayWorkerService`. */
export const SANDBOX_REPLAY_EXECUTOR = Symbol('SANDBOX_REPLAY_EXECUTOR');

export type ReplayExecutionErrorCode =
  | 'REPLAY_DATA_INSUFFICIENT'
  | 'REPLAY_STATE_INVALID'
  | 'REPLAY_SNAPSHOT_INVALID'
  | 'REPLAY_WORKER_FAILED'
  | 'REPLAY_WORKER_EXIT'
  | 'REPLAY_WORKER_TIMEOUT';

/** Typed failure of the replay input/staging/execution path. */
export class ReplayExecutionError extends Error {
  constructor(
    readonly code: ReplayExecutionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ReplayExecutionError';
  }
}

/**
 * One historical replay job.
 *
 * This is deliberately expressed in `@nexter/sandbox-core` terms only: the
 * stored contract JSON is validated and mapped by the caller, so the core never
 * imports contract types and the worker-thread payload stays JSON-safe.
 */
export interface ReplayExecutionInput {
  readonly runId: string;
  readonly seed: number;
  readonly configVersion: string;
  readonly dataSnapshotId: string;
  readonly tokenIds: readonly string[];
  readonly candles: readonly Candle[];
  readonly settings: SandboxDecisionSettings;
  readonly paper: PaperRunSettings;
  readonly initialCapitalUsd: string;
  /** First evaluation candle **open**; prefix candles are lookback history. */
  readonly evaluateFrom: number;
}

export interface ReplayExecutor {
  run(input: ReplayExecutionInput): Promise<RunReport>;
}

/** Executes the replay on the caller's event loop; used by tests/dev. */
export class InlineReplayExecutor implements ReplayExecutor {
  async run(input: ReplayExecutionInput): Promise<RunReport> {
    const { report } = await runPaperFromCandles(input);
    return report;
  }
}

export interface ReplayWorkerMessage {
  readonly report?: RunReport;
  readonly error?: string;
}

/** Minimal worker surface so the executor can be unit-tested without a thread. */
export interface ReplayWorkerLike {
  on(event: 'message' | 'error' | 'exit', listener: (value: unknown) => void): unknown;
  postMessage(message: unknown): void;
  terminate(): Promise<number> | number | void;
}

export type ReplayWorkerFactory = (workerPath: string) => ReplayWorkerLike;

export interface WorkerThreadReplayExecutorOptions {
  readonly workerPath?: string;
  readonly createWorker?: ReplayWorkerFactory;
  /** Hard bound for one replay; the design expects 1–2 minutes for 3×180d. */
  readonly timeoutMs?: number;
}

/** Default 15-minute bound; a bounded run cannot hang the single worker slot. */
const DEFAULT_REPLAY_TIMEOUT_MS = 15 * 60_000;

/** Compiled worker-thread entrypoint (Nest emits the sibling `.js`). */
export function defaultReplayWorkerPath(): string {
  return path.join(__dirname, 'sandbox-replay.worker.js');
}

function defaultReplayWorkerFactory(workerPath: string): ReplayWorkerLike {
  return new Worker(workerPath) as unknown as ReplayWorkerLike;
}

/**
 * Runs one replay in a `worker_threads` worker so the API event loop and the
 * live paper runner stay responsive during a CPU-heavy 180-day replay.
 *
 * The worker posts `{ report }` and closes. Any `error` event, a non-zero exit
 * or an exit without a report rejects; the worker is always terminated once the
 * promise settles. A timeout is treated as a failure rather than a hang.
 */
export class WorkerThreadReplayExecutor implements ReplayExecutor {
  private readonly workerPath: string;
  private readonly createWorker: ReplayWorkerFactory;
  private readonly timeoutMs: number;

  constructor(options: WorkerThreadReplayExecutorOptions = {}) {
    this.workerPath = options.workerPath ?? defaultReplayWorkerPath();
    this.createWorker = options.createWorker ?? defaultReplayWorkerFactory;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_REPLAY_TIMEOUT_MS;
  }

  run(input: ReplayExecutionInput): Promise<RunReport> {
    let worker: ReplayWorkerLike;
    try {
      worker = this.createWorker(this.workerPath);
    } catch (error) {
      return Promise.reject(
        new ReplayExecutionError(
          'REPLAY_WORKER_FAILED',
          `Replay worker could not start: ${error instanceof Error ? error.message : 'unknown error'}`,
        ),
      );
    }

    return new Promise<RunReport>((resolve, reject) => {
      let settled = false;
      let timer: NodeJS.Timeout | null = null;
      const settle = (complete: () => void): void => {
        if (settled) return;
        settled = true;
        if (timer !== null) clearTimeout(timer);
        void Promise.resolve()
          .then(() => worker.terminate())
          .catch(() => undefined);
        complete();
      };

      timer = setTimeout(() => {
        settle(() =>
          reject(
            new ReplayExecutionError(
              'REPLAY_WORKER_TIMEOUT',
              `Replay worker exceeded ${this.timeoutMs} ms`,
            ),
          ),
        );
      }, this.timeoutMs);
      timer.unref();

      worker.on('message', (message) => {
        const payload = message as ReplayWorkerMessage | null;
        if (payload !== null && typeof payload === 'object' && payload.report !== undefined) {
          settle(() => resolve(payload.report as RunReport));
          return;
        }
        if (payload !== null && typeof payload === 'object' && typeof payload.error === 'string') {
          settle(() =>
            reject(new ReplayExecutionError('REPLAY_WORKER_FAILED', String(payload.error))),
          );
          return;
        }
        settle(() =>
          reject(
            new ReplayExecutionError(
              'REPLAY_WORKER_FAILED',
              'Replay worker returned an unexpected message',
            ),
          ),
        );
      });
      worker.on('error', (error) => {
        settle(() =>
          reject(
            error instanceof Error
              ? error
              : new ReplayExecutionError('REPLAY_WORKER_FAILED', String(error)),
          ),
        );
      });
      worker.on('exit', (code) => {
        settle(() =>
          reject(
            new ReplayExecutionError(
              'REPLAY_WORKER_EXIT',
              `Replay worker exited with code ${String(code)} before returning a report`,
            ),
          ),
        );
      });

      try {
        worker.postMessage(input);
      } catch (error) {
        settle(() =>
          reject(
            new ReplayExecutionError(
              'REPLAY_WORKER_FAILED',
              `Replay worker rejected its input: ${error instanceof Error ? error.message : 'unknown error'}`,
            ),
          ),
        );
      }
    });
  }
}

/** One persisted, gzipped input snapshot and its deterministic identities. */
export interface ReplayCandleSnapshot {
  /** Validated candles sorted by open time, then token id. */
  readonly candles: Candle[];
  /** Canonical uncompressed JSON used for the SHA-256. */
  readonly json: string;
  readonly gzip: Buffer;
  /** SHA-256 of `json`; equals `dataSnapshotId` by construction. */
  readonly hash: string;
  /** Deterministic identity of the full input candle set. */
  readonly dataSnapshotId: string;
}

/**
 * Validates, sorts and snapshots the exact replay input.
 *
 * The snapshot covers prefix **and** evaluation candles, so a refreshed
 * `sandbox_candles` store cannot change a stored replay's input. The gzip bytes
 * are what `sandbox_replays.candle_snapshot` persists; the SHA-256 is over the
 * uncompressed canonical JSON.
 */
export function snapshotReplayCandles(candles: readonly Candle[]): ReplayCandleSnapshot {
  const snapshot = snapshotCandles(candles);
  const json = stableStringify(snapshot.candles);
  const hash = sha256Hex(json);
  return {
    candles: [...snapshot.candles],
    json,
    gzip: gzipSync(Buffer.from(json, 'utf8')),
    hash,
    dataSnapshotId: snapshot.id,
  };
}

/** Reuses a persisted snapshot; a corrupt or mismatched snapshot fails closed. */
export function decodeReplaySnapshot(
  gzip: Buffer,
  expectedHash: string,
  expectedDataSnapshotId: string | null,
): ReplayCandleSnapshot {
  let json: string;
  let parsed: unknown;
  try {
    json = gunzipSync(gzip).toString('utf8');
    parsed = JSON.parse(json) as unknown;
  } catch (error) {
    throw new ReplayExecutionError(
      'REPLAY_SNAPSHOT_INVALID',
      `Stored replay snapshot cannot be decoded: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }

  if (!Array.isArray(parsed)) {
    throw new ReplayExecutionError(
      'REPLAY_SNAPSHOT_INVALID',
      'Stored replay snapshot is not a candle array',
    );
  }
  if (sha256Hex(json) !== expectedHash) {
    throw new ReplayExecutionError(
      'REPLAY_SNAPSHOT_INVALID',
      'Stored replay snapshot hash does not match its contents',
    );
  }

  const snapshot = snapshotReplayCandles(parsed as Candle[]);
  if (snapshot.dataSnapshotId !== expectedHash) {
    throw new ReplayExecutionError(
      'REPLAY_SNAPSHOT_INVALID',
      'Stored replay snapshot identity does not match its contents',
    );
  }
  if (expectedDataSnapshotId !== null && expectedDataSnapshotId !== snapshot.dataSnapshotId) {
    throw new ReplayExecutionError(
      'REPLAY_SNAPSHOT_INVALID',
      'Stored replay data snapshot id does not match its contents',
    );
  }

  return { ...snapshot, gzip };
}

/**
 * Fails closed when the stored window cannot produce a replay.
 *
 * The create/preflight path already blocks missing coverage; this guard covers
 * a changed/emptied candle store between queue and claim without inventing
 * candles or running a partial series silently.
 */
export function assertReplayCandles(input: {
  readonly tokenIds: readonly string[];
  readonly candles: readonly Candle[];
  readonly fromTime: number;
  readonly toTime: number;
}): void {
  if (input.toTime <= input.fromTime) {
    throw new ReplayExecutionError(
      'REPLAY_DATA_INSUFFICIENT',
      'Replay evaluation window has no positive length',
    );
  }
  if (input.candles.length === 0) {
    throw new ReplayExecutionError(
      'REPLAY_DATA_INSUFFICIENT',
      'No candles are available for the replay window',
    );
  }

  const present = new Set(input.candles.map((candle) => candle.tokenId));
  for (const tokenId of input.tokenIds) {
    if (!present.has(tokenId)) {
      throw new ReplayExecutionError(
        'REPLAY_DATA_INSUFFICIENT',
        `No candles are available for ${tokenId} in the replay window`,
      );
    }
  }

  const outsideWindow = input.candles.some(
    (candle) =>
      !Number.isSafeInteger(candle.openTime) ||
      candle.openTime >= input.toTime ||
      candle.timeframe !== SANDBOX_TIMEFRAME,
  );
  if (outsideWindow) {
    throw new ReplayExecutionError(
      'REPLAY_DATA_INSUFFICIENT',
      'Replay candles are outside the half-open 1h evaluation window',
    );
  }

  const evaluated = input.candles.some(
    (candle) => candle.openTime >= input.fromTime && candle.openTime < input.toTime,
  );
  if (!evaluated) {
    throw new ReplayExecutionError(
      'REPLAY_DATA_INSUFFICIENT',
      'No candle opens at or after the replay evaluation start',
    );
  }
}

/** Validates frozen decision settings and maps them to the core shape. */
export function toCoreDecisionSettings(raw: Record<string, unknown>): SandboxDecisionSettings {
  const parsed = sandboxDecisionSettingsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ReplayExecutionError(
      'REPLAY_STATE_INVALID',
      'Сохранённая конфигурация прогона повреждена',
    );
  }
  const settings = parsed.data;
  return {
    timeframe: settings.timeframe,
    maxPositions: settings.maxPositions,
    maxTokenExposurePct: settings.maxTokenExposurePct,
    maxStrategyExposurePct: settings.maxStrategyExposurePct,
    cashBufferPct: settings.cashBufferPct,
    dailyLossLimitPct: settings.dailyLossLimitPct,
    maxDrawdownPct: settings.maxDrawdownPct,
    perTradeRiskPct: settings.perTradeRiskPct,
    minOrderUsd: settings.minOrderUsd,
    liquidityCapPct: settings.liquidityCapPct,
    defaultStopPct: settings.defaultStopPct,
    regime: { ...settings.regime },
    strategies: {
      trendPullback: { ...settings.strategies.trendPullback },
      rangeReversion: { ...settings.strategies.rangeReversion },
      recovery: { ...settings.strategies.recovery },
    },
  };
}

/** Validates frozen paper settings and maps them to the core shape. */
export function toCorePaperSettings(raw: Record<string, unknown>): PaperRunSettings {
  const parsed = sandboxPaperSettingsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ReplayExecutionError(
      'REPLAY_STATE_INVALID',
      'Сохранённая конфигурация прогона повреждена',
    );
  }
  return { ...parsed.data };
}
