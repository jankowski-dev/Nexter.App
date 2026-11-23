import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { Candle } from '../types';
import { CandleValidationError, sortAndValidateCandles } from './candles';

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

/**
 * Loads a JSONL candle file.
 *
 * Malformed JSON is reported first, with its 1-based line number, so a broken
 * stream is never masked by an earlier record that is simply incomplete.
 * Schema errors are then reported per line before the set is sorted and
 * validated as a whole.
 */
export async function loadJsonlCandles(filePath: string): Promise<Candle[]> {
  const raw = await readFile(filePath, 'utf8');
  const parsed: Array<{ line: number; value: unknown }> = [];
  const lines = raw.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim();
    if (!line) continue;
    try {
      parsed.push({ line: index + 1, value: JSON.parse(line) });
    } catch (error) {
      throw new CandleValidationError(
        `Invalid candle JSON at line ${index + 1}: ${String(error)}`,
      );
    }
  }

  const candles: Candle[] = [];
  for (const record of parsed) {
    const result = candleInputSchema.safeParse(record.value);
    if (!result.success) {
      throw new CandleValidationError(
        `Invalid candle at line ${record.line}: ${result.error.message}`,
      );
    }
    candles.push(result.data);
  }
  return sortAndValidateCandles(candles);
}
