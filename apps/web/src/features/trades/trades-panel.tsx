import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { PendingOrdersPanel } from './pending-orders-panel';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { LiveValue } from '@/components/ui/live-value';
import { PriceFreshness } from '@/components/ui/price-freshness';
import { TokenIcon } from '@/components/token-icon';
import { fetchAssets, fetchTradeGroups } from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import {
  formatDate,
  formatPct,
  formatPrice,
  formatSignedUsd,
  formatUsd,
  pluralizeRu,
  pnlTone,
} from '@/lib/format';
import { Decimal } from 'decimal.js';
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

const statusTones: Record<string, 'neutral' | 'success' | 'warning' | 'info'> = {
  open: 'info',
  partial: 'warning',
  closed: 'neutral',
  reserve: 'neutral',
  for_sale: 'warning',
};

function TradeMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-right">
      <div className="text-[10px] text-zinc-500">{label}</div>
      <div className="mt-0.5 font-mono text-xs tabular-nums text-zinc-700">{value}</div>
    </div>
  );
}

export function TradeGroupBlock({
  group,
  logos,
  onOpen,
  showStatus = false,
  showClosedDate = false,
}: {
  group: TradeGroupSummary;
  logos: Map<string, string | null>;
  onOpen: (group: TradeGroupSummary) => void;
  showStatus?: boolean;
  showClosedDate?: boolean;
}) {
  const remaining = new Decimal(group.remainingAmount);
  const averagePrice = remaining.gt(0)
    ? formatPrice(new Decimal(group.remainingCostBasisUsd).div(remaining).toFixed(18))
    : '—';
  const returnDisplay = group.returnPct ? formatPct(group.returnPct) : '—';

  return (
    <button
      type="button"
      onClick={() => onOpen(group)}
      aria-label={`Открыть сделку ${group.asset.symbol}`}
      className="block w-full rounded-xl border border-zinc-200 p-3.5 text-left transition-colors hover:border-emerald-300 hover:bg-emerald-50/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
    >
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 xl:flex-nowrap">
        <div className="flex w-full min-w-[150px] max-w-[220px] items-center gap-2.5 sm:w-[250px] sm:max-w-none sm:shrink-0">
          <TokenIcon
            logoUrl={group.asset.logoUrl ?? logos.get(group.asset.id) ?? null}
            symbol={group.asset.symbol}
            className="h-9 w-9 text-[10px]"
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold text-zinc-900">
                {group.asset.symbol}
              </span>
              {showStatus ? (
                <Badge tone={statusTones[group.status] ?? 'neutral'}>
                  {statusLabels[group.status] ?? group.status}
                </Badge>
              ) : null}
            </div>
            <div className="truncate text-[11px] text-zinc-500">
              {group.asset.name} · {group.asset.chainCode}
            </div>
            {group.stopLossPct || group.takeProfitPct ? (
              <div className="mt-0.5 whitespace-nowrap text-[10px] text-zinc-500">
                SL {group.stopLossPct ? `${group.stopLossPct}%` : '—'} · TP{' '}
                {group.takeProfitPct ? `${group.takeProfitPct}%` : '—'}
              </div>
            ) : null}
          </div>
        </div>

        <div className="min-w-[130px]" title="Реализованный + нереализованный результат по сделке">
          <div className="text-[10px] text-zinc-500">Результат</div>
          <div
            className={`mt-0.5 font-mono text-xl font-semibold tracking-tight ${pnlTone(
              group.totalPnlUsd,
            )}`}
          >
            <LiveValue value={formatSignedUsd(group.totalPnlUsd)}>
              {formatSignedUsd(group.totalPnlUsd)}
            </LiveValue>
          </div>
        </div>

        <div className="min-w-[95px]">
          <div className="text-[10px] text-zinc-500">Доходность</div>
          <div className={`mt-0.5 font-mono text-sm font-semibold ${pnlTone(group.returnPct)}`}>
            <LiveValue value={returnDisplay}>{returnDisplay}</LiveValue>
          </div>
        </div>

        <div className="ml-auto grid grid-cols-2 gap-x-5 gap-y-1.5 text-right sm:grid-cols-4">
          <TradeMetric label="Средний курс" value={averagePrice} />
          <TradeMetric label="Инвестировано" value={formatUsd(group.remainingCostBasisUsd)} />
          <TradeMetric label="Дней" value={String(group.holdingDays)} />
          <TradeMetric label="Открыта" value={formatDate(group.openedAt)} />
        </div>

        <div className="min-w-[100px] text-right">
          <div className="text-[10px] text-zinc-500">Обновление</div>
          <PriceFreshness
            updatedAt={group.priceUpdatedAt}
            fetchedAt={group.priceFetchedAt}
            source={group.priceSource}
            className="justify-end text-zinc-500"
          />
        </div>
      </div>
      {showClosedDate && group.closedAt ? (
        <div className="mt-1 text-right text-[10px] text-zinc-400">
          Закрыта {formatDate(group.closedAt)}
        </div>
      ) : null}
    </button>
  );
}

