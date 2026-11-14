import { describe, expect, it } from 'vitest';
import { evaluateExpression, normalizeAmountInput } from './expression';

describe('evaluateExpression', () => {
  it('evaluates the finance example with a comma decimal', () => {
    expect(evaluateExpression('18,55-6-89-56')).toBe('-132.45');
  });

  it('supports precedence, parentheses and unary values', () => {
    expect(evaluateExpression('100/4+2.5')).toBe('27.5');
    expect(evaluateExpression('(10+2)*3')).toBe('36');
    expect(evaluateExpression('-(10+2)')).toBe('-12');
    expect(evaluateExpression('10 000,50')).toBe('10000.5');
  });

  it('normalizes plain amounts without changing them', () => {
    expect(normalizeAmountInput('18,55')).toBe('18.55');
    expect(normalizeAmountInput(' 42 ')).toBe('42');
    expect(normalizeAmountInput('')).toBe('');
  });

  it('rejects malformed expressions and division by zero', () => {
    expect(evaluateExpression('18,55-')).toBeNull();
    expect(evaluateExpression('1/0')).toBeNull();
    expect(evaluateExpression('1,2,3')).toBeNull();
    expect(evaluateExpression('abc')).toBeNull();
  });
});
