import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { fetchPortfolioAsset, setPrice } from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import {
  formatDate,
  formatDateTime,
  formatSignedUsd,
  formatTokenAmount,
  formatUsd,
  pnlTone,
} from '@/lib/format';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { useState } from 'react';

const statusLabels: Record<string, string> = {
  open: 'Открыта',
  partial: 'Частично',
  closed: 'Закрыта',
  reserve: 'Резерв',
  for_sale: 'В продажу',
};

export function AssetDetailPage() {
  const { assetId } = useParams({ strict: false }) as { assetId: string };
  const queryClient = useQueryClient();
  const [price, setPriceValue] = useState('');
  const detail = useQuery({
    queryKey: ['portfolio-asset', assetId],
    queryFn: () => fetchPortfolioAsset(assetId),
    enabled: Boolean(assetId),
  });
  const priceMutation = useMutation({
    mutationFn: () => setPrice(assetId, price),
    onSuccess: () => {
      setPriceValue('');
      void queryClient.invalidateQueries({ queryKey: ['portfolio-asset', assetId] });
      void queryClient.invalidateQueries({ queryKey: ['positions'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard-allocation'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard-active-positions'] });
    },
  });

  if (detail.isPending) {
    return (
      <div className="space-y-6">
        <PageHeader title="Актив" />
        <LoadingRows rows={8} />
      </div>
    );
  }

  if (detail.isError || !detail.data) {
    return (
      <div className="space-y-6">
        <PageHeader title="Актив" />
        <ErrorState
          message={toRussianError(detail.error, 'Не удалось загрузить актив')}
          onRetry={() => void detail.refetch()}
        />
      </div>
    );
  }

  const data = detail.data;
  const position = data.position;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${data.asset.symbol} · ${data.asset.name}`}
        subtitle={`${data.asset.chainCode} · ${data.asset.isVerified ? 'проверенный актив' : 'непроверенный актив'}`}
        actions={
          <Button variant="secondary" asChild>
            <Link to="/portfolio">Назад в портфель</Link>
          </Button>
        }
      />

      {data.thesis || data.tags.length > 0 ? (
        <Card>
          <CardTitle>Тезис наблюдения</CardTitle>
          <CardDescription>{data.thesis ?? 'Тезис не заполнен.'}</CardDescription>
          {data.tags.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {data.tags.map((tag) => (
                <Badge key={tag} tone="info">
                  {tag}
                </Badge>
              ))}
            </div>
          ) : null}
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardTitle>Количество</CardTitle>
          <div className="mt-1 font-mono text-2xl font-semibold text-zinc-50">
            {position ? formatTokenAmount(position.amount) : '—'}
          </div>
          <CardDescription>{data.asset.symbol}</CardDescription>
        </Card>
        <Card>
          <CardTitle>Цена</CardTitle>
          <div className="mt-1 font-mono text-2xl font-semibold text-zinc-50">
            {formatUsd(position?.priceUsd ?? null)}
          </div>
          <CardDescription>Последняя цена</CardDescription>
        </Card>
        <Card>
          <CardTitle>Стоимость</CardTitle>
          <div className="mt-1 font-mono text-2xl font-semibold text-zinc-50">
            {formatUsd(position?.valueUsd ?? null)}
          </div>
          <CardDescription>По текущей цене</CardDescription>
        </Card>
        <Card>
          <CardTitle>Нереализованный P&L</CardTitle>
          <div
            className={`mt-1 font-mono text-2xl font-semibold ${pnlTone(position?.unrealizedPnlUsd)}`}
          >
            {formatSignedUsd(position?.unrealizedPnlUsd ?? null)}
          </div>
          <CardDescription>
            Себестоимость {formatUsd(position?.costBasisUsd ?? null)}
          </CardDescription>
        </Card>
      </div>

      <Card>
        <CardTitle>Установить цену</CardTitle>
        <CardDescription>
          Цена используется для оценки портфеля и нереализованного P&L. Деньги хранятся как
          десятичные строки.
        </CardDescription>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Input
            type="text"
            inputMode="decimal"
            placeholder="Например, 0.04182"
            value={price}
            onChange={(event) => setPriceValue(event.target.value)}
            aria-label="Цена в USD"
          />
          <Button
            onClick={() => priceMutation.mutate()}
            disabled={
              priceMutation.isPending || !/^\d+(?:\.\d+)?$/.test(price) || Number(price) <= 0
            }
          >
            Сохранить цену
          </Button>
        </div>
        {priceMutation.isError ? (
          <p className="mt-2 text-sm text-red-300">
            {toRussianError(priceMutation.error, 'Не удалось сохранить цену')}
          </p>
        ) : null}
        {data.prices.length > 0 ? (
          <div className="mt-3 text-xs text-zinc-500">
            Последние цены:{' '}
            {data.prices
              .slice(0, 5)
              .map((item) => `${formatUsd(item.priceUsd)} (${formatDateTime(item.observedAt)})`)
              .join(' · ')}
          </div>
        ) : null}
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardTitle>Лоты</CardTitle>
          <CardDescription>Оставшиеся лоты и себестоимость.</CardDescription>
          {data.lots.length === 0 ? (
            <p className="mt-4 text-sm text-zinc-400">Лотов нет.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 text-left text-xs text-zinc-500">
                    <th className="py-2 pr-3 font-medium">Дата</th>
                    <th className="py-2 pr-3 text-right font-medium">Количество</th>
                    <th className="py-2 pr-3 text-right font-medium">Остаток</th>
                    <th className="py-2 text-right font-medium">Себестоимость</th>
                  </tr>
                </thead>
                <tbody>
                  {data.lots.map((lot) => (
                    <tr key={lot.id} className="border-b border-zinc-800/60 last:border-0">
                      <td className="py-2 pr-3 text-zinc-400">{formatDate(lot.acquiredAt)}</td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums text-zinc-300">
                        {formatTokenAmount(lot.amount)}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums text-zinc-300">
                        {formatTokenAmount(lot.remainingAmount)}
                      </td>
                      <td className="py-2 text-right font-mono tabular-nums text-zinc-400">
                        {formatUsd(lot.remainingCostBasisUsd)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <CardTitle>Сделки</CardTitle>
          <CardDescription>{data.tradeGroups.length} торговых групп по активу.</CardDescription>
          {data.tradeGroups.length === 0 ? (
            <p className="mt-4 text-sm text-zinc-400">Сделок нет.</p>
          ) : (
            <div className="mt-4 max-h-96 overflow-y-auto">
              {data.tradeGroups.map((group) => (
                <Link
                  key={group.id}
                  to="/trades/$tradeId"
                  params={{ tradeId: group.id }}
                  className="flex items-center justify-between gap-3 border-b border-zinc-800/60 py-2 text-sm last:border-0 hover:text-emerald-300"
                >
                  <div>
                    <div className="text-zinc-200">{formatDate(group.openedAt)}</div>
                    <div className="text-xs text-zinc-500">
                      {group.status === 'closed'
                        ? 'Закрыта'
                        : (statusLabels[group.status] ?? group.status)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`font-mono tabular-nums ${pnlTone(group.totalPnlUsd)}`}>
                      {formatSignedUsd(group.totalPnlUsd)}
                    </div>
                    <div className="text-xs text-zinc-500">
                      {group.returnPct ? `${group.returnPct}%` : '—'}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card>
        <CardTitle>Транзакции</CardTitle>
        <CardDescription>Последние операции по активу.</CardDescription>
        {data.transactions.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-400">Транзакций нет.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-left text-xs text-zinc-500">
                  <th className="py-2 pr-3 font-medium">Дата</th>
                  <th className="py-2 pr-3 font-medium">Тип</th>
                  <th className="py-2 pr-3 font-medium">Источник</th>
                  <th className="py-2 font-medium">Заметки</th>
                </tr>
              </thead>
              <tbody>
                {data.transactions.map((transaction) => (
                  <tr key={transaction.id} className="border-b border-zinc-800/60 last:border-0">
                    <td className="py-2 pr-3 text-zinc-400">
                      {formatDateTime(transaction.occurredAt)}
                    </td>
                    <td className="py-2 pr-3 text-zinc-300">
                      {transaction.type} / {transaction.subtype}
                    </td>
                    <td className="py-2 pr-3">
                      <Badge tone={transaction.source === 'notion' ? 'info' : 'neutral'}>
                        {transaction.source}
                      </Badge>
                    </td>
                    <td className="max-w-64 truncate py-2 text-zinc-500">
                      {transaction.notes ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