export function TradesPanel({
  onOpenGroup,
  logos,
  mode = 'journal',
}: {
  onOpenGroup: (group: TradeGroupSummary) => void;
  logos: Map<string, string | null>;
  mode?: 'active' | 'journal';
}) {
  const activeMode = mode === 'active';
  const [view, setView] = useState<TradeGroupView>('active');
  const [assetId, setAssetId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const filters = {
    view: activeMode ? ('active' as const) : view,
    assetId: activeMode ? undefined : assetId || undefined,
    from: activeMode ? undefined : from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
    to: activeMode ? undefined : to ? new Date(`${to}T23:59:59.999`).toISOString() : undefined,
    search: activeMode ? undefined : deferredSearch || undefined,
  };
  const assets = useQuery({ queryKey: ['assets'], queryFn: fetchAssets, enabled: !activeMode });

  const groups = useInfiniteQuery({
    queryKey: ['trade-groups', mode, filters],
    queryFn: ({ pageParam }) =>
      fetchTradeGroups({
        ...filters,
        limit: activeMode ? 50 : 25,
        cursor: pageParam ?? undefined,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.page.hasMore ? last.page.nextCursor : undefined),
    refetchInterval: 15_000,
  });

  const groupRows = groups.data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <div className="space-y-4">
      <PendingOrdersPanel />

      {!activeMode ? (
        <>
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
        </>
      ) : null}

      {groups.isPending ? <LoadingRows rows={5} /> : null}
      {groups.isError ? (
        <ErrorState
          message={toRussianError(groups.error, 'Не удалось загрузить сделки')}
          onRetry={() => void groups.refetch()}
        />
      ) : null}

      {!groups.isPending && !groups.isError ? (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>{activeMode ? 'Активные сделки' : `${viewLabels[view]} сделки`}</CardTitle>
            {activeMode ? (
              <span className="text-xs text-zinc-500">
                {groupRows.length} {pluralizeRu(groupRows.length, 'сделка', 'сделки', 'сделок')}
              </span>
            ) : null}
          </div>
          <CardDescription>
            {groupRows.length === 0
              ? 'Сделок нет.'
              : activeMode
                ? 'Открытые сделки в портфеле. Нажмите на блок, чтобы открыть карточку актива.'
                : `${groupRows.length} ${pluralizeRu(
                    groupRows.length,
                    'сделка',
                    'сделки',
                    'сделок',
                  )}. Нажмите на блок, чтобы открыть сделку.${
                    groups.hasNextPage ? ' Ниже можно загрузить ещё.' : ''
                  }`}
          </CardDescription>
          {groupRows.length > 0 ? (
            <div className="mt-4 space-y-2">
              {groupRows.map((group) => (
                <TradeGroupBlock
                  key={group.id}
                  group={group}
                  logos={logos}
                  onOpen={onOpenGroup}
                  showStatus={!activeMode && group.status !== 'closed'}
                  showClosedDate={!activeMode}
                />
              ))}
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
