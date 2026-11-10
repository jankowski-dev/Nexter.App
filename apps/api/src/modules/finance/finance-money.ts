import { Decimal, decimal } from '../../shared/money/decimal';

/**
 * Personal finance uses BYN as its base currency. Source amounts already have
 * at most two decimals; conversions use half-even rounding so the totals match
 * the Notion rollups and do not accumulate upward bias over many rows.
 */
export function roundFinanceAmount(value: Decimal): string {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN).toFixed(2);
}

export function financeBaseAmount(amount: string | Decimal, fxRate: string): string {
  return roundFinanceAmount(decimal(amount).mul(fxRate));
}
