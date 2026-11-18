import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { Select } from '@/components/ui/select';
import { fetchWatchlist, fetchWatchlistGroups } from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { Asset, WatchlistEntry } from '@nexter/contracts';
import { TokenBlock } from '../watchlist/token-block';
import { TokenDrawer } from '../watchlist/token-drawer';
import { useRuntimeSettings } from '../settings/use-settings';

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
  const runtime = useRuntimeSettings();
  const defaultGroup = groups.data?.groups.find((group) => group.isDefault);
  const watchlist = useQuery({
    queryKey: ['buy-list', defaultGroup?.id],
    queryFn: () => fetchWatchlist(false, undefined, defaultGroup?.id, 100),
    enabled: Boolean(defaultGroup?.id),
    refetchInterval: runtime.portfolioPollSeconds * 1000,
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
  const groupsData = groups.data?.groups ?? [];
  const selectedGroup = selectedEntry?.groupId
    ? (groupsData.find((group) => group.id === selectedEntry.groupId) ?? null)
    : null;
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

      {entries.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-600">
          В группе «Основная» пока нет токенов. Добавьте их в базе токенов.
        </p>
      ) : (
        <div className="mt-4 space-y-2">
          {sortedEntries.map((entry) => (
            <TokenBlock
              key={entry.id}
              entry={entry}
              onOpen={() => setSelectedEntry(entry)}
              onBuy={onBuy}
            />
          ))}
        </div>
      )}
      <TokenDrawer
        entry={selectedEntry}
        groupName={selectedGroup?.name ?? null}
        groups={groupsData}
        defaultGroupId={defaultGroup?.id ?? null}
        onClose={() => setSelectedEntry(null)}
      />
    </Card>
  );
}
