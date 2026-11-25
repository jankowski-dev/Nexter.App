import Decimal from 'decimal.js';
import { loadJsonlCandles } from '../data/jsonl-candles';
import { snapshotCandles } from '../data/snapshot';
import { DEFAULT_SETTINGS } from '../decision/defaults';
import { paperConfigVersion } from '../paper/defaults';
import { runPaperFromCandles } from '../paper/run-paper';
import { assertFreshOutputDirectory, writePaperArtifacts } from '../paper/report';
import type { Candle } from '../types';
import type {
  PaperArtifactPaths,
  PaperRunConfig,
  PaperRunResult,
  PaperRunSettings,
  RunReport,
} from '../paper/types';

export { collectRejectedBuys } from '../paper/run-paper';

/**
 * Import-safe paper CLI.
 *
 * `parsePaperArgs` validates argv without touching the filesystem; the caller
 * may choose a fresh output directory and pass explicit settings. `--file` is
 * repeatable: every JSONL file is loaded with the Stage 1A loader, then the
 * combined series must share one timeframe and pass duplicate/price validation
 * through `snapshotCandles`.
 */

export const PAPER_USAGE =
  'Usage: paper --file <candles.jsonl> [--file ...] --out <dir> [--run-id id] [--seed 7] ' +
  '[--initial-capital 1000.00] [--fee-bps 25] [--slippage-bps 10] [--liquidity-pct 1] ' +
  '[--cooldown-hours 24] [--cf-horizon-hours 24]';

const DEFAULT_SEED = 7;
const DEFAULT_INITIAL_CAPITAL_USD = '1000.00';
const DEFAULT_FEE_BPS = 25;
const DEFAULT_SLIPPAGE_BPS = 10;
const DEFAULT_LIQUIDITY_PCT = 1;
const DEFAULT_COOLDOWN_HOURS = 24;
const DEFAULT_COUNTERFACTUAL_HORIZON_HOURS = 24;
/** Stage 1C is IOC: one pending bar, not exposed as a CLI flag. */
const MAX_PENDING_BARS = 1;

const KNOWN_FLAGS: ReadonlySet<string> = new Set([
  '--file',
  '--out',
  '--run-id',
  '--seed',
  '--initial-capital',
  '--fee-bps',
  '--slippage-bps',
  '--liquidity-pct',
  '--cooldown-hours',
  '--cf-horizon-hours',
]);

export interface PaperArgs {
  readonly files: readonly string[];
  readonly outputDir: string;
  readonly runId: string;
  readonly seed: number;
  readonly initialCapitalUsd: string;
  readonly feeBps: number;
  readonly slippageBps: number;
  readonly liquidityCapPct: number;
  readonly cooldownHoursAfterStop: number;
  readonly counterfactualHorizonHours: number;
}

/** Result of one file-driven paper run: report, raw run and artifact paths. */
export interface PaperFromFilesResult {
  readonly report: RunReport;
  readonly result: PaperRunResult;
  readonly artifacts: PaperArtifactPaths;
}

const INTEGER = /^\d+$/;
const DECIMAL = /^\d+(\.\d+)?$/;

/** Parses a plain decimal flag; rejects exponents, hex, signs and whitespace. */
function readNumber(value: string): number {
  if (!DECIMAL.test(value)) throw new Error(PAPER_USAGE);
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(PAPER_USAGE);
  return parsed;
}

function readSafeInteger(value: string): number {
  if (!INTEGER.test(value)) throw new Error(PAPER_USAGE);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(PAPER_USAGE);
  return parsed;
}

/**
 * Validates a positive USD string with at most two decimals and returns the
 * canonical two-decimal form, so `1000` and `1000.00` hash identically.
 */
function canonicalInitialCapital(value: string): string {
  if (!/^\d+(\.\d{1,2})?$/.test(value) || /^0+(\.0{1,2})?$/.test(value)) {
    throw new Error(PAPER_USAGE);
  }
  return new Decimal(value).toFixed(2);
}

function readBps(value: string): number {
  const parsed = readNumber(value);
  if (parsed < 0 || parsed >= 10_000) throw new Error(PAPER_USAGE);
  return parsed;
}

/**
 * Parses paper CLI arguments without touching the filesystem.
 *
 * A flag followed by another flag or an empty value is always a usage error:
 * silently treating it as a missing value would hide a typo behind a default.
 * The default run id uses the wall clock only as a display identifier; pass
 * `--run-id` for a reproducible artifact name.
 */
