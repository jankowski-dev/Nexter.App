import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { ArrayCandleSource } from '../data/array-candle-source';
import { JsonlEventLog } from '../events/jsonl-event-log';
import { parseReplayArgs, REPLAY_USAGE, runReplayFromFile } from './replay';

const fixturePath = fileURLToPath(new URL('../fixtures/candles-1h.jsonl', import.meta.url));

const candles = [
  {
    tokenId: 'btc',
    timeframe: '1h',
    openTime: '2026-01-01T00:00:00.000Z',
    open: '100',
    high: '101',
    low: '99',
    close: '100',
    volumeUsd: '10',
  },
  {
    tokenId: 'btc',
    timeframe: '1h',
    openTime: '2026-01-01T01:00:00.000Z',
    open: '100',
    high: '102',
    low: '100',
    close: '101',
    volumeUsd: '11',
  },
  {
    tokenId: 'btc',
    timeframe: '1h',
    openTime: '2026-01-01T02:00:00.000Z',
    open: '101',
    high: '103',
    low: '101',
    close: '102',
    volumeUsd: '12',
  },
];

describe('runReplayFromFile', () => {
  it('writes a deterministic event log and summary', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sandbox-'));
    const input = join(dir, 'candles.jsonl');
    const output1 = join(dir, 'events-1.jsonl');
    const output2 = join(dir, 'events-2.jsonl');
    await writeFile(input, candles.map((candle) => JSON.stringify(candle)).join('\n'));

    const one = await runReplayFromFile({
      filePath: input,
      outputPath: output1,
      runId: 'run-1',
      seed: 7,
    });
    const two = await runReplayFromFile({
      filePath: input,
      outputPath: output2,
      runId: 'run-1',
      seed: 7,
    });

    expect(one.candles).toBe(3);
    expect(one.eventCount).toBe(8);
    expect(one.eventHash).toBe(two.eventHash);
    expect(one.eventHash).toMatch(/^[a-f0-9]{64}$/);
    const lines = (await readFile(output1, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(8);
    expect(JSON.parse(lines[0] ?? '').eventType).toBe('run.started');
    expect(JSON.parse(lines.at(-1) ?? '').eventType).toBe('run.finished');
  });

  it('rejects an empty file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sandbox-'));
    const input = join(dir, 'empty.jsonl');
    await writeFile(input, '');
    await expect(
      runReplayFromFile({
        filePath: input,
        outputPath: join(dir, 'events.jsonl'),
        runId: 'run-1',
        seed: 7,
      }),
    ).rejects.toThrow(/no candles/i);
  });

  it('rejects mixed timeframes in one file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sandbox-'));
    const input = join(dir, 'mixed.jsonl');
    await writeFile(
      input,
      [JSON.stringify({ ...candles[0] }), JSON.stringify({ ...candles[1], timeframe: '4h' })].join(
        '\n',
      ),
    );
    await expect(
      runReplayFromFile({
        filePath: input,
        outputPath: join(dir, 'events.jsonl'),
        runId: 'run-1',
        seed: 7,
      }),
    ).rejects.toThrow(/Mixed timeframes are not supported: 1h, 4h/);
  });

  it('uses the first candle timeframe for the run config', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sandbox-'));
    const input = join(dir, 'candles-4h.jsonl');
    await writeFile(
      input,
      candles.map((candle) => JSON.stringify({ ...candle, timeframe: '4h' })).join('\n'),
    );
    const result = await runReplayFromFile({
      filePath: input,
      outputPath: join(dir, 'events.jsonl'),
      runId: 'run-4h',
      seed: 7,
    });
    expect(result.candles).toBe(3);
    const lines = (await readFile(result.outputPath, 'utf8')).trim().split('\n');
    const started = JSON.parse(lines[0] ?? '{}');
    expect(started.configVersion).toBe(result.configVersion);
    expect(JSON.parse(lines[1] ?? '{}').inputs).toMatchObject({ timeframe: '4h' });
  });

  it('closes the event log when the replay fails', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sandbox-'));
    const input = join(dir, 'candles.jsonl');
    await writeFile(input, candles.map((candle) => JSON.stringify(candle)).join('\n'));
    const closeSpy = vi.spyOn(JsonlEventLog.prototype, 'close');
    const nextSpy = vi.spyOn(ArrayCandleSource.prototype, 'next').mockImplementationOnce(() => {
      throw new Error('source boom');
    });
    try {
      await expect(
        runReplayFromFile({
          filePath: input,
          outputPath: join(dir, 'events.jsonl'),
          runId: 'run-1',
          seed: 7,
        }),
      ).rejects.toThrow('source boom');
      expect(closeSpy).toHaveBeenCalledTimes(1);
      const lines = (await readFile(join(dir, 'events.jsonl'), 'utf8')).trim().split('\n');
      expect(JSON.parse(lines.at(-1) ?? '{}').reasonCode).toBe('DATA_SOURCE_ERROR');
    } finally {
      nextSpy.mockRestore();
      closeSpy.mockRestore();
    }
  });

  it('pins the golden determinism values for the committed fixture', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sandbox-golden-'));
    const one = await runReplayFromFile({
      filePath: fixturePath,
      outputPath: join(dir, 'events-1.jsonl'),
      runId: 'stage1a-golden',
      seed: 7,
    });
    expect(one.candles).toBe(3);
    expect(one.eventCount).toBe(8);
    expect(one.configVersion).toBe(
      '6082bbcf4407b31bb56c54ef65672dd1a87e624e8b58f90c8ac217dad8c50dcd',
    );
    expect(one.dataSnapshotId).toBe(
      '4d62f7195b100cd88d33896545038526decac00c03208447a155d212996c1a99',
    );
    expect(one.eventHash).toBe('1e762672c2a3deb11e6395d3e10b4a91aa4f9e58b474d86e01cc5232109105c9');

    const two = await runReplayFromFile({
      filePath: fixturePath,
      outputPath: join(dir, 'events-2.jsonl'),
      runId: 'stage1a-golden',
      seed: 7,
    });
    expect(two.eventHash).toBe(one.eventHash);
    expect((await readFile(join(dir, 'events-1.jsonl'), 'utf8')).trim().split('\n')).toHaveLength(
      8,
    );
  });
});

