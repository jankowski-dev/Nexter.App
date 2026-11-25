import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { transform } from '@swc/core';
import { afterAll, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PAPER_SETTINGS,
  DEFAULT_SETTINGS,
  paperConfigVersion,
  type Candle,
  type PaperRunConfig,
  type RunReport,
} from '@nexter/sandbox-core';
import {
  assertReplayCandles,
  decodeReplaySnapshot,
  InlineReplayExecutor,
  ReplayExecutionError,
  snapshotReplayCandles,
  toCoreDecisionSettings,
  toCorePaperSettings,
  WorkerThreadReplayExecutor,
  type ReplayExecutionInput,
  type ReplayWorkerLike,
} from './sandbox-replay.executor';

const RUN = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'bsc:0x1111111111111111111111111111111111111111';
const START = Date.UTC(2026, 0, 1);
const HOUR = 3_600_000;
const EVALUATE_INDEX = 20;
const BAR_COUNT = 60;

function candles(count = BAR_COUNT): Candle[] {
  let previous = 100;
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + index * 0.1;
    const open = previous;
    previous = close;
    return {
      tokenId: TOKEN,
      timeframe: '1h',
      openTime: START + index * HOUR,
      open: open.toFixed(8),
      high: (Math.max(open, close) * 1.001).toFixed(8),
      low: (Math.min(open, close) * 0.999).toFixed(8),
      close: close.toFixed(8),
      volumeUsd: '100000',
    };
  });
}

function replayInput(overrides: Partial<ReplayExecutionInput> = {}): ReplayExecutionInput {
  const series = candles();
  const snapshot = snapshotReplayCandles(series);
  const paper = DEFAULT_PAPER_SETTINGS;
  const config: PaperRunConfig = {
    runId: RUN,
    seed: 7,
    timeframe: '1h',
    tokenIds: [TOKEN],
    initialCapitalUsd: '1000.00',
    ...paper,
  };

  return {
    runId: RUN,
    seed: 7,
    configVersion: paperConfigVersion(config),
    dataSnapshotId: snapshot.dataSnapshotId,
    tokenIds: [TOKEN],
    candles: snapshot.candles,
    settings: DEFAULT_SETTINGS,
    paper,
    initialCapitalUsd: '1000.00',
    evaluateFrom: series[EVALUATE_INDEX]?.openTime as number,
    ...overrides,
  };
}

function reportStub(): RunReport {
  return {
    runId: RUN,
    dataSnapshotId: 'a'.repeat(64),
    reportHash: 'b'.repeat(64),
  } as unknown as RunReport;
}

interface StubWorker extends ReplayWorkerLike {
  readonly listeners: Map<string, (value: unknown) => void>;
  emit(event: 'message' | 'error' | 'exit', value: unknown): void;
}

function stubWorker(): StubWorker {
  const listeners = new Map<string, (value: unknown) => void>();
  return {
    listeners,
    on(event, listener) {
      listeners.set(event, listener);
      return this;
    },
    emit(event, value) {
      listeners.get(event)?.(value);
    },
    postMessage: vi.fn((_message: unknown): void => undefined),
    terminate: vi.fn((): void => undefined),
  };
}

describe('snapshotReplayCandles', () => {
  it('is deterministic, gzips the exact input and hashes the uncompressed JSON', () => {
    const series = candles();
    const first = snapshotReplayCandles(series);
    const second = snapshotReplayCandles([...series].reverse());

    expect(first.dataSnapshotId).toBe(second.dataSnapshotId);
    expect(first.hash).toBe(first.dataSnapshotId);
    expect(first.json).toBe(second.json);
    expect(first.gzip.equals(second.gzip)).toBe(true);

    const decoded = decodeReplaySnapshot(first.gzip, first.hash, first.dataSnapshotId);
    expect(decoded.candles).toHaveLength(series.length);
    expect(decoded.dataSnapshotId).toBe(first.dataSnapshotId);
  });

  it('rejects a persisted snapshot whose hash does not match its contents', () => {
    const snapshot = snapshotReplayCandles(candles());

    expect(() => decodeReplaySnapshot(snapshot.gzip, 'f'.repeat(64), null)).toThrow(
      ReplayExecutionError,
    );
    expect(() => decodeReplaySnapshot(snapshot.gzip, snapshot.hash, 'f'.repeat(64))).toThrow(
      ReplayExecutionError,
    );
  });
});

describe('assertReplayCandles', () => {
  it('accepts the half-open window and blocks missing tokens or an empty evaluation', () => {
    const series = candles();
    const fromTime = series[EVALUATE_INDEX]?.openTime as number;
    const toTime = (series[series.length - 1]?.openTime as number) + HOUR;

    expect(() =>
      assertReplayCandles({ tokenIds: [TOKEN], candles: series, fromTime, toTime }),
    ).not.toThrow();
    expect(() =>
      assertReplayCandles({ tokenIds: ['other'], candles: series, fromTime, toTime }),
    ).toThrow(ReplayExecutionError);
    expect(() =>
      assertReplayCandles({ tokenIds: [TOKEN], candles: series, fromTime: toTime, toTime }),
    ).toThrow(ReplayExecutionError);
  });
});

