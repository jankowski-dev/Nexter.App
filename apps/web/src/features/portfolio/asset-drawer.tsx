import { Drawer } from '@/components/ui/drawer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { fetchPortfolioAsset } from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import {
  formatDate,
  formatDateTime,
  formatSignedUsd,
  formatTokenAmount,
  formatUsd,
  pnlTone,
} from '@/lib/format';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

const statusLabels: Record<string, string> = {
  open: 'Открыта',
  partial: 'Частично',
  closed: 'Закрыта',
  reserve: 'Резерв',
  for_sale: 'В продажу',
};

function Metric({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: string;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 p-3">
      <div className="text-xs text-zinc-500">{label}</div>
      <div
        className={`mt-1 font-mono text-lg font-semibold tabular-nums ${tone ?? 'text-zinc-900'}`}
      >
        {value}
      </div>
      {hint ? <div className="mt-1 text-xs text-zinc-500">{hint}</div> : null}
    </div>
  );
}

export function AssetDrawer({ assetId, onClose }: { assetId: string | null; onClose: () => void }) {
  const detail = useQuery({
    queryKey: ['portfolio-asset', assetId],
    queryFn: () => fetchPortfolioAsset(assetId as string),
    enabled: Boolean(assetId),
  });

  const data = detail.data;
  const position = data?.position;

  return (
    <Drawer
      open={Boolean(assetId)}
      onClose={onClose}
      title={data ? `${data.asset.symbol} · ${data.asset.name}` : 'Актив'}
      description={
        data
          ? `${data.asset.chainCode} · ${data.asset.isVerified ? 'проверенный актив' : 'непроверенный актив'}`
          : undefined
      }
      footer={
        data ? (
          <Button variant="secondary" asChild>
            <Link
              to="/portfolio/assets/$assetId"
              params={{ assetId: data.asset.id }}
              onClick={onClose}
            >
              Открыть полную карточку
            </Link>
          </Button>
        ) : null
      }
    >
      {detail.isPending ? <LoadingRows rows={6} /> : null}
      {detail.isError ? (
        <ErrorState
          message={toRussianError(detail.error, 'Не удалось загрузить актив')}
          onRetry={() => void detail.refetch()}
        />
      ) : null}

      {data ? (
        <div className="space-y-5">
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

          <div className="grid gap-3 sm:grid-cols-2">
            <Metric
              label="Количество"
              value={position ? formatTokenAmount(position.amount) : '—'}
              hint={data.asset.symbol}
            />
            <Metric
              label="Цена"
              value={formatUsd(position?.priceUsd ?? null)}
              hint="Последняя цена"
            />
            <Metric
              label="Стоимость"
              value={formatUsd(position?.valueUsd ?? null)}
              hint="По текущей цене"
            />
            <Metric
              label="Нереализованный P&L"
              value={formatSignedUsd(position?.unrealizedPnlUsd ?? null)}
              hint={`Себестоимость ${formatUsd(position?.costBasisUsd ?? null)}`}
              tone={pnlTone(position?.unrealizedPnlUsd)}
            />
          </div>

          <Card>
            <CardTitle>Лоты</CardTitle>
            <CardDescription>Оставшиеся лоты и себестоимость.</CardDescription>
            {data.lots.length === 0 ? (
              <p className="mt-3 text-sm text-zinc-600">Лотов нет.</p>
            ) : (
              <div className="mt-3 space-y-2">
                {data.lots.slice(0, 8).map((lot) => (
                  <div
                    key={lot.id}
                    className="flex items-center justify-between gap-3 border-b border-zinc-100 pb-2 text-sm last:border-0 last:pb-0"
                  >
                    <div>
                      <div className="text-zinc-700">{formatDate(lot.acquiredAt)}</div>
                      <div className="text-xs text-zinc-500">
                        {formatTokenAmount(lot.remainingAmount)} из {formatTokenAmount(lot.amount)}
                      </div>
                    </div>
                    <div className="text-right font-mono tabular-nums text-zinc-600">
                      {formatUsd(lot.remainingCostBasisUsd)}
                    </div>
                  </div>
                ))}
                {data.lots.length > 8 ? (
                  <div className="text-xs text-zinc-500">И ещё {data.lots.length - 8} лотов.</div>
                ) : null}
              </div>
            )}
          </Card>

          <Card>
            <CardTitle>Сделки</CardTitle>
            <CardDescription>{data.tradeGroups.length} торговых групп по активу.</CardDescription>
            {data.tradeGroups.length === 0 ? (
              <p className="mt-3 text-sm text-zinc-600">Сделок нет.</p>
            ) : (
              <div className="mt-3 space-y-2">
                {data.tradeGroups.slice(0, 8).map((group) => (
                  <Link
                    key={group.id}
                    to="/trades/$tradeId"
                    params={{ tradeId: group.id }}
                    className="flex items-center justify-between gap-3 border-b border-zinc-100 pb-2 text-sm last:border-0 last:pb-0 hover:text-emerald-800"
                  >
                    <div>
                      <div className="text-zinc-700">{formatDate(group.openedAt)}</div>
                      <div className="text-xs text-zinc-500">
                        {statusLabels[group.status] ?? group.status}
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
                {data.tradeGroups.length > 8 ? (
                  <div className="text-xs text-zinc-500">
                    И ещё {data.tradeGroups.length - 8} сделок.
                  </div>
                ) : null}
              </div>
            )}
          </Card>

          <Card>
            <CardTitle>Транзакции</CardTitle>
            <CardDescription>Последние операции по активу.</CardDescription>
            {data.transactions.length === 0 ? (
              <p className="mt-3 text-sm text-zinc-600">Транзакций нет.</p>
            ) : (
              <div className="mt-3 space-y-2">
                {data.transactions.slice(0, 8).map((transaction) => (
                  <div
                    key={transaction.id}
                    className="flex items-center justify-between gap-3 border-b border-zinc-100 pb-2 text-sm last:border-0 last:pb-0"
                  >
                    <div>
                      <div className="text-zinc-700">
                        {transaction.type} / {transaction.subtype}
                      </div>
                      <div className="text-xs text-zinc-500">
                        {formatDateTime(transaction.occurredAt)}
                      </div>
                    </div>
                    <Badge tone={transaction.source === 'notion' ? 'info' : 'neutral'}>
                      {transaction.source}
                    </Badge>
                  </div>
                ))}
                {data.transactions.length > 8 ? (
                  <div className="text-xs text-zinc-500">
                    И ещё {data.transactions.length - 8} операций.
                  </div>
                ) : null}
              </div>
            )}
          </Card>
        </div>
      ) : null}
    </Drawer>
  );
}