describe('parseReplayArgs', () => {
  it('parses every flag', () => {
    expect(
      parseReplayArgs([
        '--file',
        'candles.jsonl',
        '--out',
        'events.jsonl',
        '--run-id',
        'run-1',
        '--seed',
        '42',
      ]),
    ).toEqual({
      filePath: 'candles.jsonl',
      outputPath: 'events.jsonl',
      runId: 'run-1',
      seed: 42,
    });
  });

  it('skips a literal -- inserted by pnpm', () => {
    expect(parseReplayArgs(['--', '--file', 'candles.jsonl', '--run-id', 'run-1'])).toMatchObject({
      filePath: 'candles.jsonl',
      runId: 'run-1',
    });
  });

  it('defaults the seed and the output path from the run id', () => {
    const args = parseReplayArgs(['--file', 'candles.jsonl', '--run-id', 'run-9']);
    expect(args.seed).toBe(7);
    expect(args.outputPath).toBe('out/sandbox-events-run-9.jsonl');
  });

  it('rejects a missing file flag', () => {
    expect(() => parseReplayArgs([])).toThrow(REPLAY_USAGE);
    expect(() => parseReplayArgs(['--out', 'events.jsonl'])).toThrow(REPLAY_USAGE);
  });

  it('rejects a flag used as a value', () => {
    expect(() => parseReplayArgs(['--file', '--out', 'events.jsonl'])).toThrow(REPLAY_USAGE);
    expect(() => parseReplayArgs(['--file', 'a.jsonl', '--run-id', '--seed', '7'])).toThrow(
      REPLAY_USAGE,
    );
    expect(() => parseReplayArgs(['--file', 'a.jsonl', '--seed', '--out'])).toThrow(REPLAY_USAGE);
  });

  it('rejects empty --out and --run-id values', () => {
    expect(() => parseReplayArgs(['--file', 'a.jsonl', '--out', ''])).toThrow(REPLAY_USAGE);
    expect(() => parseReplayArgs(['--file', 'a.jsonl', '--out', '   '])).toThrow(REPLAY_USAGE);
    expect(() => parseReplayArgs(['--file', 'a.jsonl', '--run-id', ''])).toThrow(REPLAY_USAGE);
    expect(() => parseReplayArgs(['--file', 'a.jsonl', '--run-id', '  '])).toThrow(REPLAY_USAGE);
  });

  it('rejects a non-integer or non-numeric seed', () => {
    for (const seed of ['abc', '1.5', '', '9007199254740992']) {
      expect(() => parseReplayArgs(['--file', 'a.jsonl', '--seed', seed])).toThrow(REPLAY_USAGE);
    }
  });

  it('accepts negative and zero safe integer seeds', () => {
    expect(parseReplayArgs(['--file', 'a.jsonl', '--seed', '0']).seed).toBe(0);
    expect(parseReplayArgs(['--file', 'a.jsonl', '--seed', '-3']).seed).toBe(-3);
  });

  it('rejects a missing seed value', () => {
    expect(() => parseReplayArgs(['--file', 'a.jsonl', '--seed'])).toThrow(REPLAY_USAGE);
  });
});
