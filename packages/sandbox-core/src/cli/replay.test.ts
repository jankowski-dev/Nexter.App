import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runReplayFromFile } from './replay';

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
