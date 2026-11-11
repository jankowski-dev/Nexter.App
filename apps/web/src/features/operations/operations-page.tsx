import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { fetchAccounts, fetchAssets, fetchTransactions } from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import { formatDateTime, formatTokenAmount, formatUsd } from '@/lib/format';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { ExchangeDrawer } from '../trade/exchange-drawer';
import { ManualOperationDialog } from './manual-operation-dialog';

type OperationFilter = 'all' | 'deposit' | 'withdrawal' | 'swap';

const filterLabels: Record<OperationFilter, string> = {
  all: 'Все',
  deposit: 'Пополнения',
  withdrawal: 'Выводы',
  swap: 'Обмены',
};

const typeLabels: Record<string, string> = {
  trade: 'Сделка',
  transfer: 'Перевод',
  deposit: 'Пополнение',
  withdrawal: 'Вывод',
  fee: 'Сбор',
  income: 'Доход',
  adjustment: 'Корректировка',
};

const subtypeLabels: Record<string, string> = {
  buy: 'Покупка',
  sell: 'Продажа',
  swap: 'Обмен',
  transfer: 'Перевод',
  deposit: 'Пополнение',
  withdrawal: 'Вывод',
  fee: 'Сбор',
  income: 'Доход',
  adjustment: 'Корректировка',
};

export function OperationsPage() {
  const [filter, setFilter] = useState<OperationFilter>('all');
  const [manualOpen, setManualOpen] = useState(false);
  const [onchainOpen, setOnchainOpen] = useState(false);
  const assets = useQuery({ queryKey: ['assets'], queryFn: fetchAssets });
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: fetchAccounts });

  const transactions = useInfiniteQuery({
    queryKey: ['operations', filter],
    queryFn: ({ pageParam }) =>
      fetchTransactions({
        limit: 50,
        cursor: pageParam ?? undefined,
        ...(filter === 'deposit' ? { type: 'deposit' as const } : {}),
        ...(filter === 'withdrawal' ? { type: 'withdrawal' as const } : {}),
        ...(filter === 'swap' ? { subtype: 'swap' as const } : {}),
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.page.hasMore ? last.page.nextCursor : undefined),
  });

  const rows = transactions.data?.pages.flatMap((page) => page.transactions) ?? [];
  const refreshOperations = useCallback(() => {
    void transactions.refetch();
  }, [transactions.refetch]);
  const assetById = new Map((assets.data?.assets ?? []).map((asset) => [asset.id, asset]));
  const accountById = new Map(
    (accounts.data?.accounts ?? []).map((account) => [account.id, account]),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Операции"
        subtitle="Пополнения, выводы и обмены. Сделки ведутся в Портфеле."
        actions={
          <>
            <Button variant="secondary" onClick={() => setOnchainOpen(true)}>
              Обмен on-chain
            </Button>
            <Button onClick={() => setManualOpen(true)}>Новая операция</Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1 rounded-lg border border-zinc-200 bg-zinc-50 p-1">
          {(Object.keys(filterLabels) as OperationFilter[]).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setFilter(item)}
              className={`rounded-md px-4 py-2 text-sm ${
                filter === item
                  ? 'bg-white text-zinc-900 shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-900'
              }`}
              aria-selected={filter === item}
              role="tab"
            >
              {filterLabels[item]}
            </button>
          ))}
        </div>
        <div className="text-xs text-zinc-500">
          {rows.length > 0 ? `Загружено ${rows.length}` : 'Операций пока нет'}
        </div>
      </div>

      {transactions.isPending ? <LoadingRows rows={8} /> : null}
      {transactions.isError ? (
        <ErrorState
          message={toRussianError(transactions.error, 'Не удалось загрузить операции')}
          onRetry={() => void transactions.refetch()}
        />
      ) : null}

      {!transactions.isPending && !transactions.isError ? (
        <Card>
          <CardTitle>Журнал операций</CardTitle>
          <CardDescription>
            Все движения по кошелькам. Сделки открываются из Портфеля.
          </CardDescription>
          {rows.length === 0 ? (
            <p className="mt-4 text-sm text-zinc-600">Операций нет.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
                    <th className="py-2 pr-3 font-medium">Дата</th>
                    <th className="py-2 pr-3 font-medium">Тип</th>
                    <th className="py-2 pr-3 font-medium">Движение</th>
                    <th className="py-2 pr-3 font-medium">Источник</th>
                    <th className="py-2 pr-3 font-medium">Заметки</th>
                    <th className="py-2 text-right font-medium">Сборы</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((transaction) => {
                    const walletPostings = transaction.postings.filter(
                      (posting) =>
                        posting.amount !== '0' &&
                        accountById.get(posting.accountId)?.type === 'wallet',
                    );
                    const postings = (
                      walletPostings.length > 0
                        ? walletPostings
                        : transaction.postings.filter((posting) => posting.amount !== '0')
                    )
                      .slice(0, 3)
                      .map((posting) => {
                        const asset = assetById.get(posting.assetId);
                        const symbol = asset?.symbol ?? 'актив';
                        return `${formatTokenAmount(posting.amount)} ${symbol}`;
                      });

                    const primaryLabel =
                      transaction.subtype === 'swap'
                        ? 'Обмен'
                        : (typeLabels[transaction.type] ?? transaction.type);
                    const secondaryLabel =
                      subtypeLabels[transaction.subtype] ?? transaction.subtype;
                    const showSecondary = primaryLabel !== secondaryLabel;

                    return (
                      <tr
                        key={transaction.id}
                        className="border-b border-zinc-100 last:border-0 odd:bg-zinc-50/60 hover:bg-zinc-100/70"
                      >
                        <td className="py-2 pr-3 text-zinc-600">
                          {formatDateTime(transaction.occurredAt)}
                        </td>
                        <td className="py-2 pr-3">
                          <div className="text-zinc-800">{primaryLabel}</div>
                          {showSecondary ? (
                            <div className="text-xs text-zinc-500">{secondaryLabel}</div>
                          ) : null}
                        </td>
                        <td className="py-2 pr-3 font-mono text-xs tabular-nums text-zinc-700">
                          {postings.length > 0 ? postings.join(' · ') : '—'}
                        </td>
                        <td className="py-2 pr-3">
                          <Badge tone={transaction.source === 'notion' ? 'info' : 'neutral'}>
                            {transaction.source}
                          </Badge>
                        </td>
                        <td className="max-w-64 truncate py-2 pr-3 text-zinc-500">
                          {transaction.notes ?? '—'}
                        </td>
                        <td className="py-2 text-right font-mono tabular-nums text-zinc-600">
                          {Number(transaction.feesUsd) === 0 ? '—' : formatUsd(transaction.feesUsd)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {transactions.hasNextPage ? (
            <div className="mt-4 flex justify-center">
              <Button
                variant="secondary"
                onClick={() => void transactions.fetchNextPage()}
                disabled={transactions.isFetchingNextPage}
              >
                {transactions.isFetchingNextPage ? 'Загружаю…' : 'Загрузить ещё'}
              </Button>
            </div>
          ) : null}
        </Card>
      ) : null}

      <ManualOperationDialog
        open={manualOpen}
        initialMode="exchange"
        onClose={() => setManualOpen(false)}
        onSaved={refreshOperations}
      />

      {onchainOpen ? (
        <ExchangeDrawer
          onClose={() => {
            setOnchainOpen(false);
            refreshOperations();
          }}
          onManual={() => {
            setOnchainOpen(false);
            setManualOpen(true);
          }}
          onCompleted={refreshOperations}
        />
      ) : null}
    </div>
  );
}
