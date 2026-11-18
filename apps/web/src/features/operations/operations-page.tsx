import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { ListToolbar, TabGroup } from '@/components/ui/list-toolbar';
import { PageHeader } from '@/components/ui/page-header';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { TokenIcon } from '@/components/token-icon';
import { fetchAccounts, fetchAssets, fetchTransactions } from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import { formatDateTime, formatTokenAmount, formatUsd } from '@/lib/format';
import { filterBySearch } from '@/lib/search';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
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

const typeAccentColors: Record<string, string> = {
  deposit: '#34d399',
  income: '#34d399',
  withdrawal: '#f87171',
  fee: '#fca5a5',
  swap: '#38bdf8',
  transfer: '#7dd3fc',
  adjustment: '#fbbf24',
  trade: '#d4d4d8',
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

export function OperationsPage({ embedded = false }: { embedded?: boolean }) {
  const [filter, setFilter] = useState<OperationFilter>('all');
  const [search, setSearch] = useState('');
  const [manualOpen, setManualOpen] = useState(false);
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
    refetchInterval: 30_000,
  });

  const rows = transactions.data?.pages.flatMap((page) => page.transactions) ?? [];
  const assetById = new Map((assets.data?.assets ?? []).map((asset) => [asset.id, asset]));
  const accountById = new Map(
    (accounts.data?.accounts ?? []).map((account) => [account.id, account]),
  );
  const visibleRows = filterBySearch(rows, search, (transaction) => {
    const tokens = transaction.postings.flatMap((posting) => {
      const asset = assetById.get(posting.assetId);
      return asset ? [asset.symbol, asset.name] : [];
    });
    const accountsForPostings = transaction.postings.flatMap((posting) => {
      const account = accountById.get(posting.accountId);
      return account ? [account.name] : [];
    });
    return [
      typeLabels[transaction.type] ?? transaction.type,
      subtypeLabels[transaction.subtype] ?? transaction.subtype,
      transaction.notes,
      ...tokens,
      ...accountsForPostings,
    ];
  });
  const refreshOperations = useCallback(() => {
    void transactions.refetch();
  }, [transactions.refetch]);

  return (
    <div className="space-y-6">
      {embedded ? null : (
        <PageHeader
          title="Операции"
          subtitle="Обмен, пополнение, вывод и корректировка. Только ручной ввод."
          actions={<Button onClick={() => setManualOpen(true)}>Новая операция</Button>}
        />
      )}

      <ListToolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Поиск по операциям"
        searchAriaLabel="Поиск по операциям"
        actions={
          embedded ? <Button onClick={() => setManualOpen(true)}>Новая операция</Button> : undefined
        }
      >
        <TabGroup
          value={filter}
          onChange={setFilter}
          ariaLabel="Тип операций"
          options={(Object.keys(filterLabels) as OperationFilter[]).map((item) => ({
            value: item,
            label: filterLabels[item],
          }))}
        />
      </ListToolbar>

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
            Все движения по кошелькам. Сделки открываются из вкладки «Ордера».
          </CardDescription>
          {visibleRows.length === 0 ? (
            <p className="mt-4 text-sm text-zinc-600">
              {rows.length === 0 ? 'Операций нет.' : 'Ничего не найдено.'}
            </p>
          ) : (
            <div className="mt-4 space-y-2">
              {visibleRows.map((transaction) => {
                const walletPostings = transaction.postings.filter(
                  (posting) =>
                    posting.amount !== '0' && accountById.get(posting.accountId)?.type === 'wallet',
                );
                const displayPostings =
                  walletPostings.length > 0
                    ? walletPostings
                    : transaction.postings.filter((posting) => posting.amount !== '0');
                const postings = displayPostings.slice(0, 3).map((posting) => {
                  const asset = assetById.get(posting.assetId);
                  const symbol = asset?.symbol ?? 'актив';
                  return `${formatTokenAmount(posting.amount)} ${symbol}`;
                });
                const primaryPosting = displayPostings[0];
                const primaryAsset = primaryPosting ? assetById.get(primaryPosting.assetId) : null;

                const primaryLabel =
                  transaction.subtype === 'swap'
                    ? 'Обмен'
                    : (typeLabels[transaction.type] ?? transaction.type);
                const secondaryLabel = subtypeLabels[transaction.subtype] ?? transaction.subtype;
                const showSecondary = primaryLabel !== secondaryLabel;
                const fees = Number(transaction.feesUsd);

                return (
                  <div
                    key={transaction.id}
                    className="rounded-xl border border-l-4 border-zinc-200 px-3 py-2 transition-colors hover:border-emerald-300"
                    style={{
                      borderLeftColor: typeAccentColors[transaction.type] ?? '#d4d4d8',
                    }}
                  >
                    <div className="flex flex-wrap items-center gap-3">
                      <TokenIcon
                        logoUrl={primaryAsset?.logoUrl ?? null}
                        symbol={primaryAsset?.symbol ?? '—'}
                        className="h-8 w-8 text-[9px]"
                      />
                      <div className="flex min-w-[150px] flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-sm font-semibold text-zinc-900">{primaryLabel}</span>
                        {showSecondary ? (
                          <span className="text-[11px] text-zinc-500">{secondaryLabel}</span>
                        ) : null}
                        {transaction.source === 'notion' ? <Badge tone="info">Notion</Badge> : null}
                        <span className="text-[11px] text-zinc-500">
                          {formatDateTime(transaction.occurredAt)}
                        </span>
                        {transaction.notes ? (
                          <span className="max-w-[360px] truncate text-[11px] text-zinc-500">
                            · {transaction.notes}
                          </span>
                        ) : null}
                      </div>
                      <div className="ml-auto text-right">
                        <div className="font-mono text-[13px] font-medium tabular-nums text-zinc-800">
                          {postings.length > 0 ? postings.join(' · ') : '—'}
                        </div>
                        {fees > 0 ? (
                          <div className="mt-0.5 text-[10px] text-zinc-500">
                            Сборы {formatUsd(transaction.feesUsd)}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
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
    </div>
  );
}
