import { performance } from 'node:perf_hooks';
import type { Candle, Clock } from '../types';
import type { CandleSource } from '../data/array-candle-source';
import type { MarketView } from '../data/market-view';
import type { EventLog } from '../events/event-log';
import { candleCloseTime, TIMEFRAME_MS } from '../timeframes';
import type { SandboxContext, ReplaySummary } from './context';

export class DataSourceOrderError extends Error {
  constructor(message = 'data source returned a candle older than the clock') {
    super(message);
    this.name = 'DataSourceOrderError';
  }
}

export class DataSourceError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'DataSourceError';
  }
}

export class SnapshotMismatchError extends Error {
  constructor(expected: string, actual: string) {
    super(`market snapshot ${actual} does not match replay data snapshot ${expected}`);
    this.name = 'SnapshotMismatchError';
  }
}

export interface ReplayRunnerOptions {
  runId: string;
  seed: number;
  configVersion: string;
  dataSnapshotId: string;
  clock: Clock;
  source: CandleSource;
  market: MarketView;
  eventLog: EventLog;
  onCandle?: (ctx: SandboxContext, candle: Candle) => Promise<void> | void;
}

function iso(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A throwing source is a data problem, never a handler bug. */
function readCandle(source: CandleSource): Candle | null {
  try {
    return source.next();
  } catch (error) {
    throw new DataSourceError(`candle source failed: ${messageOf(error)}`, error);
  }
}

function readCloseTime(candle: Candle): number {
  try {
    return candleCloseTime(candle);
  } catch (error) {
    throw new DataSourceError(`candle close time failed: ${messageOf(error)}`, error);
  }
}

export class ReplayRunner {
  constructor(private readonly options: ReplayRunnerOptions) {}

  async run(): Promise<ReplaySummary> {
    const { runId, seed, configVersion, dataSnapshotId, clock, source, market, eventLog } =
      this.options;
    const context: SandboxContext = { runId, clock, market, log: eventLog, configVersion, seed };
    let candles = 0;
    let firstTime: number | null = null;
    let lastTime: number | null = null;
    let gaps = 0;
    const lastByKey = new Map<string, number>();

    const marketSnapshotId = market.snapshotId();
    if (marketSnapshotId !== dataSnapshotId) {
      await eventLog.append({
        runId,
        clockTime: iso(clock.now()),
        module: 'run',
        eventType: 'run.failed',
        severity: 'error',
        inputs: {
          candles: 0,
          expectedSnapshotId: dataSnapshotId,
          actualSnapshotId: marketSnapshotId,
        },
        dataSnapshotId,
        configVersion,
        seed,
        reasonCode: 'SNAPSHOT_MISMATCH',
        reasonText: 'market view snapshot does not match the replay data snapshot',
      });
      throw new SnapshotMismatchError(dataSnapshotId, marketSnapshotId);
    }

    await eventLog.append({
      runId,
      clockTime: iso(clock.now()),
      module: 'run',
      eventType: 'run.started',
      severity: 'info',
      inputs: { seed },
      dataSnapshotId,
      configVersion,
      seed,
    });

    try {
      for (;;) {
        const candle = readCandle(source);
        if (!candle) break;
        const closeTime = readCloseTime(candle);
        // A candle is only replayable once it is closed at or after the current
        // simulation time. Anything that already closed in the past is stale.
        if (closeTime < clock.now()) {
          await eventLog.append({
            runId,
            clockTime: iso(clock.now()),
            module: 'data',
            eventType: 'data.out_of_order',
            severity: 'error',
            tokenId: candle.tokenId,
            inputs: {
              candleOpenTime: iso(candle.openTime),
              candleCloseTime: iso(closeTime),
              timeframe: candle.timeframe,
              clockTime: iso(clock.now()),
            },
            dataSnapshotId,
            configVersion,
            seed,
            reasonCode: 'DATA_OUT_OF_ORDER',
            reasonText: 'candle is older than the simulation clock',
          });
          throw new DataSourceOrderError();
        }
        clock.advanceTo(closeTime);
        firstTime ??= candle.openTime;
        lastTime = candle.openTime;

        const key = `${candle.tokenId}|${candle.timeframe}`;
        const previous = lastByKey.get(key);
        const expected = TIMEFRAME_MS[candle.timeframe];
        if (
          previous !== undefined &&
          expected !== undefined &&
          candle.openTime - previous > expected
        ) {
          gaps += 1;
          await eventLog.append({
            runId,
            clockTime: iso(closeTime),
            module: 'data',
            eventType: 'data.gap',
            severity: 'warn',
            tokenId: candle.tokenId,
            inputs: {
              timeframe: candle.timeframe,
              expectedMs: expected,
              actualMs: candle.openTime - previous,
              previousOpenTime: iso(previous),
            },
            dataSnapshotId,
            configVersion,
            seed,
            reasonCode: 'DATA_GAP',
            reasonText: 'missing candles between data points',
          });
        }
        lastByKey.set(key, candle.openTime);

        await eventLog.append({
          runId,
          clockTime: iso(closeTime),
          module: 'data',
          eventType: 'data.tick',
          severity: 'info',
          tokenId: candle.tokenId,
          inputs: {
            timeframe: candle.timeframe,
            openTime: iso(candle.openTime),
            closeTime: iso(closeTime),
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
            volumeUsd: candle.volumeUsd,
          },
          dataSnapshotId,
          configVersion,
          seed,
        });

        const started = performance.now();
        await this.options.onCandle?.(context, candle);
        await eventLog.append({
          runId,
          clockTime: iso(closeTime),
          module: 'run',
          eventType: 'cycle.completed',
          severity: 'debug',
          tokenId: candle.tokenId,
          timing: { durationMs: Math.round(performance.now() - started) },
          dataSnapshotId,
          configVersion,
          seed,
        });
        candles += 1;
      }
    } catch (error) {
      const reasonCode =
        error instanceof DataSourceOrderError
          ? 'DATA_OUT_OF_ORDER'
          : error instanceof DataSourceError
            ? 'DATA_SOURCE_ERROR'
            : 'HANDLER_ERROR';
      // Re-throw the underlying failure so callers see the original error.
      const failure = error instanceof DataSourceError ? (error.cause ?? error) : error;
      await eventLog.append({
        runId,
        clockTime: iso(clock.now()),
        module: 'run',
        eventType: 'run.failed',
        severity: 'error',
        inputs: { candles },
        dataSnapshotId,
        configVersion,
        seed,
        reasonCode,
        reasonText: messageOf(failure),
      });
      throw failure;
    }

    await eventLog.append({
      runId,
      clockTime: iso(clock.now()),
      module: 'run',
      eventType: 'run.finished',
      severity: 'info',
      inputs: {
        candles,
        firstTime: firstTime === null ? null : iso(firstTime),
        lastTime: lastTime === null ? null : iso(lastTime),
        gaps,
      },
      dataSnapshotId,
      configVersion,
      seed,
    });

    return {
      candles,
      firstTime,
      lastTime,
      gaps,
      eventCount: eventLog.events().length,
      eventHash: eventLog.hash(),
    };
  }
}