describe('toCoreDecisionSettings / toCorePaperSettings', () => {
  it('maps the stored contract JSON onto the core shapes', () => {
    const settings = toCoreDecisionSettings(DEFAULT_SETTINGS as unknown as Record<string, unknown>);
    const paper = toCorePaperSettings(DEFAULT_PAPER_SETTINGS as unknown as Record<string, unknown>);

    expect(settings.regime).toEqual(DEFAULT_SETTINGS.regime);
    expect(settings.strategies).toEqual(DEFAULT_SETTINGS.strategies);
    expect(paper).toEqual(DEFAULT_PAPER_SETTINGS);
  });

  it('fails closed on a corrupt stored config', () => {
    expect(() => toCoreDecisionSettings({ timeframe: '1h' })).toThrow(ReplayExecutionError);
    expect(() => toCorePaperSettings({ feeBps: 25 })).toThrow(ReplayExecutionError);
  });
});

describe('InlineReplayExecutor', () => {
  it('runs the core pipeline and starts the report at evaluateFrom', async () => {
    const input = replayInput();
    const report = await new InlineReplayExecutor().run(input);

    expect(report.runId).toBe(RUN);
    expect(report.dataSnapshotId).toBe(input.dataSnapshotId);
    expect(report.period.bars).toBe(BAR_COUNT - EVALUATE_INDEX);
    expect(report.period.firstBar).toBe(input.evaluateFrom + HOUR);
    expect(report.reportHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('WorkerThreadReplayExecutor', () => {
  it('posts the input and resolves the worker report', async () => {
    const worker = stubWorker();
    const report = reportStub();
    const executor = new WorkerThreadReplayExecutor({
      workerPath: 'sandbox-replay.worker.js',
      createWorker: () => worker,
      timeoutMs: 5_000,
    });
    const input = replayInput();

    const pending = executor.run(input);
    expect(worker.postMessage).toHaveBeenCalledWith(input);
    worker.emit('message', { report });

    await expect(pending).resolves.toBe(report);
    expect(worker.terminate).toHaveBeenCalled();
  });

  it('rejects on a worker error and on an exit without a report', async () => {
    const failed = stubWorker();
    const failedExecutor = new WorkerThreadReplayExecutor({
      workerPath: 'sandbox-replay.worker.js',
      createWorker: () => failed,
      timeoutMs: 5_000,
    });
    const pendingFailure = failedExecutor.run(replayInput());
    failed.emit('error', new Error('worker crashed'));
    await expect(pendingFailure).rejects.toThrow('worker crashed');

    const exited = stubWorker();
    const exitedExecutor = new WorkerThreadReplayExecutor({
      workerPath: 'sandbox-replay.worker.js',
      createWorker: () => exited,
      timeoutMs: 5_000,
    });
    const pendingExit = exitedExecutor.run(replayInput());
    exited.emit('exit', 1);
    await expect(pendingExit).rejects.toMatchObject({ code: 'REPLAY_WORKER_EXIT' });
  });

  it('rejects when the worker posts an error payload', async () => {
    const worker = stubWorker();
    const executor = new WorkerThreadReplayExecutor({
      workerPath: 'sandbox-replay.worker.js',
      createWorker: () => worker,
      timeoutMs: 5_000,
    });

    const pending = executor.run(replayInput());
    worker.emit('message', { error: 'PAPER_NO_CANDLES' });

    await expect(pending).rejects.toMatchObject({ code: 'REPLAY_WORKER_FAILED' });
  });
});

describe('worker thread smoke', () => {
  const workerDir = mkdtempSync(path.join(tmpdir(), 'nexter-replay-worker-'));

  afterAll(() => {
    rmSync(workerDir, { recursive: true, force: true });
  });

  it('runs a tiny one-token replay in a real worker thread', async () => {
    const requireFromApi = createRequire(path.join(process.cwd(), 'package.json'));
    const coreEntry = requireFromApi.resolve('@nexter/sandbox-core');
    const sourcePath = path.join(
      process.cwd(),
      'src',
      'modules',
      'sandbox',
      'sandbox-replay.worker.ts',
    );
    const source = readFileSync(sourcePath, 'utf8');
    const { code } = await transform(source, {
      jsc: { parser: { syntax: 'typescript' }, target: 'es2022' },
      module: { type: 'commonjs' },
    });
    const rewritten = code.replace(
      /require\((['"])@nexter\/sandbox-core\1\)/g,
      `require(${JSON.stringify(coreEntry)})`,
    );
    const workerPath = path.join(workerDir, 'sandbox-replay.worker.js');
    writeFileSync(workerPath, rewritten);

    const input = replayInput();
    const executor = new WorkerThreadReplayExecutor({ workerPath, timeoutMs: 30_000 });

    const report = await executor.run(input);
    const inline = await new InlineReplayExecutor().run(input);

    expect(report.runId).toBe(RUN);
    expect(report.period.bars).toBe(BAR_COUNT - EVALUATE_INDEX);
    expect(report.reportHash).toBe(inline.reportHash);
    expect(report.eventHash).toBe(inline.eventHash);
  }, 60_000);
});
