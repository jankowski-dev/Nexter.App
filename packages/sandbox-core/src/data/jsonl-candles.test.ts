import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadJsonlCandles } from './jsonl-candles';
import { snapshotCandles } from './snapshot';

describe('loadJsonlCandles', () => {
  it('parses ISO and numeric openTime and normalizes to epoch ms', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sandbox-'));
    const file = join(dir, 'candles.jsonl');
    await writeFile(
      file,
      [
        '{"tokenId":"btc","timeframe":"1h","openTime":"2026-01-01T00:00:00.000Z","open":"100","high":"101","low":"99","close":"100","volumeUsd":"10"}',
        '{"tokenId":"btc","timeframe":"1h","openTime":1767229200000,"open":"100","high":"101","low":"99","close":"100","volumeUsd":"10"}',
      ].join('\n'),
    );
    const candles = await loadJsonlCandles(file);
    expect(candles).toHaveLength(2);
    expect(candles[0]?.openTime).toBe(Date.parse('2026-01-01T00:00:00.000Z'));
  });

  it('reports the line number on invalid JSON', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sandbox-'));
    const file = join(dir, 'bad.jsonl');
    await writeFile(file, '{"tokenId":"btc"}\nnot-json\n');
    await expect(loadJsonlCandles(file)).rejects.toThrow(/line 2/);
  });
});

describe('snapshotCandles', () => {
  it('is order-independent and changes with data', () => {
    const a = {
      tokenId: 'btc',
      timeframe: '1h',
      openTime: 1_000,
      open: '100',
      high: '101',
      low: '99',
      close: '100',
      volumeUsd: '10',
    };
    const b = { ...a, openTime: 2_000 };
    const one = snapshotCandles([a, b]);
    const two = snapshotCandles([b, a]);
    expect(one.id).toBe(two.id);
    expect(snapshotCandles([{ ...a, close: '101' }, b]).id).not.toBe(one.id);
  });
});
