import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { fetchAssets, fetchTradeGroups } from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import { formatDate, formatSignedUsd, formatUsd, pluralizeRu, pnlTone } from '@/lib/format';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useDeferredValue, useEffect, useRef, useState } from 'react';
import type { TradeGroupSummary } from '@nexter/contracts';

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

export function TradesPanel({
  selectedIds,
  onSelectionChange,
  onOpenTrade,
}: {
  selectedIds: string[];
  onSelectionChange: (groups: TradeGroupSummary[]) => void;
  onOpenTrade: (id: string) => void;
}) {
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
    source: source
      ? (source as 'manual' | 'notion' | 'onchain' | 'kyberswap' | 'system')
      : undefined,
    assetId: assetId || undefined,
    from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
    to: to ? new Date(`${to}T23:59:59.999`).toISOString() : undefined,
    pnl: pnl ? (pnl as 'positive' | 'negative') : undefined,
    search: deferredSearch || undefined,
  };
  const assets = useQuery({ queryKey: ['assets'], queryFn: fetchAssets });
  const onSelectionChangeRef = useRef(onSelectionChange);

  useEffect(() => {
    onSelectionChangeRef.current = onSelectionChange;
  }, [onSelectionChange]);

  const groups = useInfiniteQuery({
    queryKey: ['trade-groups', filters],
    queryFn: ({ pageParam }) =>
      fetchTradeGroups({ ...filters, limit: 25, cursor: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.page.hasMore ? last.page.nextCursor : undefined),
  });

  const groupRows = groups.data?.pages.flatMap((page) => page.data) ?? [];
  const selectable = groupRows.filter(
    (group) => group.status !== 'closed' && Number(group.remainingAmount) > 0,
  );
  const selectedSet = new Set(selectedIds);
  const allSelected =
    selectable.length > 0 && selectable.every((group) => selectedSet.has(group.id));

  useEffect(() => {
    onSelectionChangeRef.current([]);
  }, [status, source, assetId, from, to, pnl, deferredSearch]);

  function toggle(id: string): void {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange(groupRows.filter((group) => next.has(group.id)));
  }

  function toggleAll(): void {
    if (allSelected) {
      onSelectionChange([]);
      return;
    }
    onSelectionChange(selectable);
  }

  return (
    <div className="space-y-6">
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
            <option value="kyberswap">KyberSwap</option>
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
          <CardTitle>Сделки</CardTitle>
          <CardDescription>
            {groupRows.length === 0
              ? 'Сделок нет.'
              : `${groupRows.length} ${pluralizeRu(
                  groupRows.length,
                  'группа',
                  'группы',
                  'групп',
                )}${groups.hasNextPage ? ' и ещё есть' : ''}`}
          </CardDescription>
          {groupRows.length > 0 ? (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
                    <th className="w-8 py-2 pr-3">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleAll}
                        aria-label="Выбрать все сделки"
                        disabled={selectable.length === 0}
                        className="h-4 w-4 rounded border-zinc-300"
                      />
                    </th>
                    <th className="py-2 pr-3 font-medium">Актив</th>
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
                  {groupRows.map((group) => {
                    const selectableRow =
                      group.status !== 'closed' && Number(group.remainingAmount) > 0;
                    const pnlValue = group.totalPnlUsd === null ? null : Number(group.totalPnlUsd);
                    const rowTone =
                      pnlValue === null
                        ? ''
                        : pnlValue > 0
                          ? 'bg-emerald-50/40 hover:bg-emerald-50/70'
                          : pnlValue < 0
                            ? 'bg-red-50/40 hover:bg-red-50/70'
                            : 'hover:bg-zinc-50';

                    return (
                      <tr
                        key={group.id}
                        onClick={() => onOpenTrade(group.id)}
                        className={`cursor-pointer border-b border-zinc-100 last:border-0 ${rowTone}`}
                      >
                        <td className="py-2 pr-3" onClick={(event) => event.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedSet.has(group.id)}
                            onChange={() => toggle(group.id)}
                            disabled={!selectableRow}
                            aria-label={`Выбрать ${group.asset.symbol}`}
                            className="h-4 w-4 rounded border-zinc-300"
                          />
                        </td>
                        <td className="py-2 pr-3">
                          <div className="font-medium text-zinc-800">{group.asset.symbol}</div>
                          <div className="text-xs text-zinc-500">{group.asset.chainCode}</div>
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
                        <td className="py-2 text-right text-zinc-600">{group.source}</td>
                      </tr>
                    );
                  })}
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
