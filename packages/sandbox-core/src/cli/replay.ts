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

export const REPLAY_USAGE =
  'Usage: replay --file <candles.jsonl> [--out events.jsonl] [--run-id id] [--seed 7]';

const DEFAULT_SEED = 7;

export interface ReplayArgs {
  filePath: string;
  outputPath: string;
  runId: string;
  seed: number;
}

export type ReplayFromFileOptions = ReplayArgs;

export interface ReplayFromFileResult extends ReplaySummary {
  outputPath: string;
  configVersion: string;
  dataSnapshotId: string;
}

/**
 * Parses CLI arguments without touching the filesystem.
 *
 * `pnpm run replay -- --file ...` forwards a literal `--`, so it is ignored.
 * A flag followed by another flag is always a usage error: silently treating
 * it as a missing value would hide a typo behind a default.
 */
export function parseReplayArgs(argv: readonly string[]): ReplayArgs {
  const tokens = argv.filter((token) => token !== '--');

  const read = (name: string): string | undefined => {
    const index = tokens.indexOf(name);
    if (index === -1) return undefined;
    const value = tokens[index + 1];
    if (value === undefined || value.startsWith('--') || value.trim() === '') {
      throw new Error(REPLAY_USAGE);
    }
    return value;
  };

  const filePath = read('--file');
  if (!filePath) throw new Error(REPLAY_USAGE);

  const runId = read('--run-id') ?? `sandbox-${Date.now()}`;

  const rawSeed = read('--seed');
  let seed = DEFAULT_SEED;
  if (rawSeed !== undefined) {
    if (rawSeed.trim() === '') throw new Error(REPLAY_USAGE);
    seed = Number(rawSeed);
    if (!Number.isSafeInteger(seed)) throw new Error(REPLAY_USAGE);
  }

  const outputPath = read('--out') ?? `out/sandbox-events-${runId}.jsonl`;
  return { filePath, outputPath, runId, seed };
}

export async function runReplayFromFile(
  options: ReplayFromFileOptions,
): Promise<ReplayFromFileResult> {
  const candles = await loadJsonlCandles(options.filePath);
  if (candles.length === 0) throw new Error('No candles found');
  const timeframes = [...new Set(candles.map((candle) => candle.timeframe))];
  if (timeframes.length > 1) {
    throw new Error(`Mixed timeframes are not supported: ${timeframes.join(', ')}`);
  }
  const source = new ArrayCandleSource(candles);
  const snapshot = snapshotCandles(source.candles);
  const first = snapshot.candles[0];
  if (!first) throw new Error('No candles found');
  const clock = new SimulationClock(candleCloseTime(first));
  const market = new ClockedMarketView(snapshot.candles, clock, snapshot.id);
  const config: RunConfig = {
    runId: options.runId,
    seed: options.seed,
    timeframe: first.timeframe,
    tokenIds: [...new Set(snapshot.candles.map((candle) => candle.tokenId))],
    initialCapitalUsd: '1000',
    feeBps: 25,
    slippageBps: 10,
  };
  const version = configVersion(config);
  const log = await JsonlEventLog.open(options.outputPath);
  try {
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
    return {
      ...summary,
      outputPath: options.outputPath,
      configVersion: version,
      dataSnapshotId: snapshot.id,
    };
  } finally {
    await log.close();
  }
}
