import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { MonthPicker } from '@/components/ui/date-picker';
import { PageHeader } from '@/components/ui/page-header';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import {
  fetchFinanceAccounts,
  fetchFinanceCategories,
  fetchFinanceFxRates,
  fetchFinanceJournal,
  fetchFinanceSummary,
  updateFinanceAccount,
  updateFinanceCategory,
  updateFinanceTransaction,
  updateFinanceTransfer,
} from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import { formatDate } from '@/lib/format';
import { useConfirm } from '@/lib/confirm';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Decimal } from 'decimal.js';
import { useMemo, useState } from 'react';
import type {
  FinanceAccount,
  FinanceCategory,
  FinanceCategoryKind,
  FinanceCurrency,
  FinanceTransaction,
  FinanceTransfer,
} from '@nexter/contracts';
import { FinanceAccountDialog, FinanceCategoryDialog } from './finance-dialogs';
import { FinanceOperationDialog } from './finance-operation-dialog';
import type { FinanceOperationKind } from './finance-operation';
import { categoryColorClass } from './category-colors';
import { FinanceCreditDialog } from './finance-credit-dialog';
import {
  accountKindLabels,
  financeMoney as money,
  monthLabel,
  transferKindLabels,
} from './finance-view-model';
import {
  FinanceAccountsBlock,
  FinanceCategoriesBlock,
  FinanceMonthsBlock,
} from './finance-visuals';

type FinanceTab = 'overview' | 'journal' | 'accounts' | 'categories';
type JournalFilter = 'all' | 'income' | 'expense' | 'transfer' | 'cancelled';
type PeriodPreset = 'current' | 'previous' | 'custom' | 'year' | 'all';

const tabLabels: Record<FinanceTab, string> = {
  overview: 'Обзор',
  journal: 'Операции',
  accounts: 'Счета',
  categories: 'Категории',
};

const periodLabels: Record<PeriodPreset, string> = {
  current: 'Текущий месяц',
  previous: 'Прошлый месяц',
  custom: 'Выбрать месяц',
  year: 'За год',
  all: 'За всё время',
};

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function shiftMonth(month: string, delta: number): string {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
}

function localDateString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

function monthEnd(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, monthNumber, 0));
  return date.toISOString().slice(0, 10);
}

function Kpi({
  label,
  value,
  hint,
  tone,
  surface,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: string;
  surface?: 'emerald' | 'sky' | 'amber' | 'violet' | 'rose';
}) {
  return (
    <Card className={surface ? `tone-surface tone-surface-${surface}` : undefined}>
      <CardTitle>{label}</CardTitle>
      <div
        className={`mt-1 font-mono text-xl font-semibold tabular-nums 2xl:text-2xl ${tone ?? 'text-zinc-900'}`}
      >
        {value}
      </div>
      {hint ? <CardDescription>{hint}</CardDescription> : null}
    </Card>
  );
}

