import type { BotCandle } from '@nexter/contracts';

const DAY_MS = 86_400_000;

export function countMissingDays(candles: BotCandle[]): number {
  let missing = 0;
  for (let index = 1; index < candles.length; index += 1) {
    const previous = Date.parse(`${candles[index - 1]?.date}T00:00:00.000Z`);
    const current = Date.parse(`${candles[index]?.date}T00:00:00.000Z`);
    if (!Number.isFinite(previous) || !Number.isFinite(current)) continue;
    const gap = Math.round((current - previous) / DAY_MS) - 1;
    if (gap > 0) missing += gap;
  }
  return missing;
}
