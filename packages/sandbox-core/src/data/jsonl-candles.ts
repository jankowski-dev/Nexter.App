import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { Candle } from '../types';
import { sortAndValidateCandles } from './candles';

const candleInputSchema = z.object({
  tokenId: z.string().min(1),
  timeframe: z.string().min(1),
  openTime: z.union([z.number().int(), z.iso.datetime()]).transform((value) =>
    typeof value === 'number' ? value : Date.parse(value),
  ),
  open: z.string().min(1),
  high: z.string().min(1),
  low: z.string().min(1),
  close: z.string().min(1),
  volumeUsd: z.string().min(1),
});

export async function loadJsonlCandles(filePath: string): Promise<Candle[]> {
  const raw = await readFile(filePath, 'utf8');
  const candles: Candle[] = [];
  const lines = raw.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim();
    if (!line) continue;
    try {
      candles.push(candleInputSchema.parse(JSON.parse(line)));
    } catch (error) {
      throw new Error(`Invalid candle JSON at line ${index + 1}: ${String(error)}`);
    }
  }
  return sortAndValidateCandles(candles);
}
