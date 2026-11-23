import { SimulationClock } from '../clock';
import { ArrayCandleSource } from '../data/array-candle-source';
import { loadJsonlCandles } from '../data/jsonl-candles';
import { ClockedMarketView } from '../data/market-view';
import { snapshotCandles } from '../data/snapshot';
import { configVersion } from '../config';
import { JsonlEventLog } from '../events/jsonl-event-log';
import { ReplayRunner } from '../runner/replay-runner';
import type { ReplaySummary } from '../runner/context';
import { candleCloseTime } from '../timeframes';
import type { RunConfig } from '../types';

export interface ReplayFromFileOptions {
  filePath: string;
  outputPath: string;
  runId: string;
  seed: number;
  timeframe?: string;
}

export interface ReplayFromFileResult extends ReplaySummary {
  outputPath: string;
  configVersion: string;
  dataSnapshotId: string;
}

export async function runReplayFromFile(
  options: ReplayFromFileOptions,
): Promise<ReplayFromFileResult> {
  const candles = await loadJsonlCandles(options.filePath);
  if (candles.length === 0) throw new Error('No candles found');
  const source = new ArrayCandleSource(candles);
  const snapshot = snapshotCandles(source.candles);
  const first = snapshot.candles[0];
  if (!first) throw new Error('No candles found');
  const clock = new SimulationClock(candleCloseTime(first));
  const market = new ClockedMarketView(snapshot.candles, clock, snapshot.id);
  const config: RunConfig = {
    runId: options.runId,
    seed: options.seed,
    timeframe: options.timeframe ?? snapshot.candles[0]?.timeframe ?? '1h',
    tokenIds: [...new Set(snapshot.candles.map((candle) => candle.tokenId))],
    initialCapitalUsd: '1000',
    feeBps: 25,
    slippageBps: 10,
  };
  const version = configVersion(config);
  const log = await JsonlEventLog.open(options.outputPath);
  const runner = new ReplayRunner({
    runId: config.runId,
    seed: config.seed,
    configVersion: version,
    dataSnapshotId: snapshot.id,
    clock,
    source,
    market,
    eventLog: log,
  });
  const summary = await runner.run();
  await log.close();
  return { ...summary, outputPath: options.outputPath, configVersion: version, dataSnapshotId: snapshot.id };
}