export function FinancePage() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [tab, setTab] = useState<FinanceTab>('overview');
  const [period, setPeriod] = useState<PeriodPreset>('current');
  const [customMonth, setCustomMonth] = useState(currentMonth);
  const [journalFilter, setJournalFilter] = useState<JournalFilter>('all');
  const [operationDialog, setOperationDialog] = useState<{
    kind?: FinanceOperationKind;
    transaction?: FinanceTransaction;
    transfer?: FinanceTransfer;
  } | null>(null);
  const [accountDialog, setAccountDialog] = useState<{ account?: FinanceAccount } | null>(null);
  const [creditDialogOpen, setCreditDialogOpen] = useState(false);
  const [categoryDialog, setCategoryDialog] = useState<{
    category?: FinanceCategory;
    kind?: FinanceCategoryKind;
  } | null>(null);

  const periodRange = useMemo(() => {
    const today = new Date();
    const current = currentMonth();

    if (period === 'all') {
      return {
        from: undefined,
        to: undefined,
        all: true,
        month: current,
        label: 'Всё время',
      };
    }

    if (period === 'year') {
      const year = today.getFullYear();
      return {
        from: `${year}-01-01`,
        to: localDateString(today),
        all: false,
        month: current,
        label: `${year} год`,
      };
    }

    const month =
      period === 'previous' ? shiftMonth(current, -1) : period === 'custom' ? customMonth : current;

    return {
      from: `${month}-01`,
      to: monthEnd(month),
      all: false,
      month,
      label: monthLabel(month),
    };
  }, [period, customMonth]);

  const periodDays = useMemo(() => {
    if (period === 'all') return null;

    const today = new Date();

    if (period === 'year') {
      const start = new Date(today.getFullYear(), 0, 1);
      return Math.max(1, Math.floor((today.getTime() - start.getTime()) / 86_400_000) + 1);
    }

    const [year, month] = periodRange.month.split('-').map(Number);

    if (!year || !month) return null;

    if (periodRange.month === currentMonth()) {
      return Math.max(1, today.getDate());
    }

    return new Date(year, month, 0).getDate();
  }, [period, periodRange.month]);

  const summary = useQuery({
    queryKey: [
      'finance-summary',
      periodRange.from ?? null,
      periodRange.to ?? null,
      periodRange.all,
      periodRange.month,
    ],
    queryFn: () =>
      fetchFinanceSummary({
        month: periodRange.month,
        months: 12,
        from: periodRange.from,
        to: periodRange.to,
        all: periodRange.all,
      }),
  });
  const accounts = useQuery({ queryKey: ['finance-accounts'], queryFn: fetchFinanceAccounts });
  const categories = useQuery({
    queryKey: ['finance-categories'],
    queryFn: fetchFinanceCategories,
  });
  const fxRates = useQuery({ queryKey: ['finance-fx-rates'], queryFn: fetchFinanceFxRates });
  const journal = useQuery({
    queryKey: ['finance-journal', periodRange.from ?? null, periodRange.to ?? null, journalFilter],
    queryFn: () =>
      fetchFinanceJournal({
        from: periodRange.from,
        to: periodRange.to,
        includeArchived: journalFilter === 'cancelled',
        limit: 500,
      }),
  });
  const accountRows = accounts.data?.accounts ?? [];
  const rateRows = fxRates.data?.rates ?? [];
  const usdRate =
    rateRows.find((rate) => rate.currency === 'USD')?.rate ??
    accountRows.find((account) => account.currency === 'USD' && !account.archivedAt)?.fxRate ??
    null;
  const categoryRows = categories.data?.categories ?? [];
  const accountById = new Map(accountRows.map((account) => [account.id, account]));
  const categoryById = new Map(categoryRows.map((category) => [category.id, category]));
  const categoryColorById = new Map(categoryRows.map((category) => [category.id, category.color]));

  function invalidate(): void {
    for (const key of [
      'finance-summary',
      'finance-accounts',
      'finance-categories',
      'finance-journal',
    ]) {
      void queryClient.invalidateQueries({ queryKey: [key] });
    }
  }

  const archiveAccount = useMutation({
    mutationFn: (account: FinanceAccount) =>
      updateFinanceAccount(account.id, { archived: !account.archivedAt }),
    onSuccess: invalidate,
  });
  const archiveCategory = useMutation({
    mutationFn: (category: FinanceCategory) =>
      updateFinanceCategory(category.id, { archived: !category.archivedAt }),
    onSuccess: invalidate,
  });
  const archiveTransaction = useMutation({
    mutationFn: ({
      transaction,
      archived,
    }: {
      transaction: FinanceTransaction;
      archived: boolean;
    }) => updateFinanceTransaction(transaction.id, { archived }),
    onSuccess: () => {
      invalidate();
    },
  });
  const archiveTransfer = useMutation({
    mutationFn: ({ transfer, archived }: { transfer: FinanceTransfer; archived: boolean }) =>
      updateFinanceTransfer(transfer.id, { archived }),
    onSuccess: () => {
      invalidate();
    },
  });
  function journalRows(): Array<{
    id: string;
    type: 'income' | 'expense' | 'transfer';
    date: string;
    title: string;
    subtitle: string;
    amount: string;
    currency: FinanceCurrency;
    baseAmount: string;
    transaction?: FinanceTransaction;
    transfer?: FinanceTransfer;
    archived: boolean;
  }> {
    const rows: Array<{
      id: string;
      type: 'income' | 'expense' | 'transfer';
      date: string;
      title: string;
      subtitle: string;
      amount: string;
      currency: FinanceCurrency;
      baseAmount: string;
      transaction?: FinanceTransaction;
      transfer?: FinanceTransfer;
      archived: boolean;
    }> = [];

    for (const transaction of journal.data?.transactions ?? []) {
      const account = accountById.get(transaction.accountId);
      const category = transaction.categoryId ? categoryById.get(transaction.categoryId) : null;
      rows.push({
        id: `t:${transaction.id}`,
        type: transaction.kind,
        date: transaction.occurredOn,
        title: transaction.title,
        subtitle: [category?.name, account?.name].filter(Boolean).join(' · '),
        amount: transaction.amount,
        currency: transaction.currency,
        baseAmount: transaction.baseAmount,
        transaction,
        archived: Boolean(transaction.archivedAt),
      });
    }

    for (const transfer of journal.data?.transfers ?? []) {
      const from = accountById.get(transfer.fromAccountId);
      const to = accountById.get(transfer.toAccountId);
      rows.push({
        id: `r:${transfer.id}`,
        type: 'transfer',
        date: transfer.occurredOn,
        title: transferKindLabels[transfer.kind] ?? 'Перевод',
        subtitle: `${from?.name ?? '—'} → ${to?.name ?? '—'}`,
        amount: transfer.fromAmount,
        currency: transfer.fromCurrency,
        baseAmount: transfer.fromBaseAmount,
        transfer,
        archived: Boolean(transfer.archivedAt),
      });
    }

    return rows
      .filter((row) =>
        journalFilter === 'cancelled'
          ? row.archived
          : !row.archived && (journalFilter === 'all' || row.type === journalFilter),
      )
      .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  }

  const avgIncome =
    summary.data && periodDays
      ? new Decimal(summary.data.incomeBase).div(periodDays).toFixed(2)
      : null;
  const avgExpense =
    summary.data && periodDays
      ? new Decimal(summary.data.expenseBase).div(periodDays).toFixed(2)
      : null;

  const isLoading = summary.isPending || accounts.isPending || categories.isPending;
  const hasError = summary.isError || accounts.isError || categories.isError;

  const tabButton = (value: FinanceTab, label: string) => (
    <button
      key={value}
      type="button"
      role="tab"
      aria-selected={tab === value}
      onClick={() => setTab(value)}
      className={`rounded-xl px-3 py-1.5 text-sm transition-colors ${
        tab === value
          ? 'bg-white font-medium text-zinc-900 shadow-sm'
          : 'text-zinc-500 hover:text-zinc-900'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Финансы"
        subtitle="Доходы, расходы, переводы и счета в BYN, USD, EUR и CNY."
        actions={
          <Button onClick={() => setOperationDialog({ kind: 'expense' })}>Новая операция</Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div
          className="flex flex-wrap gap-1 rounded-xl border border-zinc-200 bg-zinc-50 p-1"
          role="group"
          aria-label="Период финансов"
        >
          {(Object.keys(periodLabels) as PeriodPreset[]).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={period === value}
              onClick={() => setPeriod(value)}
              className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                period === value
                  ? 'bg-white font-medium text-zinc-900 shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-900'
              }`}
            >
              {periodLabels[value]}
            </button>
          ))}
        </div>
        {period === 'custom' ? (
          <div className="w-44">
            <MonthPicker
              label="Месяц периода"
              value={customMonth}
              onChange={(value) => setCustomMonth(value || currentMonth())}
              clearable={false}
            />
          </div>
        ) : null}
        <span className="text-xs text-zinc-500">{periodRange.label}</span>
      </div>

      <div className="flex flex-wrap gap-1 rounded-xl border border-zinc-200 bg-zinc-50 p-1">
        {(Object.keys(tabLabels) as FinanceTab[]).map((value) =>
          tabButton(value, tabLabels[value]),
        )}
      </div>

      {isLoading ? <LoadingRows rows={6} /> : null}
      {hasError ? (
        <ErrorState
          message={toRussianError(
            summary.error ?? accounts.error ?? categories.error,
            'Не удалось загрузить финансы',
          )}
          onRetry={() => {
            void summary.refetch();
            void accounts.refetch();
            void categories.refetch();
          }}
        />
      ) : null}

      {!isLoading && !hasError && tab === 'overview' ? (
        <div className="space-y-8">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <Kpi
              label="Средний расход в день"
              value={periodDays ? money(avgExpense, 'BYN') : '—'}
              hint={periodDays ? `${periodDays} дн. периода` : 'За всё время'}
              tone="text-red-700"
              surface="rose"
            />
            <Kpi
              label="Средний доход в день"
              value={periodDays ? money(avgIncome, 'BYN') : '—'}
              hint={periodDays ? `${periodDays} дн. периода` : 'За всё время'}
              tone="text-emerald-700"
              surface="emerald"
            />
            <Kpi
              label="Расходы"
              value={money(summary.data?.expenseBase, 'BYN')}
              hint={periodRange.label}
              tone="text-red-700"
              surface="rose"
            />
            <Kpi
              label="Доходы"
              value={money(summary.data?.incomeBase, 'BYN')}
              hint={periodRange.label}
              tone="text-emerald-700"
              surface="emerald"
            />
            <Kpi
              label="Чистый поток"
              value={money(summary.data?.netBase, 'BYN')}
              hint="Доходы − расходы"
              tone={Number(summary.data?.netBase ?? 0) >= 0 ? 'text-emerald-700' : 'text-red-700'}
              surface="sky"
            />
            <Kpi
              label="Чистый капитал"
              value={money(summary.data?.netWorthBase, 'BYN')}
              hint={`Активы ${money(summary.data?.assetsBase, 'BYN')} · кредит ${money(summary.data?.liabilitiesBase, 'BYN')}`}
              surface="violet"
            />
          </div>
          <p className="text-xs text-zinc-500">
            Погашение кредита уменьшает долг и входит в расходы; итоговый капитал при этом не
            меняется. Сама операция — во вкладке «Переводы».
          </p>

          <div className="grid items-stretch gap-6 xl:grid-cols-2">
            <FinanceAccountsBlock
              accounts={accountRows}
              assetsBase={summary.data?.assetsBase}
              liabilitiesBase={summary.data?.liabilitiesBase}
              netWorthBase={summary.data?.netWorthBase}
              onManage={() => setTab('accounts')}
            />
            <FinanceCategoriesBlock
              categories={summary.data?.categories ?? []}
              colorById={categoryColorById}
              periodLabel={periodRange.label}
              onAddExpense={() => setOperationDialog({ kind: 'expense' })}
            />
          </div>

          <FinanceMonthsBlock months={summary.data?.months ?? []} usdRate={usdRate} />
        </div>
      ) : null}

      {!isLoading && !hasError && tab === 'journal' ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                ['all', 'Все'],
                ['income', 'Доходы'],
                ['expense', 'Расходы'],
                ['transfer', 'Переводы'],
                ['cancelled', 'Отменённые'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setJournalFilter(value)}
                className={`rounded-xl border px-3 py-1.5 text-sm ${
                  journalFilter === value
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                    : 'border-zinc-200 bg-white text-zinc-600 hover:text-zinc-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="text-xs text-zinc-500">
            Отменённые операции не удаляются безвозвратно: открой вкладку «Отменённые», чтобы
            вернуть их.
          </p>

          {journal.isPending ? <LoadingRows rows={6} /> : null}
          {journal.isError ? (
            <ErrorState
              message={toRussianError(journal.error, 'Не удалось загрузить операции')}
              onRetry={() => void journal.refetch()}
            />
          ) : null}
          {!journal.isPending && !journal.isError ? (
            journalRows().length === 0 ? (
              <Card>
                <CardTitle>Операций за период нет</CardTitle>
                <CardDescription>Добавьте доход, расход или перевод.</CardDescription>
              </Card>
            ) : (
              <Card className="overflow-x-auto p-0">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
                      <th className="px-4 py-3 font-medium">Дата</th>
                      <th className="px-4 py-3 font-medium">Тип</th>
                      <th className="px-4 py-3 font-medium">Операция</th>
                      <th className="px-4 py-3 text-right font-medium">Сумма</th>
                      <th className="px-4 py-3 text-right font-medium">В BYN</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {journalRows().map((row) => (
                      <tr
                        key={row.id}
                        className={`border-b border-zinc-100 last:border-0 ${
                          row.archived ? 'opacity-50' : ''
                        }`}
                      >
                        <td className="px-4 py-3 text-zinc-600">{formatDate(row.date)}</td>
                        <td className="px-4 py-3">
                          <Badge
                            tone={
                              row.type === 'income'
                                ? 'success'
                                : row.type === 'expense'
                                  ? 'danger'
                                  : 'info'
                            }
                          >
                            {row.type === 'income'
                              ? 'Доход'
                              : row.type === 'expense'
                                ? 'Расход'
                                : 'Перевод'}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-zinc-900">{row.title}</span>
                            {row.archived ? <Badge tone="neutral">Отменена</Badge> : null}
                          </div>
                          <div className="text-xs text-zinc-500">{row.subtitle}</div>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-zinc-900">
                          {money(row.amount, row.currency)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-zinc-600">
                          {money(row.baseAmount, 'BYN')}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button
                            variant="ghost"
                            className="h-8 px-2 text-xs"
                            onClick={() => {
                              if (row.transaction) {
                                setOperationDialog({ transaction: row.transaction });
                              } else if (row.transfer) {
                                setOperationDialog({ transfer: row.transfer });
                              }
                            }}
                          >
                            Изменить
                          </Button>
                          <Button
                            variant="ghost"
                            className={`h-8 px-2 text-xs ${
                              row.archived ? 'text-zinc-600' : 'text-red-700'
                            }`}
                            onClick={async () => {
                              const archived = !row.archived;
                              if (
                                archived &&
                                !(await confirm({
                                  title: 'Отменить операцию?',
                                  description: 'Она исчезнет из статистики, но останется в архиве.',
                                  confirmLabel: 'Отменить операцию',
                                  variant: 'danger',
                                }))
                              ) {
                                return;
                              }
                              if (row.transaction) {
                                archiveTransaction.mutate({
                                  transaction: row.transaction,
                                  archived,
                                });
                              } else if (row.transfer) {
                                archiveTransfer.mutate({ transfer: row.transfer, archived });
                              }
                            }}
                          >
                            {row.archived ? 'Вернуть' : 'Отменить'}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )
          ) : null}
        </div>
      ) : null}

      {!isLoading && !hasError && tab === 'accounts' ? (
        <div className="space-y-3">
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreditDialogOpen(true)}>
              Получить кредит
            </Button>
            <Button onClick={() => setAccountDialog({})}>+ Счёт</Button>
          </div>
          <div className="space-y-2">
            {accountRows.map((account) => (
              <div
                key={account.id}
                className={`rounded-xl border border-zinc-200 bg-white px-3 py-2 transition-colors hover:border-emerald-300 ${
                  account.archivedAt ? 'opacity-60' : ''
                }`}
              >
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-[180px] flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-zinc-900">{account.name}</span>
                      <Badge tone={account.kind === 'credit' ? 'warning' : 'success'}>
                        {account.kind === 'credit' ? 'обязательство' : 'актив'}
                      </Badge>
                      {account.archivedAt ? <Badge tone="neutral">архив</Badge> : null}
                    </div>
                    <div className="mt-0.5 text-[11px] text-zinc-500">
                      {accountKindLabels[account.kind]} · {account.currency} · курс{' '}
                      {Number(account.fxRate).toLocaleString('ru-RU', {
                        maximumFractionDigits: 8,
                      })}
                    </div>
                  </div>
                  <div className="ml-auto text-right">
                    <div className="font-mono text-lg font-semibold tabular-nums text-zinc-900">
                      {money(account.balance, account.currency)}
                    </div>
                    <div className="text-[11px] text-zinc-500">
                      {money(account.balanceBase, 'BYN')}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      className="h-8 px-3 text-xs"
                      onClick={() => setAccountDialog({ account })}
                    >
                      Изменить
                    </Button>
                    <Button
                      variant="ghost"
                      className="h-8 px-3 text-xs"
                      onClick={async () => {
                        if (account.archivedAt) {
                          archiveAccount.mutate(account);
                          return;
                        }
                        if (
                          await confirm({
                            title: 'Архивировать счёт?',
                            description: `Счёт «${account.name}» перейдёт в архив. История сохранится.`,
                            confirmLabel: 'В архив',
                            variant: 'danger',
                          })
                        ) {
                          archiveAccount.mutate(account);
                        }
                      }}
                    >
                      {account.archivedAt ? 'Вернуть' : 'В архив'}
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {!isLoading && !hasError && tab === 'categories' ? (
        <div className="grid gap-6 lg:grid-cols-2">
          {(['expense', 'income'] as const).map((kind) => (
            <Card key={kind}>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <CardTitle>{kind === 'expense' ? 'Расходы' : 'Доходы'}</CardTitle>
                  <CardDescription>Категории для операций.</CardDescription>
                </div>
                <Button
                  variant="secondary"
                  className="h-8 px-3 text-xs"
                  onClick={() => setCategoryDialog({ kind })}
                >
                  + Категория
                </Button>
              </div>
              <div className="mt-4 space-y-2">
                {categoryRows
                  .filter((category) => category.kind === kind)
                  .map((category) => (
                    <div
                      key={category.id}
                      className={`flex items-center justify-between gap-2 rounded-xl border border-zinc-200 px-3 py-2 ${
                        category.archivedAt ? 'opacity-50' : ''
                      }`}
                    >
                      <span className="flex items-center gap-2 text-sm text-zinc-800">
                        <span
                          className={`h-2.5 w-2.5 rounded-full ${
                            categoryColorClass[category.color ?? 'default'] ??
                            categoryColorClass.default
                          }`}
                        />
                        {category.name}
                      </span>
                      <span className="flex gap-1">
                        <Button
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          onClick={() => setCategoryDialog({ category })}
                        >
                          Изменить
                        </Button>
                        <Button
                          variant="ghost"
                          className="h-7 px-2 text-xs text-zinc-500"
                          onClick={() => archiveCategory.mutate(category)}
                        >
                          {category.archivedAt ? 'Вернуть' : 'В архив'}
                        </Button>
                      </span>
                    </div>
                  ))}
              </div>
            </Card>
          ))}
        </div>
      ) : null}

      {operationDialog ? (
        <FinanceOperationDialog
          kind={operationDialog.kind}
          transaction={operationDialog.transaction}
          transfer={operationDialog.transfer}
          accounts={accountRows}
          categories={categoryRows}
          onClose={() => setOperationDialog(null)}
          onSaved={invalidate}
        />
      ) : null}
      {creditDialogOpen ? (
        <FinanceCreditDialog
          accounts={accountRows}
          fxRates={rateRows}
          onClose={() => setCreditDialogOpen(false)}
          onSaved={invalidate}
        />
      ) : null}
      {accountDialog ? (
        <FinanceAccountDialog
          account={accountDialog.account}
          fxRates={rateRows}
          onClose={() => setAccountDialog(null)}
          onSaved={invalidate}
        />
      ) : null}
      {categoryDialog ? (
        <FinanceCategoryDialog
          category={categoryDialog.category}
          kind={categoryDialog.kind}
          onClose={() => setCategoryDialog(null)}
          onSaved={invalidate}
        />
      ) : null}
    </div>
  );
}
