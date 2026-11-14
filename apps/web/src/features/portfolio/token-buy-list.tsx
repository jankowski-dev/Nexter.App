import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { LiveValue } from '@/components/ui/live-value';
import { PriceFreshness } from '@/components/ui/price-freshness';
import { PeriodChange } from '@/components/period-change';
import { Select } from '@/components/ui/select';
import { TokenIcon } from '@/components/token-icon';
import { fetchSwapConfig, fetchWatchlist, fetchWatchlistGroups } from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import { formatPct, formatPrice, formatUsdCompact, pnlTone } from '@/lib/format';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { Asset, SwapConfigResponse, WatchlistEntry } from '@nexter/contracts';
import { TokenInfoDialog } from '../watchlist/token-info-dialog';

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

function isOnchainAllowed(asset: Asset, config: SwapConfigResponse | undefined): boolean {
  const chain = config?.chains.find((item) => item.code === asset.chainCode);
  if (!chain) return false;
  if (asset.contractAddress) {
    return chain.tokens.some(
      (token) =>
        !token.native && token.address.toLowerCase() === asset.contractAddress?.toLowerCase(),
    );
  }
  return chain.tokens.some((token) => token.native && token.symbol === asset.symbol);
}

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

export function TokenBuyList({
  onBuy,
  onManual,
  showHeading = true,
}: {
  onBuy: (asset: Asset, marketPriceUsd: string | null) => void;
  onManual?: (asset: Asset, marketPriceUsd: string | null) => void;
  showHeading?: boolean;
}) {
  const groups = useQuery({ queryKey: ['watchlist-groups'], queryFn: fetchWatchlistGroups });
  const config = useQuery({ queryKey: ['swap-config'], queryFn: fetchSwapConfig });
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
      {config.isError ? (
        <p className="mt-2 text-xs text-amber-700">
          Не удалось проверить разрешённый список токенов. Доступна только ручная запись.
        </p>
      ) : null}

      {entries.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-600">
          В группе «Основная» пока нет токенов. Добавьте их в базе токенов.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[920px] text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
                <th className="py-2 pr-3 font-medium">Токен</th>
                <th className="py-2 pr-3 font-medium">Действие</th>
                <th className="py-2 pr-3 text-right font-medium">Цена</th>
                <th className="py-2 pr-3 font-medium">Обновлено</th>
                <th className="py-2 pr-3 text-right font-medium">24ч</th>
                <th className="py-2 pr-3 text-right font-medium">7д</th>
                <th className="py-2 pr-3 text-right font-medium">30д</th>
                <th className="py-2 pr-3 text-right font-medium">1г</th>
                <th className="py-2 text-right font-medium">Кап.</th>
              </tr>
            </thead>
            <tbody>
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
                const onchainAllowed = isOnchainAllowed(tradeAsset, config.data);
                return (
                  <tr
                    key={entry.id}
                    tabIndex={0}
                    className="cursor-pointer border-b border-zinc-100 last:border-0 odd:bg-zinc-50/60 hover:bg-zinc-100/70 focus:outline-none focus-visible:bg-emerald-50"
                    onClick={() => setSelectedEntry(entry)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setSelectedEntry(entry);
                      }
                    }}
                  >
                    <td className="py-2 pr-3">
                      <div className="flex items-center gap-2">
                        <TokenIcon
                          logoUrl={entry.logoUrl ?? entry.asset.logoUrl}
                          symbol={entry.asset.symbol}
                        />
                        <div className="min-w-0">
                          <div className="font-medium text-zinc-800">{entry.asset.symbol}</div>
                          <div className="truncate text-xs text-zinc-500">
                            {entry.asset.name} · {entry.asset.chainCode}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3">
                      {config.isPending ? (
                        <Button className="h-8 px-3 text-xs" disabled>
                          Проверяю…
                        </Button>
                      ) : onchainAllowed ? (
                        <Button
                          className="h-8 px-3 text-xs"
                          onClick={(event) => {
                            event.stopPropagation();
                            onBuy(tradeAsset, entry.priceUsd);
                          }}
                        >
                          Купить
                        </Button>
                      ) : (
                        <Button
                          variant="secondary"
                          className="h-8 px-3 text-xs"
                          onClick={(event) => {
                            event.stopPropagation();
                            onManual?.(tradeAsset, entry.priceUsd);
                          }}
                          disabled={!onManual}
                          title="On-chain покупка недоступна: токен не в разрешённом списке. Откроется ручная запись."
                        >
                          Купить
                        </Button>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono text-base font-medium tabular-nums text-zinc-800">
                      <LiveValue value={formatPrice(entry.priceUsd)}>
                        {formatPrice(entry.priceUsd)}
                      </LiveValue>
                    </td>
                    <td className="py-2 pr-3">
                      <PriceFreshness
                        updatedAt={entry.priceUpdatedAt}
                        fetchedAt={entry.priceFetchedAt}
                        source={entry.priceSource}
                      />
                    </td>
                    <td
                      className={`py-2 pr-3 text-right font-mono tabular-nums ${pnlTone(
                        entry.change24hPct,
                      )}`}
                    >
                      <LiveValue value={entry.change24hPct ? formatPct(entry.change24hPct) : '—'}>
                        {entry.change24hPct ? formatPct(entry.change24hPct) : '—'}
                      </LiveValue>
                    </td>
                    <PeriodChange value={entry.change7dPct} />
                    <PeriodChange value={entry.change30dPct} />
                    <PeriodChange value={entry.change1yPct} />
                    <td className="py-2 text-right font-mono tabular-nums text-zinc-600">
                      {entry.marketCapUsd ? formatUsdCompact(entry.marketCapUsd) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <TokenInfoDialog entry={selectedEntry} onClose={() => setSelectedEntry(null)} />
    </Card>
  );
}
