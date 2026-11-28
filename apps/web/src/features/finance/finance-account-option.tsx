import { Decimal } from 'decimal.js';
import type { FinanceAccountWithBalance } from '@nexter/contracts';
import { financeMoney } from './finance-view-model';

function balanceTone(balance: string): string {
  const value = new Decimal(balance);
  if (value.gt(0)) return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (value.lt(0)) return 'border-rose-200 bg-rose-50 text-rose-700';
  return 'border-zinc-200 bg-zinc-100 text-zinc-600';
}

export function FinanceAccountOption({
  account,
}: {
  account: Pick<FinanceAccountWithBalance, 'name' | 'currency' | 'balance'>;
}) {
  return (
    <span className="flex w-full min-w-0 items-center justify-between gap-2">
      <span className="min-w-0 truncate">{account.name}</span>
      <span
        className={`shrink-0 rounded-md border px-1.5 py-0.5 font-mono text-[11px] tabular-nums ${balanceTone(account.balance)}`}
      >
        {financeMoney(account.balance, account.currency)}
      </span>
    </span>
  );
}
