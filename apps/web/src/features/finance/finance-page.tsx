import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import {
  commitFinanceImport,
  fetchFinanceAccounts,
  fetchFinanceCategories,
  fetchFinanceImports,
  fetchFinanceJournal,
  fetchFinanceSummary,
  previewFinanceImport,
  rollbackFinanceImport,
  updateFinanceAccount,
  updateFinanceCategory,
  updateFinanceTransaction,
  updateFinanceTransfer,
} from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import { formatDate } from '@/lib/format';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import type {
  FinanceAccount,
  FinanceAccountKind,
  FinanceCategory,
  FinanceCategoryKind,
  FinanceCurrency,
  FinanceImport,
  FinanceImportRequest,
  FinanceTransaction,
  FinanceTransactionKind,
  FinanceTransfer,
  FinanceTransferKind,
} from '@nexter/contracts';
import {
  FinanceAccountDialog,
  FinanceCategoryDialog,
  FinanceTransactionDialog,
  FinanceTransferDialog,
} from './finance-dialogs';
import { FinanceCreditDialog } from './finance-credit-dialog';

type FinanceTab = 'overview' | 'journal' | 'accounts' | 'categories' | 'import';
type JournalFilter = 'all' | 'income' | 'expense' | 'transfer' | 'cancelled';

const tabLabels: Record<FinanceTab, string> = {
  overview: 'Обзор',
  journal: 'Операции',
  accounts: 'Счета',
  categories: 'Категории',
  import: 'Импорт',
};

const accountKindLabels: Record<FinanceAccountKind, string> = {
  cash: 'Наличные',
  card: 'Карта',
  bank: 'Банк',
  savings: 'Накопления',
  investment: 'Инвестиции',
  credit: 'Кредит',
};

const transferKindLabels: Record<FinanceTransferKind, string> = {
  exchange: 'Обмен валют',
  card_topup: 'Пополнение карты',
  credit: 'Кредит',
  other: 'Другое',
};

const categoryColorClass: Record<string, string> = {
  purple: 'bg-violet-500',
  red: 'bg-red-500',
  green: 'bg-emerald-500',
  orange: 'bg-orange-500',
  yellow: 'bg-amber-400',
  gray: 'bg-zinc-400',
  blue: 'bg-sky-500',
  brown: 'bg-amber-700',
  pink: 'bg-pink-500',
  default: 'bg-zinc-300',
};

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function monthEnd(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, monthNumber, 0));
  return date.toISOString().slice(0, 10);
}

function money(
  value: string | number | null | undefined,
  currency: FinanceCurrency | 'BYN',
): string {
  if (value === null || value === undefined || value === '') return '—';
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(number);
}

function monthLabel(month: string): string {
  return new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' }).format(
    new Date(`${month}-01T12:00:00`),
  );
}

function statusTone(status: string): 'success' | 'warning' | 'neutral' {
  if (status === 'committed') return 'success';
  if (status === 'preview') return 'warning';
  return 'neutral';
}

function Kpi({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: string;
}) {
  return (
    <Card>
      <CardTitle>{label}</CardTitle>
      <div
        className={`mt-1 font-mono text-2xl font-semibold tabular-nums ${tone ?? 'text-zinc-900'}`}
      >
        {value}
      </div>
      {hint ? <CardDescription>{hint}</CardDescription> : null}
    </Card>
  );
}

