import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { ErrorState, LoadingRows } from '@/components/ui/states';
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
import { formatPct, formatUsd, pnlTone } from '@/lib/format';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import type { WatchlistEntry, WatchlistTokenSearchResult } from '@nexter/contracts';

function tagsFromInput(value: string): string[] {
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function iconSrc(logoUrl: string | null): string | null {
  if (!logoUrl) return null;
  return `/api/v1/watchlist/icon?url=${encodeURIComponent(logoUrl)}`;
}

export function WatchlistPage() {
  const queryClient = useQueryClient();
  const [includeArchived, setIncludeArchived] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<WatchlistEntry | null>(null);
  const [assetId, setAssetId] = useState('');
  const [thesis, setThesis] = useState('');
  const [tags, setTags] = useState('');
  const [priority, setPriority] = useState('0');
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
  });
  const assets = useQuery({ queryKey: ['assets'], queryFn: fetchAssets });
  const entries = watchlist.data?.pages.flatMap((page) => page.data) ?? [];

  useEffect(() => {
    if (!searchGroupId && defaultGroup) setSearchGroupId(defaultGroup.id);
  }, [defaultGroup, searchGroupId]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['watchlist'] });
    void queryClient.invalidateQueries({ queryKey: ['watchlist-groups'] });
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        thesis: thesis || null,
        tags: tagsFromInput(tags),
        priority: Number.parseInt(priority, 10) || 0,
        ...(editGroupId ? { groupId: editGroupId } : {}),
      };

      if (editing) return updateWatchlist(editing.id, payload);
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
      setPriority('0');
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
    setPriority('0');
    setEditGroupId(defaultGroup?.id ?? '');
    setError(null);
    setDialogOpen(true);
  }

  function openEdit(entry: WatchlistEntry) {
    setEditing(entry);
    setAssetId(entry.asset.id);
    setThesis(entry.thesis ?? '');
    setTags(entry.tags.join(', '));
    setPriority(String(entry.priority));
    setEditGroupId(entry.groupId ?? defaultGroup?.id ?? '');
    setError(null);
    setDialogOpen(true);
  }

  const groupsToRender = groups.data?.groups ?? [];
  const groupById = new Map(groupsToRender.map((group) => [group.id, group]));
  const canSearch = /^0x[0-9a-fA-F]{40}$/.test(searchAddress.trim()) && !searchMutation.isPending;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Наблюдение"
        subtitle="Группы, идеи и токены, найденные по контракту."
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

      <Card>
        <CardTitle>Найти токен по контракту</CardTitle>
        <CardDescription>
          Введите адрес ERC-20/BEP-20 контракта. Метаданные читаются on-chain, цена и иконка — через
          серверный CoinGecko.
        </CardDescription>
        <div className="mt-4 grid gap-3 md:grid-cols-[150px_1fr_auto]">
          <label className="block text-sm text-zinc-600">
            Сеть
            <Select
              className="mt-1"
              aria-label="Сеть токена"
              value={searchChain}
              onChange={(event) => setSearchChain(event.target.value as 'bsc' | 'ethereum')}
            >
              <option value="bsc">BNB Smart Chain</option>
              <option value="ethereum">Ethereum</option>
            </Select>
          </label>
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
                {iconSrc(searchResult.logoUrl) ? (
                  <img
                    src={iconSrc(searchResult.logoUrl) ?? undefined}
                    alt=""
                    className="h-10 w-10 rounded-full"
                  />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-200 text-xs font-semibold text-zinc-600">
                    {searchResult.symbol.slice(0, 2)}
                  </div>
                )}
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
                  {formatUsd(searchResult.priceUsd)}
                </div>
                <div className={`text-xs ${pnlTone(searchResult.change24hPct)}`}>
                  {searchResult.change24hPct ? formatPct(searchResult.change24hPct) : '24ч: —'}
                </div>
              </div>
            </div>

            <div className="mt-3 grid gap-2 text-xs text-zinc-500 sm:grid-cols-2">
              <div>Market cap: {formatUsd(searchResult.marketCapUsd)}</div>
              <div>Volume 24h: {formatUsd(searchResult.volume24hUsd)}</div>
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
          <div className="grid gap-4 lg:grid-cols-2">
            {entries.map((entry) => {
              const group = entry.groupId ? groupById.get(entry.groupId) : null;
              return (
                <Card key={entry.id} className={entry.archivedAt ? 'opacity-60' : undefined}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      {iconSrc(entry.logoUrl) ? (
                        <img
                          src={iconSrc(entry.logoUrl) ?? undefined}
                          alt=""
                          className="h-9 w-9 rounded-full"
                        />
                      ) : (
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-200 text-xs font-semibold text-zinc-600">
                          {entry.asset.symbol.slice(0, 2)}
                        </div>
                      )}
                      <div>
                        <div className="flex items-center gap-2">
                          <Link
                            to="/portfolio/assets/$assetId"
                            params={{ assetId: entry.asset.id }}
                            className="text-lg font-semibold text-zinc-900 hover:text-emerald-800"
                          >
                            {entry.asset.symbol}
                          </Link>
                          {entry.archivedAt ? <Badge tone="neutral">Архив</Badge> : null}
                          {group ? <Badge tone="info">{group.name}</Badge> : null}
                        </div>
                        <div className="text-xs text-zinc-500">
                          {entry.asset.name} · {entry.asset.chainCode} · приоритет {entry.priority}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-lg font-semibold text-zinc-900">
                        {formatUsd(entry.priceUsd)}
                      </div>
                      <div className={`text-xs ${pnlTone(entry.change24hPct)}`}>
                        {entry.change24hPct ? formatPct(entry.change24hPct) : '24ч: —'}
                      </div>
                    </div>
                  </div>

                  {entry.tags.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {entry.tags.map((tag) => (
                        <Badge key={tag} tone="info">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  ) : null}

                  <p className="mt-3 line-clamp-4 text-sm text-zinc-600">
                    {entry.thesis ?? 'Тезис не заполнен.'}
                  </p>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      className="h-8 px-3 text-xs"
                      onClick={() => openEdit(entry)}
                    >
                      Изменить
                    </Button>
                    {!entry.archivedAt ? (
                      <Button
                        variant="ghost"
                        className="h-8 px-3 text-xs"
                        onClick={() => {
                          if (window.confirm(`Архивировать ${entry.asset.symbol}?`)) {
                            archiveMutation.mutate(entry.id);
                          }
                        }}
                        disabled={archiveMutation.isPending}
                      >
                        В архив
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        className="h-8 px-3 text-xs"
                        onClick={() => restoreMutation.mutate(entry.id)}
                        disabled={restoreMutation.isPending}
                      >
                        Вернуть
                      </Button>
                    )}
                  </div>
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
        title={editing ? 'Изменить наблюдение' : 'Добавить в наблюдение'}
        description="Тезис и теги — продуктовые заметки, не влияют на учёт."
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              Отмена
            </Button>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || (!editing && !assetId)}
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
            Тезис
            <Textarea
              className="mt-1"
              value={thesis}
              onChange={(event) => setThesis(event.target.value)}
              placeholder="Почему этот актив интересен"
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
