import { Badge } from '@/components/ui/badge';
import { ChainToggle } from '@/components/chain-toggle';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { LiveValue } from '@/components/ui/live-value';
import { PriceFreshness } from '@/components/ui/price-freshness';
import { TokenIcon } from '@/components/token-icon';
import { Textarea } from '@/components/ui/textarea';
import {
  archiveWatchlist,
  createWatchlist,
  createWatchlistFromContract,
  createWatchlistGroup,
  deleteWatchlistGroup,
  fetchAssets,
  fetchWatchlist,
  fetchWatchlistGroups,
  searchWatchlistToken,
  updateWatchlist,
} from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import { formatPct, formatPrice, formatUsd, formatUsdCompact, pnlTone } from '@/lib/format';
import { compressTokenIcon } from '@/lib/image';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { WatchlistEntry, WatchlistTokenSearchResult } from '@nexter/contracts';
import { TokenDrawer } from './token-drawer';

function tagsFromInput(value: string): string[] {
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function investorsFromInput(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(',')
        .map((investor) => investor.trim())
        .filter(Boolean),
    ),
  );
}

function urlOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function isValidExternalUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (!/^https?:\/\//i.test(trimmed)) return false;

  try {
    new URL(trimmed);
    return true;
  } catch {
    return false;
  }
}

function isValidIconValue(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(trimmed)) return true;

  try {
    const url = new URL(trimmed);
    return (
      url.protocol === 'https:' &&
      (url.hostname === 'coin-images.coingecko.com' || url.hostname === 'assets.coingecko.com')
    );
  } catch {
    return false;
  }
}

type TokenSortKey = 'default' | 'marketCap' | 'change24h' | 'change7d' | 'change30d' | 'change1y';

const TOKEN_SORT_LABELS: Record<TokenSortKey, string> = {
  default: 'По умолчанию',
  marketCap: 'Капитализация',
  change24h: 'Изменение 24ч',
  change7d: 'Изменение 7д',
  change30d: 'Изменение 30д',
  change1y: 'Изменение 1г',
};

