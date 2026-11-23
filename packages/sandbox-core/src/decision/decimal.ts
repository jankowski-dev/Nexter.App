import Decimal from 'decimal.js';

// One global configuration for the package: 28 significant digits is more than
// enough for USD amounts and percentages, and half-up rounding matches the
// way money is displayed and persisted elsewhere in Nexter.
Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

const DECIMAL = /^\d+(\.\d+)?$/;

export class DecimalInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecimalInputError';
  }
}

/**
 * Parses a non-negative decimal string into a `Decimal`.
 *
 * Rejects everything JavaScript would otherwise coerce loosely: signs, spaces,
 * exponential notation, `NaN`, `Infinity` and non-string input.
 */
export function toDecimal(value: string, label: string): Decimal {
  if (typeof value !== 'string' || !DECIMAL.test(value)) {
    throw new DecimalInputError(`${label} must be a non-negative decimal string`);
  }
  return new Decimal(value);
}

/** Formats a decimal amount as USD-style money with two decimals. */
export function money(value: Decimal): string {
  return value.toFixed(2);
}

/** Formats a decimal percentage with two decimals. */
export function percent(value: Decimal): string {
  return value.toFixed(2);
}

export function minDecimal(...values: Decimal[]): Decimal {
  if (values.length === 0) throw new DecimalInputError('minDecimal requires at least one value');
  let result = values[0] as Decimal;
  for (let index = 1; index < values.length; index += 1) {
    const candidate = values[index] as Decimal;
    if (candidate.lessThan(result)) result = candidate;
  }
  return result;
}

export function maxDecimal(...values: Decimal[]): Decimal {
  if (values.length === 0) throw new DecimalInputError('maxDecimal requires at least one value');
  let result = values[0] as Decimal;
  for (let index = 1; index < values.length; index += 1) {
    const candidate = values[index] as Decimal;
    if (candidate.greaterThan(result)) result = candidate;
  }
  return result;
}
