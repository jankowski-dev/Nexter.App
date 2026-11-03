import Decimal from 'decimal.js';

Decimal.set({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -30,
  toExpPos: 40,
});

export const AMOUNT_SCALE = 18;
export const USD_SCALE = 8;

export function decimal(value: string | Decimal): Decimal {
  const result = value instanceof Decimal ? value : new Decimal(value);

  if (!result.isFinite()) {
    throw new Error('Decimal value must be finite');
  }

  return result;
}

export function amountString(value: Decimal): string {
  return value.toFixed(AMOUNT_SCALE);
}

export function usdString(value: Decimal): string {
  return value.toFixed(USD_SCALE);
}

export function assertScale(value: Decimal, scale: number, label: string): void {
  if (value.decimalPlaces() > scale) {
    throw new Error(`${label} supports at most ${scale} decimal places`);
  }
}

export { Decimal };
