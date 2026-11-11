import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { TokenIcon } from '@/components/token-icon';
import { fetchAssets, fetchTradeGroups } from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import { formatDate, formatSignedUsd, formatUsd, pluralizeRu, pnlTone } from '@/lib/format';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useDeferredValue, useState } from 'react';
import type { TradeGroupSummary, TradeGroupView } from '@nexter/contracts';

const viewLabels: Record<TradeGroupView, string> = {
  active: 'Активные',
  profitable: 'Прибыльные',
  losing: 'Убыточные',
  closed: 'Закрытые',
};

const statusLabels: Record<string, string> = {
  open: 'Открыта',
  partial: 'Частично',
  closed: 'Закрыта',
  reserve: 'Резерв',
  for_sale: 'В продажу',
};

const sourceLabels: Record<string, string> = {
  manual: 'Ручная',
  notion: 'Notion',
  onchain: 'В сети',
  kyberswap: 'KyberSwap',
  system: 'Система',
};

const statusTones: Record<string, 'neutral' | 'success' | 'warning' | 'info'> = {
  open: 'info',
  partial: 'warning',
  closed: 'neutral',
  reserve: 'neutral',
  for_sale: 'warning',
};

export function TradesPanel({
  onOpenTrade,
  logos,
}: {
  onOpenTrade: (group: TradeGroupSummary) => void;
  logos: Map<string, string | null>;
}) {
  const [view, setView] = useState<TradeGroupView>('active');
  const [assetId, setAssetId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const filters = {
    view,
    assetId: assetId || undefined,
    from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
    to: to ? new Date(`${to}T23:59:59.999`).toISOString() : undefined,
    search: deferredSearch || undefined,
  };
  const assets = useQuery({ queryKey: ['assets'], queryFn: fetchAssets });

  const groups = useInfiniteQuery({
    queryKey: ['trade-groups', filters],
    queryFn: ({ pageParam }) =>
      fetchTradeGroups({ ...filters, limit: 25, cursor: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.page.hasMore ? last.page.nextCursor : undefined),
    refetchInterval: 15_000,
  });

  const groupRows = groups.data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 rounded-xl border border-zinc-200 bg-zinc-50 p-1">
        {(Object.keys(viewLabels) as TradeGroupView[]).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setView(value)}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              view === value
                ? 'bg-white font-medium text-zinc-900 shadow-sm'
                : 'text-zinc-500 hover:text-zinc-900'
            }`}
            role="tab"
            aria-selected={view === value}
          >
            {viewLabels[value]}
          </button>
        ))}
      </div>

      <Card>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
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
          <CardTitle>{viewLabels[view]} сделки</CardTitle>
          <CardDescription>
            {groupRows.length === 0
              ? 'Сделок нет.'
              : `${groupRows.length} ${pluralizeRu(
                  groupRows.length,
                  'группа',
                  'группы',
                  'групп',
                )}${groups.hasNextPage ? ' и ещё есть' : ''}. Нажмите на строку, чтобы открыть продажу.`}
          </CardDescription>
          {groupRows.length > 0 ? (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
                    <th className="py-2 pr-3 font-medium">Актив</th>
                    <th className="py-2 pr-3 font-medium">Статус</th>
                    <th className="py-2 pr-3 font-medium">Открыта</th>
                    <th className="py-2 pr-3 font-medium">Закрыта</th>
                    <th className="py-2 pr-3 text-right font-medium">Дней</th>
                    <th className="py-2 pr-3 text-right font-medium">Покупка</th>
                    <th className="py-2 pr-3 text-right font-medium">Продажа</th>
                    <th className="py-2 pr-3 text-right font-medium">Результат</th>
                    <th className="py-2 pr-3 text-right font-medium">Доходность</th>
                    <th className="py-2 pr-3 font-medium">Качество</th>
                    <th className="py-2 text-right font-medium">Источник</th>
                  </tr>
                </thead>
                <tbody>
                  {groupRows.map((group) => (
                    <tr
                      key={group.id}
                      onClick={() => onOpenTrade(group)}
                      className={`cursor-pointer border-b border-zinc-100 last:border-0 ${
                        group.totalPnlUsd === null
                          ? ''
                          : Number(group.totalPnlUsd) > 0
                            ? 'bg-emerald-50/40 hover:bg-emerald-50/70'
                            : Number(group.totalPnlUsd) < 0
                              ? 'bg-red-50/40 hover:bg-red-50/70'
                              : 'hover:bg-zinc-50'
                      }`}
                    >
                      <td className="py-2 pr-3">
                        <div className="flex items-center gap-2">
                          <TokenIcon
                            logoUrl={group.asset.logoUrl ?? logos.get(group.asset.id) ?? null}
                            symbol={group.asset.symbol}
                          />
                          <div className="min-w-0">
                            <div className="font-medium text-zinc-800">{group.asset.symbol}</div>
                            <div className="text-xs text-zinc-500">{group.asset.chainCode}</div>
                          </div>
                        </div>
                      </td>
                      <td className="py-2 pr-3">
                        <Badge tone={statusTones[group.status] ?? 'neutral'}>
                          {statusLabels[group.status] ?? group.status}
                        </Badge>
                      </td>
                      <td className="py-2 pr-3 text-zinc-600">{formatDate(group.openedAt)}</td>
                      <td className="py-2 pr-3 text-zinc-600">
                        {group.closedAt ? formatDate(group.closedAt) : '—'}
                      </td>
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
                        className={`py-2 pr-3 text-right font-mono tabular-nums ${pnlTone(
                          group.totalPnlUsd,
                        )}`}
                      >
                        {formatSignedUsd(group.totalPnlUsd)}
                      </td>
                      <td
                        className={`py-2 pr-3 text-right font-mono tabular-nums ${pnlTone(
                          group.returnPct,
                        )}`}
                      >
                        {group.returnPct ? `${group.returnPct}%` : '—'}
                      </td>
                      <td className="py-2 pr-3">
                        <Badge tone={group.quality.reconciled ? 'success' : 'warning'}>
                          {group.quality.reconciled ? 'сверено' : 'не сверено'}
                        </Badge>
                      </td>
                      <td className="py-2 text-right text-zinc-600">
                        {sourceLabels[group.source] ?? group.source}
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
    </div>
  );
}
