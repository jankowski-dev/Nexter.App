import { describe, expect, it } from 'vitest';
import type { Candle } from '../types';
import { SimulationClock } from '../clock';
import { ArrayCandleSource } from '../data/array-candle-source';
import { ClockedMarketView } from '../data/market-view';
import { snapshotCandles } from '../data/snapshot';
import { MemoryEventLog } from '../events/memory-event-log';
import { candleCloseTime } from '../timeframes';
import { DataSourceOrderError, ReplayRunner } from './replay-runner';

function candle(openTime: number, close = '100'): Candle {
  return {
    tokenId: 'btc',
    timeframe: '1h',
    openTime,
    open: close,
    high: close,
    low: close,
    close,
    volumeUsd: '10',
  };
}

function setup(candles: Candle[], start = candles[0] ? candleCloseTime(candles[0]) : 1_000) {
  const clock = new SimulationClock(start);
  const source = new ArrayCandleSource(candles);
  const snapshot = snapshotCandles(source.candles);
  const market = new ClockedMarketView(snapshot.candles, clock, snapshot.id);
  const log = new MemoryEventLog();
  return { clock, source, market, log, snapshot };
}

describe('ReplayRunner', () => {
  it('walks candles in order and logs run/data/cycle/finish events', async () => {
    const { clock, source, market, log, snapshot } = setup([
      candle(1_000),
      candle(3_600_000 + 1_000),
      candle(7_200_000 + 1_000),
    ]);
    const seen: Array<{ now: number; latest: number | null }> = [];
    const runner = new ReplayRunner({
      runId: 'run-1',
      seed: 7,
      configVersion: 'config-1',
      dataSnapshotId: snapshot.id,
      clock,
      source,
      market,
      eventLog: log,
      onCandle: (ctx) => {
        seen.push({
          now: ctx.clock.now(),
          latest: ctx.market.latest('btc', '1h')?.openTime ?? null,
        });
      },
    });
    const summary = await runner.run();
    expect(summary.candles).toBe(3);
    expect(seen).toEqual([
      { now: 3_601_000, latest: 1_000 },
      { now: 7_201_000, latest: 3_601_000 },
      { now: 10_801_000, latest: 7_201_000 },
    ]);
    expect(log.events().filter((e) => e.eventType === 'data.tick')).toHaveLength(3);
    expect(log.events().filter((e) => e.eventType === 'cycle.completed')).toHaveLength(3);
    expect(log.events()[0]?.eventType).toBe('run.started');
    expect(log.events().at(-1)?.eventType).toBe('run.finished');
    expect(summary.eventHash).toBe(log.hash());
  });

  it('logs a data gap per token/timeframe', async () => {
    const { clock, source, market, log, snapshot } = setup([candle(1_000), candle(7_201_000)]);
    const runner = new ReplayRunner({
      runId: 'run-1',
      seed: 7,
      configVersion: 'config-1',
      dataSnapshotId: snapshot.id,
      clock,
      source,
      market,
      eventLog: log,
    });
    const summary = await runner.run();
    expect(summary.gaps).toBe(1);
    const gap = log.events().find((e) => e.eventType === 'data.gap');
    expect(gap?.inputs).toMatchObject({ expectedMs: 3_600_000, actualMs: 7_200_000 });
  });

  it('rejects an out-of-order source and logs data.out_of_order', async () => {
    const { clock, market, log, snapshot } = setup([candle(10_000)]);
    let call = 0;
    const outOfOrderSource = {
      next: () => {
        call += 1;
        if (call === 1) return candle(10_000);
        if (call === 2) return candle(1_000);
        return null;
      },
    };
    const runner = new ReplayRunner({
      runId: 'run-1',
      seed: 7,
      configVersion: 'config-1',
      dataSnapshotId: snapshot.id,
      clock,
      source: outOfOrderSource,
      market,
      eventLog: log,
    });
    await expect(runner.run()).rejects.toThrow(DataSourceOrderError);
    expect(log.events().some((event) => event.eventType === 'data.out_of_order')).toBe(true);
    expect(log.events().at(-1)?.reasonCode).toBe('DATA_OUT_OF_ORDER');
  });

  it('logs run.failed and rethrows when the handler fails', async () => {
    const { clock, source, market, log, snapshot } = setup([candle(1_000)]);
    const runner = new ReplayRunner({
      runId: 'run-1',
      seed: 7,
      configVersion: 'config-1',
      dataSnapshotId: snapshot.id,
      clock,
      source,
      market,
      eventLog: log,
      onCandle: () => {
        throw new Error('handler boom');
      },
    });
    await expect(runner.run()).rejects.toThrow('handler boom');
    const failed = log.events().at(-1);
    expect(failed?.eventType).toBe('run.failed');
    expect(failed?.reasonCode).toBe('HANDLER_ERROR');
  });

  it('handles an empty source', async () => {
    const { clock, source, market, log, snapshot } = setup([]);
    const runner = new ReplayRunner({
      runId: 'run-1',
      seed: 7,
      configVersion: 'config-1',
      dataSnapshotId: snapshot.id,
      clock,
      source,
      market,
      eventLog: log,
    });
    const summary = await runner.run();
    expect(summary.candles).toBe(0);
    expect(log.events().map((e) => e.eventType)).toEqual(['run.started', 'run.finished']);
  });
});
