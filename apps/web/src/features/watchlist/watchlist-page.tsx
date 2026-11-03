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
  fetchAssets,
  fetchWatchlist,
  updateWatchlist,
} from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import { formatPct, formatUsd, pnlTone } from '@/lib/format';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import type { WatchlistEntry } from '@nexter/contracts';

function tagsFromInput(value: string): string[] {
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 20);
}

export function WatchlistPage() {
  const queryClient = useQueryClient();
  const [includeArchived, setIncludeArchived] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<WatchlistEntry | null>(null);
  const [assetId, setAssetId] = useState('');
  const [thesis, setThesis] = useState('');
  const [tags, setTags] = useState('');
  const [priority, setPriority] = useState('0');
  const [error, setError] = useState<string | null>(null);

  const watchlist = useQuery({
    queryKey: ['watchlist', includeArchived],
    queryFn: () => fetchWatchlist(includeArchived),
  });
  const assets = useQuery({ queryKey: ['assets'], queryFn: fetchAssets });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['watchlist'] });
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        thesis: thesis || null,
        tags: tagsFromInput(tags),
        priority: Number.parseInt(priority, 10) || 0,
      };

      if (editing) return updateWatchlist(editing.id, payload);
      return createWatchlist({ assetId, ...payload });
    },
    onSuccess: () => {
      setDialogOpen(false);
      setEditing(null);
      setAssetId('');
      setThesis('');
      setTags('');
      setPriority('0');
      setError(null);
      invalidate();
    },
    onError: (err) => setError(toRussianError(err, 'Не удалось сохранить запись')),
  });

  const archiveMutation = useMutation({
    mutationFn: (id: string) => archiveWatchlist(id),
    onSuccess: () => invalidate(),
    onError: (err) => setError(toRussianError(err, 'Не удалось архивировать запись')),
  });

  function openCreate() {
    setEditing(null);
    setAssetId('');
    setThesis('');
    setTags('');
    setPriority('0');
    setError(null);
    setDialogOpen(true);
  }

  function openEdit(entry: WatchlistEntry) {
    setEditing(entry);
    setAssetId(entry.asset.id);
    setThesis(entry.thesis ?? '');
    setTags(entry.tags.join(', '));
    setPriority(String(entry.priority));
    setError(null);
    setDialogOpen(true);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Наблюдение"
        subtitle="Идеи, тезисы и приоритеты по активам."
        actions={
          <>
            <label className="flex items-center gap-2 text-sm text-zinc-400">
              <input
                type="checkbox"
                checked={includeArchived}
                onChange={(event) => setIncludeArchived(event.target.checked)}
                className="h-4 w-4 rounded border-zinc-700 bg-zinc-950"
              />
              Архив
            </label>
            <Button onClick={openCreate}>Добавить актив</Button>
          </>
        }
      />

      {watchlist.isPending ? <LoadingRows rows={5} /> : null}
      {watchlist.isError ? (
        <ErrorState
          message={toRussianError(watchlist.error, 'Не удалось загрузить наблюдение')}
          onRetry={() => void watchlist.refetch()}
        />
      ) : null}

      {!watchlist.isPending && !watchlist.isError ? (
        (watchlist.data?.data.length ?? 0) === 0 ? (
          <Card>
            <CardTitle>Список пуст</CardTitle>
            <CardDescription>
              Добавьте актив вручную или импортируйте Source из Notion — тезисы подтянутся
              автоматически.
            </CardDescription>
            <Button className="mt-4" onClick={openCreate}>
              Добавить актив
            </Button>
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {watchlist.data?.data.map((entry) => (
              <Card key={entry.id} className={entry.archivedAt ? 'opacity-60' : undefined}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Link
                        to="/portfolio/assets/$assetId"
                        params={{ assetId: entry.asset.id }}
                        className="text-lg font-semibold text-zinc-50 hover:text-emerald-300"
                      >
                        {entry.asset.symbol}
                      </Link>
                      {entry.archivedAt ? <Badge tone="neutral">Архив</Badge> : null}
                    </div>
                    <div className="text-xs text-zinc-500">
                      {entry.asset.name} · {entry.asset.chainCode} · приоритет {entry.priority}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-lg font-semibold text-zinc-100">
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

                <p className="mt-3 line-clamp-4 text-sm text-zinc-400">
                  {entry.thesis ?? 'Тезис не заполнен.'}
                </p>

                <div className="mt-4 flex gap-2">
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
                  ) : null}
                </div>
              </Card>
            ))}
          </div>
        )
      ) : null}

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
            <label className="block text-sm text-zinc-400">
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
            <div className="text-sm text-zinc-400">
              Актив: <span className="text-zinc-200">{editing.asset.symbol}</span>
            </div>
          )}
          <label className="block text-sm text-zinc-400">
            Тезис
            <Textarea
              className="mt-1"
              value={thesis}
              onChange={(event) => setThesis(event.target.value)}
              placeholder="Почему этот актив интересен"
            />
          </label>
          <label className="block text-sm text-zinc-400">
            Теги (через запятую)
            <Input
              className="mt-1"
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="Топ, Дашборд"
            />
          </label>
          <label className="block text-sm text-zinc-400">
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
          {error ? <p className="text-sm text-red-300">{error}</p> : null}
        </div>
      </Dialog>
    </div>
  );
}