export function FinancePage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<FinanceTab>('overview');
  const [month, setMonth] = useState(currentMonth);
  const [journalFilter, setJournalFilter] = useState<JournalFilter>('all');
  const [notice, setNotice] = useState<string | null>(null);
  const [transactionDialog, setTransactionDialog] = useState<{
    transaction?: FinanceTransaction;
    kind?: FinanceTransactionKind;
  } | null>(null);
  const [transferDialog, setTransferDialog] = useState<{ transfer?: FinanceTransfer } | null>(null);
  const [accountDialog, setAccountDialog] = useState<{ account?: FinanceAccount } | null>(null);
  const [creditDialogOpen, setCreditDialogOpen] = useState(false);
  const [categoryDialog, setCategoryDialog] = useState<{
    category?: FinanceCategory;
    kind?: FinanceCategoryKind;
  } | null>(null);
  const [importPreview, setImportPreview] = useState<FinanceImport | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const summary = useQuery({
    queryKey: ['finance-summary', month],
    queryFn: () => fetchFinanceSummary(month, 12),
  });
  const accounts = useQuery({ queryKey: ['finance-accounts'], queryFn: fetchFinanceAccounts });
  const categories = useQuery({
    queryKey: ['finance-categories'],
    queryFn: fetchFinanceCategories,
  });
  const journal = useQuery({
    queryKey: ['finance-journal', month, journalFilter],
    queryFn: () =>
      fetchFinanceJournal({
        from: `${month}-01`,
        to: monthEnd(month),
        includeArchived: journalFilter === 'cancelled',
        limit: 500,
      }),
  });
  const imports = useQuery({ queryKey: ['finance-imports'], queryFn: fetchFinanceImports });

  const accountRows = accounts.data?.accounts ?? [];
  const categoryRows = categories.data?.categories ?? [];
  const accountById = new Map(accountRows.map((account) => [account.id, account]));
  const categoryById = new Map(categoryRows.map((category) => [category.id, category]));

  function invalidate(): void {
    for (const key of [
      'finance-summary',
      'finance-accounts',
      'finance-categories',
      'finance-journal',
      'finance-imports',
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
    onSuccess: (_data, variables) => {
      setNotice(
        variables.archived
          ? 'Операция отменена. Вернуть её можно во вкладке «Отменённые».'
          : 'Операция возвращена.',
      );
      invalidate();
    },
  });
  const archiveTransfer = useMutation({
    mutationFn: ({ transfer, archived }: { transfer: FinanceTransfer; archived: boolean }) =>
      updateFinanceTransfer(transfer.id, { archived }),
    onSuccess: (_data, variables) => {
      setNotice(
        variables.archived
          ? 'Перевод отменён. Вернуть его можно во вкладке «Отменённые».'
          : 'Перевод возвращён.',
      );
      invalidate();
    },
  });
  const commitImport = useMutation({
    mutationFn: (id: string) => commitFinanceImport(id),
    onSuccess: () => {
      setImportPreview(null);
      invalidate();
    },
    onError: (error) => setImportError(toRussianError(error, 'Не удалось применить импорт')),
  });
  const rollbackImport = useMutation({
    mutationFn: (id: string) => rollbackFinanceImport(id),
    onSuccess: invalidate,
    onError: (error) => setImportError(toRussianError(error, 'Не удалось откатить импорт')),
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

  async function readImportFile(file: File | undefined): Promise<void> {
    if (!file) return;
    setImportError(null);
    setImportPreview(null);

    try {
      const payload = JSON.parse(await file.text()) as FinanceImportRequest;
      const preview = await previewFinanceImport(payload);
      setImportPreview(preview);
    } catch (error) {
      setImportError(toRussianError(error, 'Не удалось прочитать или проверить файл импорта'));
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

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
        subtitle="Доходы, расходы, переводы и счета в BYN, USD и EUR."
        actions={
          <>
            <Input
              className="h-9 w-40"
              type="month"
              aria-label="Месяц финансов"
              value={month}
              onChange={(event) => setMonth(event.target.value || currentMonth())}
            />
            <Button variant="secondary" onClick={() => setTransactionDialog({ kind: 'income' })}>
              + Доход
            </Button>
            <Button variant="secondary" onClick={() => setTransactionDialog({ kind: 'expense' })}>
              + Расход
            </Button>
            <Button onClick={() => setTransferDialog({})}>+ Перевод</Button>
          </>
        }
      />

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
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi
              label="Доходы за месяц"
              value={money(summary.data?.incomeBase, 'BYN')}
              hint={monthLabel(month)}
              tone="text-emerald-700"
            />
            <Kpi
              label="Расходы за месяц"
              value={money(summary.data?.expenseBase, 'BYN')}
              hint={monthLabel(month)}
              tone="text-red-700"
            />
            <Kpi
              label="Чистый поток"
              value={money(summary.data?.netBase, 'BYN')}
              hint="Доходы − расходы"
              tone={Number(summary.data?.netBase ?? 0) >= 0 ? 'text-emerald-700' : 'text-red-700'}
            />
            <Kpi
              label="Net worth"
              value={money(summary.data?.netWorthBase, 'BYN')}
              hint={`Активы ${money(summary.data?.assetsBase, 'BYN')} · кредит ${money(summary.data?.liabilitiesBase, 'BYN')}`}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardTitle>Счета</CardTitle>
              <CardDescription>Текущие балансы по валютам.</CardDescription>
              <div className="mt-4 space-y-2">
                {accountRows.map((account) => (
                  <div
                    key={account.id}
                    className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-200 px-3 py-2 ${
                      account.archivedAt ? 'opacity-50' : ''
                    }`}
                  >
                    <div>
                      <div className="text-sm font-medium text-zinc-900">{account.name}</div>
                      <div className="text-xs text-zinc-500">
                        {accountKindLabels[account.kind]} · {account.currency}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-sm font-semibold text-zinc-900">
                        {money(account.balance, account.currency)}
                      </div>
                      <div className="text-xs text-zinc-500">
                        {money(account.balanceBase, 'BYN')}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <CardTitle>Категории месяца</CardTitle>
              <CardDescription>{monthLabel(month)}</CardDescription>
              <div className="mt-4 space-y-3">
                {(summary.data?.categories ?? []).length === 0 ? (
                  <p className="text-sm text-zinc-500">Операций за месяц пока нет.</p>
                ) : (
                  (summary.data?.categories ?? []).map((category) => {
                    const known = category.categoryId
                      ? categoryById.get(category.categoryId)
                      : null;
                    const max = Math.max(
                      ...(summary.data?.categories ?? []).map((item) => Number(item.amountBase)),
                      1,
                    );
                    return (
                      <div key={`${category.categoryId ?? 'none'}-${category.kind}`}>
                        <div className="flex items-center justify-between gap-2 text-sm">
                          <span className="flex items-center gap-2 text-zinc-700">
                            <span
                              className={`h-2.5 w-2.5 rounded-full ${
                                categoryColorClass[known?.color ?? 'default'] ??
                                categoryColorClass.default
                              }`}
                            />
                            {category.name}
                            <Badge tone={category.kind === 'income' ? 'success' : 'neutral'}>
                              {category.kind === 'income' ? 'доход' : 'расход'}
                            </Badge>
                          </span>
                          <span className="font-mono text-zinc-900">
                            {money(category.amountBase, 'BYN')}
                          </span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-100">
                          <div
                            className={`h-full rounded-full ${
                              category.kind === 'income' ? 'bg-emerald-500' : 'bg-red-400'
                            }`}
                            style={{
                              width: `${Math.max(2, (Number(category.amountBase) / max) * 100)}%`,
                            }}
                          />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </Card>
          </div>

          <Card>
            <CardTitle>Последние 12 месяцев</CardTitle>
            <CardDescription>Доходы, расходы и чистый поток в BYN.</CardDescription>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
                    <th className="py-2 pr-3 font-medium">Месяц</th>
                    <th className="py-2 pr-3 text-right font-medium">Доходы</th>
                    <th className="py-2 pr-3 text-right font-medium">Расходы</th>
                    <th className="py-2 text-right font-medium">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {(summary.data?.months ?? []).map((row) => (
                    <tr key={row.month} className="border-b border-zinc-100 last:border-0">
                      <td className="py-2 pr-3 capitalize text-zinc-700">
                        {monthLabel(row.month)}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono text-emerald-700">
                        {money(row.incomeBase, 'BYN')}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono text-red-700">
                        {money(row.expenseBase, 'BYN')}
                      </td>
                      <td
                        className={`py-2 text-right font-mono ${
                          Number(row.netBase) >= 0 ? 'text-emerald-700' : 'text-red-700'
                        }`}
                      >
                        {money(row.netBase, 'BYN')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
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

          {notice ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
              {notice}
            </div>
          ) : null}

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
                <CardTitle>Операций за месяц нет</CardTitle>
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
                              if (row.transaction)
                                setTransactionDialog({ transaction: row.transaction });
                              else if (row.transfer) setTransferDialog({ transfer: row.transfer });
                            }}
                          >
                            Изменить
                          </Button>
                          <Button
                            variant="ghost"
                            className={`h-8 px-2 text-xs ${
                              row.archived ? 'text-zinc-600' : 'text-red-700'
                            }`}
                            onClick={() => {
                              const archived = !row.archived;
                              if (
                                archived &&
                                !window.confirm(
                                  'Отменить операцию? Она исчезнет из статистики, но останется в архиве.',
                                )
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
        <div className="space-y-4">
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreditDialogOpen(true)}>
              Получить кредит
            </Button>
            <Button onClick={() => setAccountDialog({})}>+ Счёт</Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {accountRows.map((account) => (
              <Card key={account.id} className={account.archivedAt ? 'opacity-60' : ''}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle>{account.name}</CardTitle>
                    <CardDescription>
                      {accountKindLabels[account.kind]} · {account.currency}
                    </CardDescription>
                  </div>
                  <Badge tone={account.kind === 'credit' ? 'warning' : 'success'}>
                    {account.kind === 'credit' ? 'обязательство' : 'актив'}
                  </Badge>
                </div>
                <div className="mt-4 font-mono text-2xl font-semibold text-zinc-900">
                  {money(account.balance, account.currency)}
                </div>
                <div className="mt-1 text-xs text-zinc-500">
                  {money(account.balanceBase, 'BYN')} · курс{' '}
                  {Number(account.fxRate).toLocaleString('ru-RU', { maximumFractionDigits: 8 })}
                </div>
                <div className="mt-3 flex gap-2">
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
                    onClick={() => {
                      if (window.confirm(`Архивировать счёт «${account.name}»?`)) {
                        archiveAccount.mutate(account);
                      }
                    }}
                  >
                    {account.archivedAt ? 'Вернуть' : 'В архив'}
                  </Button>
                </div>
              </Card>
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

      {!isLoading && !hasError && tab === 'import' ? (
        <div className="space-y-6">
          <Card>
            <CardTitle>Импорт из Notion</CardTitle>
            <CardDescription>
              Загрузите нормализованный JSON: счета, категории, операции и переводы. Preview
              проверяет дубликаты и ошибки, commit применяет данные, rollback откатывает последний
              импорт.
            </CardDescription>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                aria-label="Файл импорта финансов"
                onChange={(event) => void readImportFile(event.target.files?.[0])}
              />
              <Button variant="secondary" onClick={() => fileRef.current?.click()}>
                Выбрать JSON
              </Button>
              {importPreview ? (
                <Button
                  onClick={() => commitImport.mutate(importPreview.id)}
                  disabled={commitImport.isPending || importPreview.summary.errors.length > 0}
                >
                  {commitImport.isPending ? 'Применяю…' : 'Применить импорт'}
                </Button>
              ) : null}
            </div>
            {importError ? <p className="mt-3 text-sm text-red-700">{importError}</p> : null}
            {importPreview ? (
              <div className="mt-4 space-y-3">
                <div className="grid gap-3 sm:grid-cols-4">
                  <Kpi label="Счета" value={String(importPreview.summary.accounts)} />
                  <Kpi label="Категории" value={String(importPreview.summary.categories)} />
                  <Kpi label="Операции" value={String(importPreview.summary.transactions)} />
                  <Kpi label="Переводы" value={String(importPreview.summary.transfers)} />
                </div>
                {importPreview.summary.duplicates > 0 ? (
                  <p className="text-sm text-amber-700">
                    Дубликатов: {importPreview.summary.duplicates}. Они будут пропущены.
                  </p>
                ) : null}
                {importPreview.summary.warnings.map((warning) => (
                  <p key={warning} className="text-sm text-amber-700">
                    {warning}
                  </p>
                ))}
                {importPreview.summary.errors.length > 0 ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    <div className="font-medium">
                      Ошибки ({importPreview.summary.errors.length})
                    </div>
                    <ul className="mt-1 space-y-1">
                      {importPreview.summary.errors.slice(0, 20).map((error, index) => (
                        <li key={`${error.entityType}-${error.sourceId ?? index}`}>
                          {error.entityType} {error.sourceId ?? ''}: {error.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
          </Card>

          <Card>
            <CardTitle>История импортов</CardTitle>
            <CardDescription>Последние 20 импортов.</CardDescription>
            <div className="mt-4 space-y-2">
              {(imports.data?.imports ?? []).map((row) => (
                <div
                  key={row.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-200 px-3 py-2 text-sm"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge tone={statusTone(row.status)}>
                        {row.status === 'committed'
                          ? 'Применён'
                          : row.status === 'preview'
                            ? 'Проверка'
                            : 'Откачен'}
                      </Badge>
                      <span className="text-zinc-700">{formatDate(row.createdAt)}</span>
                    </div>
                    <div className="mt-1 text-xs text-zinc-500">
                      {row.summary.transactions} операций · {row.summary.transfers} переводов ·{' '}
                      {row.summary.duplicates} дубликатов
                    </div>
                  </div>
                  {row.status === 'committed' ? (
                    <Button
                      variant="ghost"
                      className="h-8 px-3 text-xs text-red-700"
                      onClick={() => {
                        if (window.confirm('Откатить этот импорт?')) {
                          rollbackImport.mutate(row.id);
                        }
                      }}
                      disabled={rollbackImport.isPending}
                    >
                      Откатить
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          </Card>
        </div>
      ) : null}

      {transactionDialog ? (
        <FinanceTransactionDialog
          transaction={transactionDialog.transaction}
          kind={transactionDialog.kind}
          accounts={accountRows}
          categories={categoryRows}
          onClose={() => setTransactionDialog(null)}
          onSaved={invalidate}
        />
      ) : null}
      {transferDialog ? (
        <FinanceTransferDialog
          transfer={transferDialog.transfer}
          accounts={accountRows}
          onClose={() => setTransferDialog(null)}
          onSaved={invalidate}
        />
      ) : null}
      {creditDialogOpen ? (
        <FinanceCreditDialog
          accounts={accountRows}
          onClose={() => setCreditDialogOpen(false)}
          onSaved={invalidate}
        />
      ) : null}
      {accountDialog ? (
        <FinanceAccountDialog
          account={accountDialog.account}
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
