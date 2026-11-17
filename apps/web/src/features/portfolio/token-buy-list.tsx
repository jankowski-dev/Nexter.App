import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { LiveValue } from '@/components/ui/live-value';
import { PriceFreshness } from '@/components/ui/price-freshness';
import { Select } from '@/components/ui/select';
import { TokenIcon } from '@/components/token-icon';
import { fetchWatchlist, fetchWatchlistGroups } from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import { formatPct, formatPrice, formatUsdCompact, pnlTone } from '@/lib/format';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { Asset, WatchlistEntry } from '@nexter/contracts';
import { TokenInfoDialog } from '../watchlist/token-info-dialog';
import { WeeklyPriceChart } from '../watchlist/weekly-price-chart';

type TokenListSort =
  'default' | 'price' | 'change24h' | 'change7d' | 'change30d' | 'change1y' | 'marketCap';

const sortLabels: Record<TokenListSort, string> = {
  default: 'По умолчанию',
  price: 'По цене',
  change24h: 'По 24ч',
  change7d: 'По 7д',
  change30d: 'По 30д',
  change1y: 'По 1г',
  marketCap: 'По капитализации',
};

function sortValue(entry: WatchlistEntry, key: Exclude<TokenListSort, 'default'>): number | null {
  const value =
    key === 'price'
      ? entry.priceUsd
      : key === 'change24h'
        ? entry.change24hPct
        : key === 'change7d'
          ? entry.change7dPct
          : key === 'change30d'
            ? entry.change30dPct
            : key === 'change1y'
              ? entry.change1yPct
              : entry.marketCapUsd;
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function TokenMetric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="text-right">
      <div className="text-[10px] text-zinc-500">{label}</div>
      <div className={`mt-0.5 font-mono text-xs tabular-nums ${tone ?? 'text-zinc-700'}`}>
        {value}
      </div>
    </div>
  );
}

