import type { FinanceAccountWithBalance, FinanceTransactionKind } from '@nexter/contracts';
import { financeMoney } from './finance-view-model';

export type FinanceOperationKind = FinanceTransactionKind | 'transfer';

export const operationKindLabels: Record<FinanceOperationKind, string> = {
  expense: 'Расход',
  income: 'Доход',
  transfer: 'Перевод',
};

export function accountOptionLabel(
  account: Pick<FinanceAccountWithBalance, 'name' | 'currency' | 'balance'>,
): string {
  return `${account.name} · ${financeMoney(account.balance, account.currency)}`;
}

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
