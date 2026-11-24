import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeCandles } from '../paper/fixtures.test-helpers';
import type { Candle } from '../types';
import { stableStringify } from '../util/hash';
import { PAPER_USAGE, parsePaperArgs, runPaperFromFiles } from './paper';

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 0, 1);

function closes(count: number): number[] {
  return Array.from({ length: count }, (_, index) => 1 + index * 0.002);
}

async function writeCandles(
  dir: string,
  name: string,
  candles: readonly Candle[],
): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, candles.map((candle) => JSON.stringify(candle)).join('\n'));
  return path;
}

const baseArgs = {
  runId: 'paper-test',
  seed: 7,
  initialCapitalUsd: '1000.00',
  feeBps: 25,
  slippageBps: 10,
  liquidityCapPct: 1,
  cooldownHoursAfterStop: 24,
  counterfactualHorizonHours: 24,
};

describe('parsePaperArgs', () => {
  it('parses required flags and applies documented defaults', () => {
    const args = parsePaperArgs(['--file', 'a.jsonl', '--out', 'out']);
    expect(args.files).toEqual(['a.jsonl']);
    expect(args.outputDir).toBe('out');
    expect(args.runId.startsWith('paper-')).toBe(true);
    expect(args.seed).toBe(7);
    expect(args.initialCapitalUsd).toBe('1000.00');
    expect(args.feeBps).toBe(25);
    expect(args.slippageBps).toBe(10);
    expect(args.liquidityCapPct).toBe(1);
    expect(args.cooldownHoursAfterStop).toBe(24);
    expect(args.counterfactualHorizonHours).toBe(24);
  });

  it('accepts every explicit flag and a repeated --file', () => {
    const args = parsePaperArgs([
      '--',
      '--file',
      'a.jsonl',
      '--file',
      'b.jsonl',
      '--out',
      'out',
      '--run-id',
      'run-9',
      '--seed',
      '42',
      '--initial-capital',
      '250.50',
      '--fee-bps',
      '10',
      '--slippage-bps',
      '5',
      '--liquidity-pct',
      '2.5',
      '--cooldown-hours',
      '6',
      '--cf-horizon-hours',
      '48',
    ]);
    expect(args).toEqual({
      files: ['a.jsonl', 'b.jsonl'],
      outputDir: 'out',
      runId: 'run-9',
      seed: 42,
      initialCapitalUsd: '250.50',
      feeBps: 10,
      slippageBps: 5,
      liquidityCapPct: 2.5,
      cooldownHoursAfterStop: 6,
      counterfactualHorizonHours: 48,
    });
  });

  it('rejects unknown flags and stray positional values', () => {
    expect(() => parsePaperArgs(['--file', 'a', '--out', 'out', '--bogus', '1'])).toThrow(
      PAPER_USAGE,
    );
    expect(() => parsePaperArgs(['--file', 'a', '--out', 'out', 'stray'])).toThrow(PAPER_USAGE);
  });

  it('rejects flag-shaped and empty values', () => {
    expect(() => parsePaperArgs(['--file', '--out', 'out'])).toThrow(PAPER_USAGE);
    expect(() => parsePaperArgs(['--file', 'a', '--run-id', '--seed', '7'])).toThrow(PAPER_USAGE);
    expect(() => parsePaperArgs(['--file', 'a', '--out', ''])).toThrow(PAPER_USAGE);
    expect(() => parsePaperArgs(['--file', 'a', '--out', '   '])).toThrow(PAPER_USAGE);
    expect(() => parsePaperArgs(['--file', '', '--out', 'out'])).toThrow(PAPER_USAGE);
    expect(() => parsePaperArgs(['--file', 'a'])).toThrow(PAPER_USAGE);
    expect(() => parsePaperArgs([])).toThrow(PAPER_USAGE);
  });

  it('rejects invalid numbers', () => {
    const invalidSeeds = ['abc', '1.5', '', '9007199254740992'];
    for (const seed of invalidSeeds) {
      expect(() => parsePaperArgs(['--file', 'a', '--out', 'out', '--seed', seed])).toThrow(
        PAPER_USAGE,
      );
    }
    for (const [flag, value] of [
      ['--fee-bps', 'abc'],
      ['--fee-bps', '-1'],
      ['--fee-bps', '10000'],
      ['--slippage-bps', 'x'],
      ['--liquidity-pct', '0'],
      ['--liquidity-pct', '101'],
      ['--cooldown-hours', '-1'],
      ['--cf-horizon-hours', '0'],
      ['--initial-capital', '0'],
      ['--initial-capital', '1.234'],
    ] as const) {
      expect(() => parsePaperArgs(['--file', 'a', '--out', 'out', flag, value])).toThrow(
        PAPER_USAGE,
      );
    }
  });
});

