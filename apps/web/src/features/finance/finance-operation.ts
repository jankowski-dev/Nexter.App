import type { FinanceTransactionKind } from '@nexter/contracts';

export type FinanceOperationKind = FinanceTransactionKind | 'transfer';

export const operationKindLabels: Record<FinanceOperationKind, string> = {
  expense: 'Расход',
  income: 'Доход',
  transfer: 'Перевод',
};

export function resolveOperationTitle(
  title: string,
  categoryName: string | null | undefined,
  kind: FinanceTransactionKind,
): string {
  const trimmed = title.trim();
  if (trimmed) return trimmed;
  const category = categoryName?.trim();
  if (category) return category;
  return kind === 'expense' ? 'Расход' : 'Доход';
}
