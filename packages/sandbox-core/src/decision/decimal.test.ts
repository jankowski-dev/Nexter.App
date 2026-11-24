import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import {
  DecimalInputError,
  maxDecimal,
  minDecimal,
  money,
  moneyDown,
  percent,
  toDecimal,
} from './decimal';

describe('toDecimal', () => {
  it('parses non-negative decimal strings', () => {
    expect(toDecimal('0', 'amount').toFixed(2)).toBe('0.00');
    expect(toDecimal('12.34', 'amount').toFixed(2)).toBe('12.34');
    expect(toDecimal('00012.3400', 'amount').toFixed(2)).toBe('12.34');
  });

  it.each([
    'NaN',
    'Infinity',
    '-Infinity',
    '1e3',
    '1E3',
    '+1',
    '-1',
    ' 1',
    '1 ',
    '',
    '1.2.3',
    '0x10',
    '.5',
    '1.',
    'abc',
  ])('rejects the invalid input %j', (input) => {
    expect(() => toDecimal(input, 'amount')).toThrow(DecimalInputError);
  });

  it('names the failing label in the error', () => {
    expect(() => toDecimal('abc', 'sizeUsd')).toThrow(/sizeUsd/);
  });

  it('does not silently coerce non-string input', () => {
    expect(() => toDecimal(12 as unknown as string, 'amount')).toThrow(DecimalInputError);
  });
});

describe('decimal module configuration', () => {
  it('uses decimal arithmetic for 0.1 + 0.2', () => {
    expect(money(toDecimal('0.1', 'a').plus(toDecimal('0.2', 'b')))).toBe('0.30');
  });

  it('keeps 28 digits of precision for division', () => {
    const third = toDecimal('1', 'one').div(toDecimal('3', 'three'));
    expect(third.toFixed(26)).toBe(`0.${'3'.repeat(26)}`);
  });

  it('rounds half up at two decimals', () => {
    expect(money(toDecimal('1.005', 'amount'))).toBe('1.01');
    expect(percent(toDecimal('2.345', 'ratio'))).toBe('2.35');
  });
});

describe('formatting', () => {
  it('formats money and percent with two decimals', () => {
    expect(money(new Decimal('1234.5'))).toBe('1234.50');
    expect(money(new Decimal('0'))).toBe('0.00');
    expect(percent(new Decimal('12'))).toBe('12.00');
    expect(percent(new Decimal('12.345'))).toBe('12.35');
  });
});

describe('moneyDown', () => {
  it('truncates a fractional cent instead of rounding up', () => {
    expect(moneyDown(new Decimal('1.239'))).toBe('1.23');
    expect(moneyDown(new Decimal('1.999'))).toBe('1.99');
    expect(moneyDown(new Decimal('198.428'))).toBe('198.42');
    expect(moneyDown(new Decimal('200'))).toBe('200.00');
  });

  it('leaves money() half-up so display and risk values keep their rounding', () => {
    expect(money(new Decimal('1.239'))).toBe('1.24');
    expect(money(new Decimal('1.999'))).toBe('2.00');
  });
});

describe('minDecimal / maxDecimal', () => {
  it('returns the minimum and maximum across values', () => {
    expect(minDecimal(new Decimal('2'), new Decimal('1.5'), new Decimal('1.75')).toString()).toBe(
      '1.5',
    );
    expect(maxDecimal(new Decimal('2'), new Decimal('1.5'), new Decimal('1.75')).toString()).toBe(
      '2',
    );
  });

  it('returns the only value for a single argument', () => {
    expect(minDecimal(new Decimal('3')).toString()).toBe('3');
    expect(maxDecimal(new Decimal('3')).toString()).toBe('3');
  });

  it('rejects an empty argument list', () => {
    expect(() => minDecimal()).toThrow();
    expect(() => maxDecimal()).toThrow();
  });
});