describe('runPaperFromFiles', () => {
  it('combines files, runs and writes fresh artifacts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'paper-cli-'));
    const file = await writeCandles(dir, 'candles.jsonl', makeCandles(closes(240), { start: T0 }));
    const outputDir = join(dir, 'out');

    const run = await runPaperFromFiles({ ...baseArgs, files: [file], outputDir });

    expect(run.report.runId).toBe('paper-test');
    expect(run.report.period.bars).toBe(240);
    expect(run.report.reportHash).toMatch(/^[a-f0-9]{64}$/);
    expect(run.report.reconciliationOk).toBe(true);
    expect(run.artifacts.outputDir).toBe(outputDir);

    const raw = await readFile(run.artifacts.eventsPath, 'utf8');
    const lines = raw.trim().split('\n');
    expect(lines.length).toBe(run.report.eventCount);
    const events = lines.map((line) => JSON.parse(line) as { hash: string });
    for (const line of lines) expect(stableStringify(JSON.parse(line))).toBe(line);
    expect(events[events.length - 1]?.hash).toBe(run.report.eventHash);

    const reportJson = JSON.parse(await readFile(run.artifacts.reportJsonPath, 'utf8'));
    expect(reportJson).toEqual(run.report);
    expect(reportJson.generatedAt).toBeUndefined();

    const markdown = await readFile(run.artifacts.reportMarkdownPath, 'utf8');
    expect(markdown).toContain('# Paper run report');
    expect(markdown).toContain('| Reconciliation ok | true |');
    expect(markdown).toContain(run.report.reportHash);
  });

  it('combines multiple files for different tokens', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'paper-cli-'));
    const one = await writeCandles(
      dir,
      'token-a.jsonl',
      makeCandles(closes(30), { tokenId: 'token-a', start: T0 }),
    );
    const two = await writeCandles(
      dir,
      'token-b.jsonl',
      makeCandles(closes(30), { tokenId: 'token-b', start: T0 + HOUR }),
    );

    const run = await runPaperFromFiles({
      ...baseArgs,
      files: [one, two],
      outputDir: join(dir, 'out'),
    });

    expect(run.report.period.tokens).toEqual(['token-a', 'token-b']);
    expect(run.report.period.bars).toBe(31);
  });

  it('rejects mixed timeframes and duplicate candles', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'paper-cli-'));
    const hourly = await writeCandles(dir, 'hourly.jsonl', makeCandles(closes(10), { start: T0 }));
    const fourHourly = await writeCandles(
      dir,
      'four-hourly.jsonl',
      makeCandles(closes(10), { timeframe: '4h', start: T0 }),
    );
    const duplicate = await writeCandles(
      dir,
      'duplicate.jsonl',
      makeCandles(closes(10), { start: T0 }),
    );

    await expect(
      runPaperFromFiles({
        ...baseArgs,
        files: [hourly, fourHourly],
        outputDir: join(dir, 'out-mixed'),
      }),
    ).rejects.toThrow(/Mixed timeframes are not supported: 1h, 4h/);

    await expect(
      runPaperFromFiles({
        ...baseArgs,
        files: [hourly, duplicate],
        outputDir: join(dir, 'out-duplicate'),
      }),
    ).rejects.toThrow(/duplicate candle/);
  });

  it('refuses a non-empty output directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'paper-cli-'));
    const file = await writeCandles(dir, 'candles.jsonl', makeCandles(closes(30), { start: T0 }));
    const outputDir = join(dir, 'out');
    await mkdir(outputDir);
    await writeFile(join(outputDir, 'existing.txt'), 'occupied');

    await expect(runPaperFromFiles({ ...baseArgs, files: [file], outputDir })).rejects.toThrow(
      /not empty/,
    );
  });
});
