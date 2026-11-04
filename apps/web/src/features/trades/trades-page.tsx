import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { fetchAssets, fetchTradeGroups, fetchTransactions } from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import { formatDate, formatSignedUsd, formatUsd, pnlTone } from '@/lib/format';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useDeferredValue, useState } from 'react';

const statusLabels: Record<string, string> = {
  open: 'Открыта',
  partial: 'Частично',
  closed: 'Закрыта',
  reserve: 'Резерв',
  for_sale: 'В продажу',
};

const statusTones: Record<string, 'neutral' | 'success' | 'warning' | 'info'> = {
  open: 'info',
  partial: 'warning',
  closed: 'neutral',
  reserve: 'neutral',
  for_sale: 'warning',
};

export function TradesPage() {
  const [tab, setTab] = useState<'groups' | 'activity'>('groups');
  const [status, setStatus] = useState('');
  const [source, setSource] = useState('');
  const [assetId, setAssetId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [pnl, setPnl] = useState('');
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const filters = {
    status: status ? (status as 'open' | 'partial' | 'closed' | 'reserve' | 'for_sale') : undefined,
    source: source ? (source as 'manual' | 'notion' | 'onchain' | 'system') : undefined,
    assetId: assetId || undefined,
    from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
    to: to ? new Date(`${to}T23:59:59.999`).toISOString() : undefined,
    pnl: pnl ? (pnl as 'positive' | 'negative') : undefined,
    search: deferredSearch || undefined,
  };
  const assets = useQuery({ queryKey: ['assets'], queryFn: fetchAssets });

  const groups = useInfiniteQuery({
    queryKey: ['trade-groups', filters],
    queryFn: ({ pageParam }) =>
      fetchTradeGroups({ ...filters, limit: 25, cursor: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.page.hasMore ? last.page.nextCursor : undefined),
    enabled: tab === 'groups',
  });

  const activity = useInfiniteQuery({
    queryKey: ['transactions', source],
    queryFn: ({ pageParam }) =>
      fetchTransactions({
        limit: 50,
        cursor: pageParam ?? undefined,
        source: filters.source,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.page.hasMore ? last.page.nextCursor : undefined),
    enabled: tab === 'activity',
  });

  const groupRows = groups.data?.pages.flatMap((page) => page.data) ?? [];
  const activityRows = activity.data?.pages.flatMap((page) => page.transactions) ?? [];

  return (
    <div className="space-y-6">
      <PageHeader title="Сделки" subtitle="Торговые группы, активность и P&L." />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-lg border border-zinc-200 bg-zinc-50 p-1">
          <button
            type="button"
            onClick={() => setTab('groups')}
            className={`rounded-md px-4 py-2 text-sm ${tab === 'groups' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-900'}`}
            aria-selected={tab === 'groups'}
            role="tab"
          >
            Позиции
          </button>
          <button
            type="button"
            onClick={() => setTab('activity')}
            className={`rounded-md px-4 py-2 text-sm ${tab === 'activity' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-900'}`}
            aria-selected={tab === 'activity'}
            role="tab"
          >
            Активность
          </button>
        </div>
      </div>

      {tab === 'groups' ? (
        <>
          <Card>
            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
              <Input
                placeholder="Поиск по активу"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                aria-label="Поиск по активу"
              />
              <Select
                value={assetId}
                onChange={(event) => setAssetId(event.target.value)}
                aria-label="Актив"
              >
                <option value="">Все активы</option>
                {assets.data?.assets.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.symbol} · {asset.chainCode}
                  </option>
                ))}
              </Select>
              <Select
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                aria-label="Статус"
              >
                <option value="">Все статусы</option>
                <option value="open">Открыта</option>
                <option value="partial">Частично</option>
                <option value="closed">Закрыта</option>
                <option value="reserve">Резерв</option>
                <option value="for_sale">В продажу</option>
              </Select>
              <Select
                value={source}
                onChange={(event) => setSource(event.target.value)}
                aria-label="Источник"
              >
                <option value="">Все источники</option>
                <option value="manual">Ручные</option>
                <option value="notion">Notion</option>
              </Select>
              <Select value={pnl} onChange={(event) => setPnl(event.target.value)} aria-label="P&L">
                <option value="">Любой P&L</option>
                <option value="positive">Положительный</option>
                <option value="negative">Отрицательный</option>
              </Select>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="date"
                  value={from}
                  onChange={(event) => setFrom(event.target.value)}
                  aria-label="С даты"
                />
                <Input
                  type="date"
                  value={to}
                  onChange={(event) => setTo(event.target.value)}
                  aria-label="По дату"
                />
              </div>
            </div>
          </Card>

          {groups.isPending ? <LoadingRows rows={8} /> : null}
          {groups.isError ? (
            <ErrorState
              message={toRussianError(groups.error, 'Не удалось загрузить сделки')}
              onRetry={() => void groups.refetch()}
            />
          ) : null}

          {!groups.isPending && !groups.isError ? (
            <Card>
              <CardTitle>Торговые группы</CardTitle>
              <CardDescription>
                {groupRows.length === 0
                  ? 'Сделок нет.'
                  : `${groupRows.length} групп${groups.hasNextPage ? ' и ещё есть' : ''}`}
              </CardDescription>
              {groupRows.length > 0 ? (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
                        <th className="py-2 pr-3 font-medium">Актив</th>
                        <th className="py-2 pr-3 font-medium">ID</th>
                        <th className="py-2 pr-3 font-medium">Статус</th>
                        <th className="py-2 pr-3 font-medium">Открыта</th>
                        <th className="py-2 pr-3 font-medium">Закрыта</th>
                        <th className="py-2 pr-3 text-right font-medium">Дней</th>
                        <th className="py-2 pr-3 text-right font-medium">Покупка</th>
                        <th className="py-2 pr-3 text-right font-medium">Продажа</th>
                        <th className="py-2 pr-3 text-right font-medium">P&L</th>
                        <th className="py-2 pr-3 text-right font-medium">Return</th>
                        <th className="py-2 pr-3 font-medium">Качество</th>
                        <th className="py-2 text-right font-medium">Источник</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groupRows.map((group) => (
                        <tr
                          key={group.id}
                          className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50"
                        >
                          <td className="py-2 pr-3">
                            <Link
                              to="/trades/$tradeId"
                              params={{ tradeId: group.id }}
                              className="font-medium text-zinc-800 hover:text-emerald-800"
                            >
                              {group.asset.symbol}
                            </Link>
                            <div className="text-xs text-zinc-500">{group.asset.chainCode}</div>
                          </td>
                          <td className="py-2 pr-3 font-mono text-xs text-zinc-500">
                            {group.id.slice(0, 8)}
                          </td>
                          <td className="py-2 pr-3">
                            <Badge tone={statusTones[group.status] ?? 'neutral'}>
                              {statusLabels[group.status] ?? group.status}
                            </Badge>
                          </td>
                          <td className="py-2 pr-3 text-zinc-600">{formatDate(group.openedAt)}</td>
                          <td className="py-2 pr-3 text-zinc-600">{formatDate(group.closedAt)}</td>
                          <td className="py-2 pr-3 text-right font-mono tabular-nums text-zinc-600">
                            {group.holdingDays}
                          </td>
                          <td className="py-2 pr-3 text-right font-mono tabular-nums text-zinc-700">
                            {formatUsd(group.buyUsd)}
                          </td>
                          <td className="py-2 pr-3 text-right font-mono tabular-nums text-zinc-700">
                            {formatUsd(group.sellUsd)}
                          </td>
                          <td
                            className={`py-2 pr-3 text-right font-mono tabular-nums ${pnlTone(group.totalPnlUsd)}`}
                          >
                            {formatSignedUsd(group.totalPnlUsd)}
                          </td>
                          <td
                            className={`py-2 pr-3 text-right font-mono tabular-nums ${pnlTone(group.returnPct)}`}
                          >
                            {group.returnPct ? `${group.returnPct}%` : '—'}
                          </td>
                          <td className="py-2 pr-3">
                            {group.quality.assetVerified &&
                            group.quality.chainKnown &&
                            group.quality.contractKnown ? (
                              <Badge tone="success">OK</Badge>
                            ) : (
                              <Badge tone="warning">
                                {!group.quality.assetVerified
                                  ? 'unverified'
                                  : !group.quality.chainKnown
                                    ? 'no chain'
                                    : 'no contract'}
                              </Badge>
                            )}
                          </td>
                          <td className="py-2 text-right">
                            <Badge tone={group.source === 'notion' ? 'info' : 'neutral'}>
                              {group.source}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              {groups.hasNextPage ? (
                <div className="mt-4 flex justify-center">
                  <Button
                    variant="secondary"
                    onClick={() => void groups.fetchNextPage()}
                    disabled={groups.isFetchingNextPage}
                  >
                    {groups.isFetchingNextPage ? 'Загружаю…' : 'Загрузить ещё'}
                  </Button>
                </div>
              ) : null}
            </Card>
          ) : null}
        </>
      ) : (
        <>
          <Card>
            <Select
              value={source}
              onChange={(event) => setSource(event.target.value)}
              aria-label="Источник"
            >
              <option value="">Все источники</option>
              <option value="manual">Ручные</option>
              <option value="notion">Notion</option>
            </Select>
          </Card>

          {activity.isPending ? <LoadingRows rows={8} /> : null}
          {activity.isError ? (
            <ErrorState
              message={toRussianError(activity.error, 'Не удалось загрузить активность')}
              onRetry={() => void activity.refetch()}
            />
          ) : null}

          {!activity.isPending && !activity.isError ? (
            <Card>
              <CardTitle>Активность</CardTitle>
              <CardDescription>
                {activityRows.length === 0 ? 'Операций нет.' : `${activityRows.length} операций`}
              </CardDescription>
              {activityRows.length > 0 ? (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
                        <th className="py-2 pr-3 font-medium">Дата</th>
                        <th className="py-2 pr-3 font-medium">Тип</th>
                        <th className="py-2 pr-3 font-medium">Источник</th>
                        <th className="py-2 pr-3 font-medium">Заметки</th>
                        <th className="py-2 text-right font-medium">Сделка</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activityRows.map((transaction) => (
                        <tr
                          key={transaction.id}
                          className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50"
                        >
                          <td className="py-2 pr-3 text-zinc-600">
                            {formatDate(transaction.occurredAt)}
                          </td>
                          <td className="py-2 pr-3 text-zinc-700">
                            {transaction.type} / {transaction.subtype}
                          </td>
                          <td className="py-2 pr-3">
                            <Badge tone={transaction.source === 'notion' ? 'info' : 'neutral'}>
                              {transaction.source}
                            </Badge>
                          </td>
                          <td className="max-w-64 truncate py-2 pr-3 text-zinc-500">
                            {transaction.notes ?? '—'}
                          </td>
                          <td className="py-2 text-right">
                            {transaction.tradeGroupId ? (
                              <Link
                                to="/trades/$tradeId"
                                params={{ tradeId: transaction.tradeGroupId }}
                                className="text-emerald-700 hover:text-emerald-800"
                              >
                                Открыть →
                              </Link>
                            ) : (
                              '—'
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              {activity.hasNextPage ? (
                <div className="mt-4 flex justify-center">
                  <Button
                    variant="secondary"
                    onClick={() => void activity.fetchNextPage()}
                    disabled={activity.isFetchingNextPage}
                  >
                    {activity.isFetchingNextPage ? 'Загружаю…' : 'Загрузить ещё'}
                  </Button>
                </div>
              ) : null}
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