function sortValue(entry: WatchlistEntry, key: Exclude<TokenSortKey, 'default'>): number | null {
  const raw =
    key === 'marketCap'
      ? entry.marketCapUsd
      : key === 'change24h'
        ? entry.change24hPct
        : key === 'change7d'
          ? entry.change7dPct
          : key === 'change30d'
            ? entry.change30dPct
            : entry.change1yPct;
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function WatchlistPage() {
  const queryClient = useQueryClient();
  const [includeArchived, setIncludeArchived] = useState(false);
  const [sortKey, setSortKey] = useState<TokenSortKey>('default');
  const [sortDirection, setSortDirection] = useState<'desc' | 'asc'>('desc');
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<WatchlistEntry | null>(null);
  const [assetId, setAssetId] = useState('');
  const [thesis, setThesis] = useState('');
  const [tags, setTags] = useState('');
  const [twitterUrl, setTwitterUrl] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [investors, setInvestors] = useState('');
  const [priority, setPriority] = useState('0');
  const [logoUrl, setLogoUrl] = useState('');
  const [logoUrlText, setLogoUrlText] = useState('');
  const [iconUploading, setIconUploading] = useState(false);
  const iconFileRef = useRef<HTMLInputElement>(null);
  const [drawerEntryId, setDrawerEntryId] = useState<string | null>(null);
  const [editGroupId, setEditGroupId] = useState('');
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupError, setGroupError] = useState<string | null>(null);
  const [searchChain, setSearchChain] = useState<'bsc' | 'ethereum'>('bsc');
  const [searchAddress, setSearchAddress] = useState('');
  const [searchResult, setSearchResult] = useState<WatchlistTokenSearchResult | null>(null);
  const [searchGroupId, setSearchGroupId] = useState('');
  const [searchError, setSearchError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const groups = useQuery({ queryKey: ['watchlist-groups'], queryFn: fetchWatchlistGroups });
  const defaultGroup = groups.data?.groups.find((group) => group.isDefault);
  const effectiveSearchGroupId = searchGroupId || defaultGroup?.id || '';

  const watchlist = useInfiniteQuery({
    queryKey: ['watchlist', includeArchived, selectedGroupId],
    queryFn: ({ pageParam }) =>
      fetchWatchlist(includeArchived, pageParam ?? undefined, selectedGroupId ?? undefined),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.page.hasMore ? last.page.nextCursor : undefined),
    refetchInterval: 30_000,
  });
  const assets = useQuery({ queryKey: ['assets'], queryFn: fetchAssets });
  const entries = watchlist.data?.pages.flatMap((page) => page.data) ?? [];
  const sortedEntries =
    sortKey === 'default'
      ? entries
      : [...entries].sort((left, right) => {
          const a = sortValue(left, sortKey);
          const b = sortValue(right, sortKey);
          if (a === null && b === null) return 0;
          if (a === null) return 1;
          if (b === null) return -1;
          return sortDirection === 'desc' ? b - a : a - b;
        });

  useEffect(() => {
    if (!searchGroupId && defaultGroup) setSearchGroupId(defaultGroup.id);
  }, [defaultGroup, searchGroupId]);

  const invalidate = () => {
    for (const key of ['watchlist', 'watchlist-groups', 'assets', 'positions', 'portfolio-asset']) {
      void queryClient.invalidateQueries({ queryKey: [key] });
    }
    void queryClient.invalidateQueries({ queryKey: ['trade-groups'] });
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        thesis: thesis || null,
        tags: tagsFromInput(tags),
        twitterUrl: urlOrNull(twitterUrl),
        websiteUrl: urlOrNull(websiteUrl),
        investors: investorsFromInput(investors),
        priority: Number.parseInt(priority, 10) || 0,
        ...(editGroupId ? { groupId: editGroupId } : {}),
      };

      if (editing) {
        return updateWatchlist(editing.id, {
          ...payload,
          logoUrl: logoUrl.trim() || null,
        });
      }
      return createWatchlist({
        assetId,
        groupId: editGroupId || defaultGroup?.id,
        ...payload,
      });
    },
    onSuccess: () => {
      setDialogOpen(false);
      setEditing(null);
      setAssetId('');
      setThesis('');
      setTags('');
      setTwitterUrl('');
      setWebsiteUrl('');
      setInvestors('');
      setPriority('0');
      setLogoUrl('');
      setLogoUrlText('');
      setEditGroupId('');
      setError(null);
      invalidate();
    },
    onError: (err) => setError(toRussianError(err, 'Не удалось сохранить запись')),
  });

  const searchMutation = useMutation({
    mutationFn: () => searchWatchlistToken({ chain: searchChain, address: searchAddress.trim() }),
    onSuccess: (result) => {
      setSearchResult(result);
      setSearchError(null);
      setSearchGroupId(defaultGroup?.id ?? '');
    },
    onError: (err) => {
      setSearchResult(null);
      setSearchError(toRussianError(err, 'Не удалось найти токен'));
    },
  });

  const addFromContractMutation = useMutation({
    mutationFn: () => {
      if (!searchResult) throw new Error('No token selected');
      return createWatchlistFromContract({
        chain: searchResult.chain,
        address: searchResult.address,
        groupId: effectiveSearchGroupId || undefined,
      });
    },
    onSuccess: () => {
      setSearchResult(null);
      setSearchAddress('');
      setSearchError(null);
      invalidate();
    },
    onError: (err) => setSearchError(toRussianError(err, 'Не удалось добавить токен')),
  });

  const createGroupMutation = useMutation({
    mutationFn: () => createWatchlistGroup({ name: groupName.trim() }),
    onSuccess: (group) => {
      setGroupDialogOpen(false);
      setGroupName('');
      setGroupError(null);
      setSelectedGroupId(group.id);
      void queryClient.invalidateQueries({ queryKey: ['watchlist-groups'] });
    },
    onError: (err) => setGroupError(toRussianError(err, 'Не удалось создать группу')),
  });

  const deleteGroupMutation = useMutation({
    mutationFn: (id: string) => deleteWatchlistGroup(id),
    onSuccess: (_data, id) => {
      if (selectedGroupId === id) setSelectedGroupId(null);
      void queryClient.invalidateQueries({ queryKey: ['watchlist-groups'] });
      void queryClient.invalidateQueries({ queryKey: ['watchlist'] });
    },
    onError: (err) => setError(toRussianError(err, 'Не удалось удалить группу')),
  });

  const archiveMutation = useMutation({
    mutationFn: (id: string) => archiveWatchlist(id),
    onSuccess: () => {
      setDrawerEntryId(null);
      setError(null);
      invalidate();
    },
    onError: (err) => setError(toRussianError(err, 'Не удалось архивировать запись')),
  });

  const restoreMutation = useMutation({
    mutationFn: (id: string) => updateWatchlist(id, { archived: false }),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (err) => setError(toRussianError(err, 'Не удалось вернуть запись')),
  });

  function openCreate() {
    setEditing(null);
    setAssetId('');
    setThesis('');
    setTags('');
    setTwitterUrl('');
    setWebsiteUrl('');
    setInvestors('');
    setPriority('0');
    setLogoUrl('');
    setLogoUrlText('');
    setEditGroupId(defaultGroup?.id ?? '');
    setError(null);
    setDialogOpen(true);
  }

  function openEdit(entry: WatchlistEntry) {
    setDrawerEntryId(null);
    setEditing(entry);
    setAssetId(entry.asset.id);
    setThesis(entry.thesis ?? '');
    setTags(entry.tags.join(', '));
    setTwitterUrl(entry.twitterUrl ?? '');
    setWebsiteUrl(entry.websiteUrl ?? '');
    setInvestors(entry.investors.join(', '));
    setPriority(String(entry.priority));
    setLogoUrl(entry.logoUrl ?? '');
    setLogoUrlText(entry.logoUrl?.startsWith('data:') ? '' : (entry.logoUrl ?? ''));
    setEditGroupId(entry.groupId ?? defaultGroup?.id ?? '');
    setError(null);
    setDialogOpen(true);
  }

  async function handleIconFile(file: File | undefined): Promise<void> {
    if (!file) return;
    setIconUploading(true);
    setError(null);
    try {
      setLogoUrl(await compressTokenIcon(file));
      setLogoUrlText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить иконку');
    } finally {
      setIconUploading(false);
      if (iconFileRef.current) iconFileRef.current.value = '';
    }
  }

  const groupsToRender = groups.data?.groups ?? [];
  const groupById = new Map(groupsToRender.map((group) => [group.id, group]));
  const canSearch = /^0x[0-9a-fA-F]{40}$/.test(searchAddress.trim()) && !searchMutation.isPending;
  const drawerEntry = drawerEntryId
    ? (entries.find((entry) => entry.id === drawerEntryId) ?? null)
    : null;
  const drawerGroup = drawerEntry?.groupId ? groupById.get(drawerEntry.groupId) : null;
  const investorValues = investorsFromInput(investors);
  const twitterInvalid = !isValidExternalUrl(twitterUrl);
  const websiteInvalid = !isValidExternalUrl(websiteUrl);
  const iconInvalid = !isValidIconValue(logoUrl);
  const metadataInvalid =
    investorValues.length > 30 || twitterInvalid || websiteInvalid || iconInvalid;

  return (
    <div className="space-y-6">
      <PageHeader
        title="База токенов"
        subtitle="Карточки токенов: контракт, описание, ссылки и инвесторы."
        actions={
          <>
            <label className="flex items-center gap-2 text-sm text-zinc-600">
              <input
                type="checkbox"
                checked={includeArchived}
                onChange={(event) => setIncludeArchived(event.target.checked)}
                className="h-4 w-4 rounded border-zinc-300 bg-white"
              />
              Архив
            </label>
            <Button variant="secondary" onClick={() => setGroupDialogOpen(true)}>
              Новая группа
            </Button>
            <Button onClick={openCreate}>Добавить актив</Button>
          </>
        }
      />

      {error && !dialogOpen ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setSelectedGroupId(null)}
          className={`rounded-lg border px-3 py-1.5 text-sm ${
            selectedGroupId === null
              ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
              : 'border-zinc-200 bg-white text-zinc-600 hover:text-zinc-900'
          }`}
        >
          Все
        </button>
        {groupsToRender.map((group) => (
          <div
            key={group.id}
            className={`flex items-center gap-1 rounded-lg border ${
              selectedGroupId === group.id
                ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                : 'border-zinc-200 bg-white text-zinc-600'
            }`}
          >
            <button
              type="button"
              onClick={() => setSelectedGroupId(group.id)}
              className="px-3 py-1.5 text-sm hover:text-zinc-900"
            >
              {group.name}
              <span className="ml-1.5 text-xs text-zinc-500">{group.entryCount}</span>
            </button>
            {!group.isDefault ? (
              <button
                type="button"
                aria-label={`Удалить группу ${group.name}`}
                className="px-2 py-1.5 text-xs text-zinc-400 hover:text-red-700"
                onClick={() => {
                  if (
                    window.confirm(`Удалить группу «${group.name}»? Токены перейдут в «Основную».`)
                  ) {
                    deleteGroupMutation.mutate(group.id);
                  }
                }}
              >
                ✕
              </button>
            ) : null}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-zinc-500">Сортировка</span>
        <Select
          aria-label="Сортировка базы токенов"
          className="w-auto"
          value={sortKey}
          onChange={(event) => setSortKey(event.target.value as TokenSortKey)}
        >
          {(Object.keys(TOKEN_SORT_LABELS) as TokenSortKey[]).map((key) => (
            <option key={key} value={key}>
              {TOKEN_SORT_LABELS[key]}
            </option>
          ))}
        </Select>
        <Button
          variant="secondary"
          className="h-10 px-3"
          aria-label={sortDirection === 'desc' ? 'По убыванию' : 'По возрастанию'}
          title={sortDirection === 'desc' ? 'По убыванию' : 'По возрастанию'}
          disabled={sortKey === 'default'}
          onClick={() => setSortDirection((value) => (value === 'desc' ? 'asc' : 'desc'))}
        >
          {sortDirection === 'desc' ? '↓' : '↑'}
        </Button>
      </div>

      <Card>
        <CardTitle>Найти токен по контракту</CardTitle>
        <CardDescription>
          Введите адрес ERC-20/BEP-20 контракта. Метаданные читаются on-chain, цена и иконка — через
          серверный CoinGecko.
        </CardDescription>
        <div className="mt-4 grid gap-3 md:grid-cols-[auto_1fr_auto]">
          <div>
            <span className="block text-sm text-zinc-600">Сеть</span>
            <ChainToggle
              className="mt-1"
              value={searchChain}
              onChange={setSearchChain}
              ariaLabel="Сеть токена"
              labelClassName="inline"
            />
          </div>
          <label className="block text-sm text-zinc-600">
            Адрес контракта
            <Input
              className="mt-1 font-mono"
              aria-label="Адрес контракта"
              placeholder="0x…"
              value={searchAddress}
              onChange={(event) => {
                setSearchAddress(event.target.value);
                setSearchResult(null);
                setSearchError(null);
              }}
            />
          </label>
          <div className="flex items-end">
            <Button
              onClick={() => searchMutation.mutate()}
              disabled={!canSearch}
              className="w-full md:w-auto"
            >
              {searchMutation.isPending ? 'Ищу…' : 'Найти'}
            </Button>
          </div>
        </div>
        {searchError ? <p className="mt-3 text-sm text-red-700">{searchError}</p> : null}

        {searchResult ? (
          <div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <TokenIcon
                  logoUrl={searchResult.logoUrl}
                  symbol={searchResult.symbol}
                  className="h-10 w-10 text-xs"
                />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-semibold text-zinc-900">
                      {searchResult.symbol}
                    </span>
                    <Badge tone="neutral">{searchResult.chain}</Badge>
                    {searchResult.alreadyInWatchlist ? (
                      <Badge tone="info">Уже в списке</Badge>
                    ) : null}
                  </div>
                  <div className="text-xs text-zinc-500">
                    {searchResult.name} · {searchResult.decimals} decimals ·{' '}
                    {searchResult.address.slice(0, 8)}…{searchResult.address.slice(-6)}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="font-mono text-lg font-semibold text-zinc-900">
                  {formatPrice(searchResult.priceUsd)}
                </div>
                <div className={`text-xs ${pnlTone(searchResult.change24hPct)}`}>
                  {searchResult.change24hPct ? formatPct(searchResult.change24hPct) : '24ч: —'}
                </div>
              </div>
            </div>

            <div className="mt-3 grid gap-2 text-xs text-zinc-500 sm:grid-cols-2">
              <div>Капитализация: {formatUsd(searchResult.marketCapUsd)}</div>
              <div>Объём за 24 ч: {formatUsd(searchResult.volume24hUsd)}</div>
            </div>

            {!searchResult.alreadyInWatchlist ? (
              <div className="mt-4 flex flex-wrap items-end gap-2">
                <label className="block text-sm text-zinc-600">
                  Группа
                  <Select
                    className="mt-1"
                    aria-label="Группа для токена"
                    value={effectiveSearchGroupId}
                    onChange={(event) => setSearchGroupId(event.target.value)}
                  >
                    {groupsToRender.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                  </Select>
                </label>
                <Button
                  onClick={() => addFromContractMutation.mutate()}
                  disabled={addFromContractMutation.isPending || !effectiveSearchGroupId}
                >
                  {addFromContractMutation.isPending ? 'Добавляю…' : 'Добавить в группу'}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </Card>

      {watchlist.isPending ? <LoadingRows rows={5} /> : null}
      {watchlist.isError ? (
        <ErrorState
          message={toRussianError(watchlist.error, 'Не удалось загрузить наблюдение')}
          onRetry={() => void watchlist.refetch()}
        />
      ) : null}

      {!watchlist.isPending && !watchlist.isError ? (
        entries.length === 0 ? (
          <Card>
            <CardTitle>Список пуст</CardTitle>
            <CardDescription>
              Найди токен по контракту или добавь актив из уже загруженного списка.
            </CardDescription>
            <Button className="mt-4" onClick={openCreate}>
              Добавить актив
            </Button>
          </Card>
        ) : (
          <div className="space-y-2">
            {sortedEntries.map((entry) => {
              const group = entry.groupId ? groupById.get(entry.groupId) : null;
              const periodChanges = [
                { label: '7д', value: entry.change7dPct },
                { label: '30д', value: entry.change30dPct },
                { label: '1г', value: entry.change1yPct },
              ];
              return (
                <Card
                  key={entry.id}
                  className={`p-0 transition-colors hover:border-emerald-300 ${
                    entry.archivedAt ? 'opacity-60' : ''
                  }`}
                >
                  <button
                    type="button"
                    className="flex w-full flex-wrap items-center justify-between gap-3 p-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600"
                    onClick={() => setDrawerEntryId(entry.id)}
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-3">
                      <TokenIcon
                        logoUrl={entry.logoUrl}
                        symbol={entry.asset.symbol}
                        className="h-10 w-10 text-xs"
                      />
                      <span className="block min-w-0">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-base font-semibold text-zinc-900">
                            {entry.asset.symbol}
                          </span>
                          {entry.archivedAt ? <Badge tone="neutral">Архив</Badge> : null}
                          {group ? <Badge tone="info">{group.name}</Badge> : null}
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
                          <span className="truncate">
                            {entry.asset.name} · {entry.asset.chainCode}
                          </span>
                          {entry.marketCapUsd ? (
                            <span className="whitespace-nowrap">
                              Кап. {formatUsdCompact(entry.marketCapUsd)}
                            </span>
                          ) : null}
                          {entry.tags.slice(0, 4).map((tag) => (
                            <Badge key={tag} tone="info">
                              {tag}
                            </Badge>
                          ))}
                        </span>
                      </span>
                    </span>

                    <span className="flex shrink-0 items-center gap-4">
                      <PriceFreshness
                        updatedAt={entry.priceUpdatedAt}
                        fetchedAt={entry.priceFetchedAt}
                        source={entry.priceSource}
                        className="hidden sm:inline-flex"
                      />
                      <span className="block text-right">
                        <span className="block font-mono text-base font-semibold text-zinc-900">
                          <LiveValue value={formatPrice(entry.priceUsd)}>
                            {formatPrice(entry.priceUsd)}
                          </LiveValue>
                        </span>
                        <span className={`block text-xs ${pnlTone(entry.change24hPct)}`}>
                          <LiveValue
                            value={entry.change24hPct ? formatPct(entry.change24hPct) : '—'}
                          >
                            {entry.change24hPct ? formatPct(entry.change24hPct) : '24ч: —'}
                          </LiveValue>
                        </span>
                        <span className="mt-0.5 flex justify-end gap-2 text-[11px] text-zinc-500">
                          {periodChanges.map(({ label, value }) => (
                            <span key={label} className={pnlTone(value)}>
                              {label} {value ? formatPct(value) : '—'}
                            </span>
                          ))}
                        </span>
                      </span>
                      <span aria-hidden="true" className="text-lg text-zinc-300">
                        ›
                      </span>
                    </span>
                  </button>
                </Card>
              );
            })}
          </div>
        )
      ) : null}

      {watchlist.hasNextPage ? (
        <div className="flex justify-center">
          <Button
            variant="secondary"
            onClick={() => void watchlist.fetchNextPage()}
            disabled={watchlist.isFetchingNextPage}
          >
            {watchlist.isFetchingNextPage ? 'Загружаю…' : 'Загрузить ещё'}
          </Button>
        </div>
      ) : null}

      <TokenDrawer
        entry={drawerEntry}
        groupName={drawerGroup?.name ?? null}
        onClose={() => setDrawerEntryId(null)}
        onEdit={openEdit}
        onArchive={(entry) => {
          if (window.confirm(`Архивировать ${entry.asset.symbol}?`)) {
            archiveMutation.mutate(entry.id);
          }
        }}
        onRestore={(entry) => restoreMutation.mutate(entry.id)}
        busy={archiveMutation.isPending || restoreMutation.isPending}
        error={error}
      />

      <Dialog
        open={groupDialogOpen}
        onClose={() => setGroupDialogOpen(false)}
        title="Новая группа"
        description="Например: Основная, Наблюдение, Перспективные."
        footer={
          <>
            <Button variant="ghost" onClick={() => setGroupDialogOpen(false)}>
              Отмена
            </Button>
            <Button
              onClick={() => createGroupMutation.mutate()}
              disabled={createGroupMutation.isPending || !groupName.trim()}
            >
              {createGroupMutation.isPending ? 'Создаю…' : 'Создать'}
            </Button>
          </>
        }
      >
        <label className="block text-sm text-zinc-600">
          Название группы
          <Input
            className="mt-1"
            value={groupName}
            onChange={(event) => setGroupName(event.target.value)}
            placeholder="Наблюдение"
          />
        </label>
        {groupError ? <p className="mt-2 text-sm text-red-700">{groupError}</p> : null}
      </Dialog>

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={editing ? 'Изменить токен' : 'Добавить токен'}
        description="Описание, иконка, ссылки и инвесторы — карточка токена, не влияет на учёт."
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              Отмена
            </Button>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={
                saveMutation.isPending || (!editing && !assetId) || metadataInvalid || iconUploading
              }
            >
              {saveMutation.isPending ? 'Сохраняю…' : 'Сохранить'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {!editing ? (
            <label className="block text-sm text-zinc-600">
              Актив
              <Select
                className="mt-1"
                value={assetId}
                onChange={(event) => setAssetId(event.target.value)}
              >
                <option value="">Выберите актив</option>
                {assets.data?.assets.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.symbol} · {asset.chainCode}
                  </option>
                ))}
              </Select>
            </label>
          ) : (
            <div className="text-sm text-zinc-600">
              Актив: <span className="text-zinc-800">{editing.asset.symbol}</span>
            </div>
          )}
          {editing ? (
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
              <div className="flex items-center gap-3">
                <TokenIcon
                  logoUrl={logoUrl || null}
                  symbol={editing.asset.symbol}
                  className="h-12 w-12 text-sm"
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-zinc-800">Иконка токена</div>
                  <div className="text-xs text-zinc-500">
                    Если автоматическая иконка не загрузилась, добавьте свою.
                  </div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  className="h-8 px-3 text-xs"
                  onClick={() => iconFileRef.current?.click()}
                  disabled={iconUploading}
                >
                  {iconUploading ? 'Загружаю…' : 'Загрузить файл'}
                </Button>
                {logoUrl ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-8 px-3 text-xs"
                    onClick={() => {
                      setLogoUrl('');
                      setLogoUrlText('');
                    }}
                  >
                    Сбросить
                  </Button>
                ) : null}
              </div>
              <input
                ref={iconFileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                aria-label="Файл иконки токена"
                onChange={(event) => void handleIconFile(event.target.files?.[0])}
              />
              <label className="mt-3 block text-xs text-zinc-500">
                Или ссылка CoinGecko
                <Input
                  className="mt-1"
                  value={logoUrlText}
                  onChange={(event) => {
                    setLogoUrlText(event.target.value);
                    setLogoUrl(event.target.value.trim());
                  }}
                  placeholder="https://assets.coingecko.com/…"
                  aria-label="Ссылка на иконку CoinGecko"
                />
              </label>
              {iconInvalid ? (
                <p className="mt-1 text-xs text-red-700">
                  Загрузите PNG/JPEG/WebP или укажите ссылку CoinGecko.
                </p>
              ) : null}
            </div>
          ) : null}
          <label className="block text-sm text-zinc-600">
            Группа
            <Select
              className="mt-1"
              value={editGroupId}
              onChange={(event) => setEditGroupId(event.target.value)}
            >
              {groupsToRender.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="block text-sm text-zinc-600">
            Описание
            <Textarea
              className="mt-1"
              value={thesis}
              onChange={(event) => setThesis(event.target.value)}
              placeholder="Что это за токен и почему он интересен"
            />
          </label>
          <label className="block text-sm text-zinc-600">
            Теги (через запятую)
            <Input
              className="mt-1"
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="Топ, Дашборд"
            />
          </label>
          <label className="block text-sm text-zinc-600">
            Twitter / X
            <Input
              className="mt-1"
              type="url"
              value={twitterUrl}
              onChange={(event) => setTwitterUrl(event.target.value)}
              placeholder="https://x.com/…"
            />
            {twitterInvalid ? (
              <span className="mt-1 block text-xs text-red-700">
                Ссылка должна начинаться с http:// или https://
              </span>
            ) : null}
          </label>
          <label className="block text-sm text-zinc-600">
            Сайт
            <Input
              className="mt-1"
              type="url"
              value={websiteUrl}
              onChange={(event) => setWebsiteUrl(event.target.value)}
              placeholder="https://…"
            />
            {websiteInvalid ? (
              <span className="mt-1 block text-xs text-red-700">
                Ссылка должна начинаться с http:// или https://
              </span>
            ) : null}
          </label>
          <label className="block text-sm text-zinc-600">
            Инвесторы (через запятую)
            <Input
              className="mt-1"
              value={investors}
              onChange={(event) => setInvestors(event.target.value)}
              placeholder="Alpha Capital, Beta Ventures"
            />
            {investorValues.length > 30 ? (
              <span className="mt-1 block text-xs text-red-700">Не больше 30 инвесторов.</span>
            ) : null}
          </label>
          <label className="block text-sm text-zinc-600">
            Приоритет
            <Input
              className="mt-1"
              type="number"
              min={0}
              max={100}
              value={priority}
              onChange={(event) => setPriority(event.target.value)}
            />
          </label>
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
        </div>
      </Dialog>
    </div>
  );
}
