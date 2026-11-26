/**
 * Research-only indicators. The sandbox engine uses SMA and simple ATR; these
 * helpers add EMA/RSI for the diagnostic chart without changing engine rules.
 */

export function emaSeries(values: readonly number[], period: number): Array<number | null> {
  const result: Array<number | null> = new Array(values.length).fill(null);
  if (!Number.isInteger(period) || period <= 0 || values.length < period) return result;

  let seed = 0;
  for (let index = 0; index < period; index += 1) seed += values[index] as number;
  let previous = seed / period;
  result[period - 1] = previous;

  const multiplier = 2 / (period + 1);
  for (let index = period; index < values.length; index += 1) {
    previous = ((values[index] as number) - previous) * multiplier + previous;
    result[index] = previous;
  }
  return result;
}

export function rsiSeries(values: readonly number[], period: number): Array<number | null> {
  const result: Array<number | null> = new Array(values.length).fill(null);
  if (!Number.isInteger(period) || period <= 0 || values.length <= period) return result;

  let gain = 0;
  let loss = 0;
  for (let index = 1; index <= period; index += 1) {
    const delta = (values[index] as number) - (values[index - 1] as number);
    if (delta >= 0) gain += delta;
    else loss -= delta;
  }
  let averageGain = gain / period;
  let averageLoss = loss / period;
  result[period] =
    averageLoss === 0
      ? averageGain === 0
        ? 50
        : 100
      : 100 - 100 / (1 + averageGain / averageLoss);

  for (let index = period + 1; index < values.length; index += 1) {
    const delta = (values[index] as number) - (values[index - 1] as number);
    const currentGain = delta > 0 ? delta : 0;
    const currentLoss = delta < 0 ? -delta : 0;
    averageGain = (averageGain * (period - 1) + currentGain) / period;
    averageLoss = (averageLoss * (period - 1) + currentLoss) / period;
    result[index] =
      averageLoss === 0
        ? averageGain === 0
          ? 50
          : 100
        : 100 - 100 / (1 + averageGain / averageLoss);
  }
  return result;
}