export function TokenBuyList({
  onBuy,
  showHeading = true,
}: {
  onBuy: (asset: Asset, marketPriceUsd: string | null) => void;
  showHeading?: boolean;
}) {
  const groups = useQuery({ queryKey: ['watchlist-groups'], queryFn: fetchWatchlistGroups });
  const [sortKey, setSortKey] = useState<TokenListSort>('default');
  const [sortDirection, setSortDirection] = useState<'desc' | 'asc'>('desc');
  const [selectedEntry, setSelectedEntry] = useState<WatchlistEntry | null>(null);
  const defaultGroup = groups.data?.groups.find((group) => group.isDefault);
  const watchlist = useQuery({
    queryKey: ['buy-list', defaultGroup?.id],
    queryFn: () => fetchWatchlist(false, undefined, defaultGroup?.id, 100),
    enabled: Boolean(defaultGroup?.id),
    refetchInterval: 15_000,
  });

  if (groups.isPending || watchlist.isPending) {
    return <LoadingRows rows={8} />;
  }

  if (groups.isError || watchlist.isError) {
    return (
      <ErrorState
        message={toRussianError(
          groups.error ?? watchlist.error,
          'Не удалось загрузить основной список',
        )}
        onRetry={() => {
          void groups.refetch();
          void watchlist.refetch();
        }}
      />
    );
  }

  const entries = watchlist.data?.data ?? [];
  const sortedEntries =
    sortKey === 'default'
      ? entries
      : [...entries].sort((left, right) => {
          const leftValue = sortValue(left, sortKey);
          const rightValue = sortValue(right, sortKey);
          if (leftValue === null && rightValue === null) return 0;
          if (leftValue === null) return 1;
          if (rightValue === null) return -1;
          return sortDirection === 'desc' ? rightValue - leftValue : leftValue - rightValue;
        });

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {showHeading ? <CardTitle>Основной список</CardTitle> : null}
        <div className="ml-auto flex items-center gap-2">
          <Select
            className="h-9 w-44"
            value={sortKey}
            onChange={(event) => setSortKey(event.target.value as TokenListSort)}
            aria-label="Сортировка основного списка"
          >
            {(Object.keys(sortLabels) as TokenListSort[]).map((key) => (
              <option key={key} value={key}>
                {sortLabels[key]}
              </option>
            ))}
          </Select>
          <Button
            variant="secondary"
            className="h-9 px-2"
            aria-label={sortDirection === 'desc' ? 'По убыванию' : 'По возрастанию'}
            title={sortDirection === 'desc' ? 'По убыванию' : 'По возрастанию'}
            disabled={sortKey === 'default'}
            onClick={() => setSortDirection((value) => (value === 'desc' ? 'asc' : 'desc'))}
          >
            {sortDirection === 'desc' ? '↓' : '↑'}
          </Button>
        </div>
      </div>
      <CardDescription>
        Токены из группы «Основная» для ручной покупки. Нажмите на блок, чтобы открыть карточку
        токена.
      </CardDescription>

      {entries.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-600">
          В группе «Основная» пока нет токенов. Добавьте их в базе токенов.
        </p>
      ) : (
        <div className="mt-4 space-y-2">
          {sortedEntries.map((entry) => {
            const chainAddress =
              entry.asset.chainCode === 'bsc'
                ? entry.bscContractAddress
                : entry.asset.chainCode === 'ethereum'
                  ? entry.ethereumContractAddress
                  : null;
            const tradeAsset: Asset = {
              ...entry.asset,
              contractAddress: entry.asset.contractAddress ?? chainAddress,
            };
            const change24h = entry.change24hPct ? formatPct(entry.change24hPct) : '—';
            const change7d = entry.change7dPct ? formatPct(entry.change7dPct) : '—';
            const change30d = entry.change30dPct ? formatPct(entry.change30dPct) : '—';
            const change1y = entry.change1yPct ? formatPct(entry.change1yPct) : '—';

            return (
              <div
                key={entry.id}
                data-testid={`token-block-${entry.asset.symbol}`}
                role="group"
                tabIndex={0}
                aria-label={`Токен ${entry.asset.symbol}: открыть карточку`}
                onClick={() => setSelectedEntry(entry)}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setSelectedEntry(entry);
                  }
                }}
                className="cursor-pointer rounded-xl border border-zinc-200 p-3.5 text-left transition-colors hover:border-emerald-300 hover:bg-emerald-50/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
              >
                <div className="flex flex-wrap items-center gap-x-5 gap-y-3 xl:flex-nowrap">
                  <div className="flex min-w-[170px] max-w-[235px] items-center gap-2.5">
                    <TokenIcon
                      logoUrl={entry.logoUrl ?? entry.asset.logoUrl}
                      symbol={entry.asset.symbol}
                      className="h-9 w-9 text-[10px]"
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold text-zinc-900">
                          {entry.asset.symbol}
                        </span>
                      </div>
                      <div className="truncate text-[11px] text-zinc-500">
                        {entry.asset.name} · {entry.asset.chainCode}
                      </div>
                      <div className="mt-1 flex items-baseline gap-2">
                        <LiveValue value={formatPrice(entry.priceUsd)}>
                          <span className="font-mono text-lg font-semibold tracking-tight text-zinc-900">
                            {formatPrice(entry.priceUsd)}
                          </span>
                        </LiveValue>
                        <span className={`text-xs font-medium ${pnlTone(entry.change24hPct)}`}>
                          {change24h}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="min-w-[190px] max-w-[280px] flex-1">
                    <WeeklyPriceChart entryId={entry.id} />
                  </div>

                  <div className="ml-auto grid grid-cols-2 gap-x-5 gap-y-2 text-right sm:grid-cols-4">
                    <TokenMetric label="7д" value={change7d} tone={pnlTone(entry.change7dPct)} />
                    <TokenMetric label="30д" value={change30d} tone={pnlTone(entry.change30dPct)} />
                    <TokenMetric label="1г" value={change1y} tone={pnlTone(entry.change1yPct)} />
                    <TokenMetric
                      label="Кап."
                      value={entry.marketCapUsd ? formatUsdCompact(entry.marketCapUsd) : '—'}
                    />
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <Button
                      className="h-8 px-3 text-xs"
                      onClick={(event) => {
                        event.stopPropagation();
                        onBuy(tradeAsset, entry.priceUsd);
                      }}
                    >
                      Купить
                    </Button>
                    <PriceFreshness
                      updatedAt={entry.priceUpdatedAt}
                      fetchedAt={entry.priceFetchedAt}
                      source={entry.priceSource}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <TokenInfoDialog entry={selectedEntry} onClose={() => setSelectedEntry(null)} />
    </Card>
  );
}
