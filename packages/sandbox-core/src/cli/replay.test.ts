import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runReplayFromFile } from './replay';

const candles = [
  { tokenId: 'btc', timeframe: '1h', openTime: '2026-01-01T00:00:00.000Z', open: '100', high: '101', low: '99', close: '100', volumeUsd: '10' },
  { tokenId: 'btc', timeframe: '1h', openTime: '2026-01-01T01:00:00.000Z', open: '100', high: '102', low: '100', close: '101', volumeUsd: '11' },
  { tokenId: 'btc', timeframe: '1h', openTime: '2026-01-01T02:00:00.000Z', open: '101', high: '103', low: '101', close: '102', volumeUsd: '12' },
];

describe('runReplayFromFile', () => {
  it('writes a deterministic event log and summary', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sandbox-'));
    const input = join(dir, 'candles.jsonl');
    const output1 = join(dir, 'events-1.jsonl');
    const output2 = join(dir, 'events-2.jsonl');
    await writeFile(input, candles.map((candle) => JSON.stringify(candle)).join('\n'));

    const one = await runReplayFromFile({ filePath: input, outputPath: output1, runId: 'run-1', seed: 7 });
    const two = await runReplayFromFile({ filePath: input, outputPath: output2, runId: 'run-1', seed: 7 });

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
      runReplayFromFile({ filePath: input, outputPath: join(dir, 'events.jsonl'), runId: 'run-1', seed: 7 }),
    ).rejects.toThrow(/no candles/i);
  });
});