export function parsePaperArgs(argv: readonly string[]): PaperArgs {
  const tokens = argv.filter((token) => token !== '--');
  const files: string[] = [];
  const flags = new Map<string, string>();

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] as string;
    if (!token.startsWith('--') || !KNOWN_FLAGS.has(token)) {
      throw new Error(PAPER_USAGE);
    }
    const value = tokens[index + 1];
    if (value === undefined || value.startsWith('--') || value.trim() === '') {
      throw new Error(PAPER_USAGE);
    }
    if (token === '--file') {
      files.push(value);
    } else {
      flags.set(token, value);
    }
    index += 1;
  }

  if (files.length === 0) throw new Error(PAPER_USAGE);
  const outputDir = flags.get('--out');
  if (outputDir === undefined) throw new Error(PAPER_USAGE);

  const runId = flags.get('--run-id') ?? `paper-${Date.now()}`;

  return {
    files,
    outputDir,
    runId,
    seed:
      flags.get('--seed') === undefined
        ? DEFAULT_SEED
        : readSafeInteger(flags.get('--seed') as string),
    initialCapitalUsd:
      flags.get('--initial-capital') === undefined
        ? DEFAULT_INITIAL_CAPITAL_USD
        : canonicalInitialCapital(flags.get('--initial-capital') as string),
    feeBps:
      flags.get('--fee-bps') === undefined
        ? DEFAULT_FEE_BPS
        : readBps(flags.get('--fee-bps') as string),
    slippageBps:
      flags.get('--slippage-bps') === undefined
        ? DEFAULT_SLIPPAGE_BPS
        : readBps(flags.get('--slippage-bps') as string),
    liquidityCapPct:
      flags.get('--liquidity-pct') === undefined
        ? DEFAULT_LIQUIDITY_PCT
        : readLiquidityPct(flags.get('--liquidity-pct') as string),
    cooldownHoursAfterStop:
      flags.get('--cooldown-hours') === undefined
        ? DEFAULT_COOLDOWN_HOURS
        : readNonNegative(flags.get('--cooldown-hours') as string),
    counterfactualHorizonHours:
      flags.get('--cf-horizon-hours') === undefined
        ? DEFAULT_COUNTERFACTUAL_HORIZON_HOURS
        : readPositive(flags.get('--cf-horizon-hours') as string),
  };
}

function readLiquidityPct(value: string): number {
  const parsed = readNumber(value);
  if (parsed <= 0 || parsed > 100) throw new Error(PAPER_USAGE);
  return parsed;
}

function readNonNegative(value: string): number {
  const parsed = readNumber(value);
  if (parsed < 0) throw new Error(PAPER_USAGE);
  return parsed;
}

function readPositive(value: string): number {
  const parsed = readNumber(value);
  if (parsed <= 0) throw new Error(PAPER_USAGE);
  return parsed;
}

/** Locale-independent code-unit ordering used by every deterministic sort. */
function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/**
 * Loads the candle files, runs one paper simulation and writes the artifacts.
 *
 * File loading, validation, snapshotting and artifact writing live here; the
 * simulation and report pipeline are delegated to the reusable
 * `runPaperFromCandles` so the CLI and the historical replay worker cannot
 * diverge.
 */
export async function runPaperFromFiles(args: PaperArgs): Promise<PaperFromFilesResult> {
  // Fail before the costly load/run if the destination is already occupied.
  await assertFreshOutputDirectory(args.outputDir);

  const loaded: Candle[] = [];
  for (const file of args.files) {
    loaded.push(...(await loadJsonlCandles(file)));
  }
  if (loaded.length === 0) throw new Error('No candles found');

  const timeframes = [...new Set(loaded.map((candle) => candle.timeframe))].sort(compareCodeUnits);
  if (timeframes.length > 1) {
    throw new Error(`Mixed timeframes are not supported: ${timeframes.join(', ')}`);
  }
  const timeframe = timeframes[0] as string;
  if (timeframe !== '1h') {
    throw new Error(`Unsupported timeframe "${timeframe}": Stage 1C paper runs support 1h only`);
  }

  const snapshot = snapshotCandles(loaded);
  const tokenIds = [...new Set(snapshot.candles.map((candle) => candle.tokenId))].sort(
    compareCodeUnits,
  );
  const initialCapitalUsd = canonicalInitialCapital(args.initialCapitalUsd);

  const paper: PaperRunSettings = {
    feeBps: args.feeBps,
    slippageBps: args.slippageBps,
    liquidityCapPct: args.liquidityCapPct,
    maxPendingBars: MAX_PENDING_BARS,
    cooldownHoursAfterStop: args.cooldownHoursAfterStop,
    counterfactualHorizonHours: args.counterfactualHorizonHours,
  };
  const config: PaperRunConfig = {
    runId: args.runId,
    seed: args.seed,
    timeframe,
    tokenIds,
    initialCapitalUsd,
    ...paper,
  };
  const configVersion = paperConfigVersion(config);

  const { report, result, events } = await runPaperFromCandles({
    runId: config.runId,
    seed: config.seed,
    configVersion,
    dataSnapshotId: snapshot.id,
    tokenIds,
    candles: snapshot.candles,
    settings: DEFAULT_SETTINGS,
    paper,
    initialCapitalUsd: config.initialCapitalUsd,
  });
  const artifacts = await writePaperArtifacts({ outputDir: args.outputDir, report, events });

  return { report, result, artifacts };
}
