import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { fetchPortfolioAsset } from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import {
  formatDate,
  formatDateTime,
  formatSignedUsd,
  formatTokenAmount,
  formatPrice,
  formatUsd,
  pnlTone,
} from '@/lib/format';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';

const statusLabels: Record<string, string> = {
  open: 'Открыта',
  partial: 'Частично',
  closed: 'Закрыта',
  reserve: 'Резерв',
  for_sale: 'В продажу',
};

export function AssetDetailPage() {
  const { assetId } = useParams({ strict: false }) as { assetId: string };
  const detail = useQuery({
    queryKey: ['portfolio-asset', assetId],
    queryFn: () => fetchPortfolioAsset(assetId),
    enabled: Boolean(assetId),
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
          <div className="mt-1 font-mono text-2xl font-semibold text-zinc-900">
            {position ? formatTokenAmount(position.amount) : '—'}
          </div>
          <CardDescription>{data.asset.symbol}</CardDescription>
        </Card>
        <Card>
          <CardTitle>Цена</CardTitle>
          <div className="mt-1 font-mono text-2xl font-semibold text-zinc-900">
            {formatPrice(position?.priceUsd ?? data.quote?.priceUsd ?? null)}
          </div>
          <CardDescription>Последняя цена</CardDescription>
        </Card>
        <Card>
          <CardTitle>Стоимость</CardTitle>
          <div className="mt-1 font-mono text-2xl font-semibold text-zinc-900">
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
        <CardTitle>Сделки</CardTitle>
        <CardDescription>{data.tradeGroups.length} торговых групп по активу.</CardDescription>
        {data.tradeGroups.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-600">Сделок нет.</p>
        ) : (
          <div className="mt-4 max-h-96 overflow-y-auto">
            {data.tradeGroups.map((group) => (
              <Link
                key={group.id}
                to="/trades/$tradeId"
                params={{ tradeId: group.id }}
                className="flex items-center justify-between gap-3 border-b border-zinc-100 py-2 text-sm last:border-0 hover:text-emerald-800"
              >
                <div>
                  <div className="text-zinc-800">{formatDate(group.openedAt)}</div>
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

      <Card>
        <CardTitle>Транзакции</CardTitle>
        <CardDescription>Последние операции по активу.</CardDescription>
        {data.transactions.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-600">Транзакций нет.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
                  <th className="py-2 pr-3 font-medium">Дата</th>
                  <th className="py-2 pr-3 font-medium">Тип</th>
                  <th className="py-2 pr-3 font-medium">Источник</th>
                  <th className="py-2 font-medium">Заметки</th>
                </tr>
              </thead>
              <tbody>
                {data.transactions.map((transaction) => (
                  <tr
                    key={transaction.id}
                    className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50"
                  >
                    <td className="py-2 pr-3 text-zinc-600">
                      {formatDateTime(transaction.occurredAt)}
                    </td>
                    <td className="py-2 pr-3 text-zinc-700">
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
