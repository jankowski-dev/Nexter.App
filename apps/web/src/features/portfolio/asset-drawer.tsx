import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Drawer } from '@/components/ui/drawer';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { TokenIcon } from '@/components/token-icon';
import { fetchPortfolioAsset } from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import {
  formatDate,
  formatPrice,
  formatSignedUsd,
  formatTokenAmount,
  formatUsd,
  pnlTone,
} from '@/lib/format';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { Asset } from '@nexter/contracts';
import { TokenPriceChart } from '../watchlist/token-price-chart';

const statusLabels: Record<string, string> = {
  open: 'Открыта',
  partial: 'Частично',
  closed: 'Закрыта',
  reserve: 'Резерв',
  for_sale: 'В продажу',
};

const statusTones: Record<string, 'success' | 'warning' | 'neutral' | 'info'> = {
  open: 'success',
  partial: 'warning',
  closed: 'neutral',
  reserve: 'info',
  for_sale: 'warning',
};

type MetricSurface = 'emerald' | 'sky' | 'amber' | 'violet' | 'rose';

function Metric({
  label,
  value,
  hint,
  tone,
  surface,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: string;
  surface: MetricSurface;
}) {
  return (
    <div className={`tone-surface tone-surface-${surface} rounded-xl border p-3`}>
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

export function AssetDrawer({
  assetId,
  onClose,
  onBuy,
  logoFallback,
}: {
  assetId: string | null;
  onClose: () => void;
  onBuy?: (asset: Asset) => void;
  logoFallback?: string | null;
}) {
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
      titleIcon={
        data ? (
          <TokenIcon
            logoUrl={data.asset.logoUrl ?? logoFallback ?? null}
            symbol={data.asset.symbol}
          />
        ) : undefined
      }
      description={
        data
          ? `${data.asset.chainCode} · ${data.asset.isVerified ? 'проверенный актив' : 'непроверенный актив'}`
          : undefined
      }
      footer={
        data ? (
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            {onBuy ? (
              <Button variant="secondary" onClick={() => onBuy(data.asset)}>
                Купить
              </Button>
            ) : (
              <span />
            )}
            <Button variant="secondary" onClick={onClose}>
              Готово
            </Button>
          </div>
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
          <Card>
            <div className="mt-1">
              <TokenPriceChart entryId={data.watchlistId} assetId={data.asset.id} />
            </div>
          </Card>

          {data.thesis || data.tags.length > 0 ? (
            <Card>
              <CardTitle>Описание</CardTitle>
              <CardDescription>{data.thesis ?? 'Описание не заполнено.'}</CardDescription>
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
              surface="emerald"
              label="Количество"
              value={position ? formatTokenAmount(position.amount) : '—'}
              hint={data.asset.symbol}
            />
            <Metric
              surface="sky"
              label="Цена"
              value={formatPrice(position?.priceUsd ?? data.quote?.priceUsd ?? null)}
              hint="Последняя цена"
            />
            <Metric
              surface="amber"
              label="Стоимость"
              value={formatUsd(position?.valueUsd ?? null)}
              hint="По текущей цене"
            />
            <Metric
              surface="violet"
              label="Нереализованный P&L"
              value={formatSignedUsd(position?.unrealizedPnlUsd ?? null)}
              hint={`Себестоимость ${formatUsd(position?.costBasisUsd ?? null)}`}
              tone={pnlTone(position?.unrealizedPnlUsd)}
            />
          </div>

          <Card>
            <CardTitle>Ордера</CardTitle>
            <CardDescription>{data.tradeGroups.length} ордеров по активу.</CardDescription>
            {data.tradeGroups.length === 0 ? (
              <p className="mt-3 text-sm text-zinc-600">Ордеров нет.</p>
            ) : (
              <div className="mt-3 space-y-2">
                {data.tradeGroups.map((group, index) => (
                  <Link
                    key={group.id}
                    to="/trades/$tradeId"
                    params={{ tradeId: group.id }}
                    className="block rounded-xl border border-zinc-200 p-3 text-sm transition-colors hover:border-emerald-300 hover:bg-zinc-50/60"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <TokenIcon
                          logoUrl={data.asset.logoUrl ?? logoFallback ?? null}
                          symbol={data.asset.symbol}
                          className="h-9 w-9 text-[10px]"
                        />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-zinc-900">Ордер #{index + 1}</span>
                            <Badge tone={statusTones[group.status] ?? 'neutral'}>
                              {statusLabels[group.status] ?? group.status}
                            </Badge>
                            <span className="text-[11px] text-zinc-500">{group.source}</span>
                          </div>
                          <div className="mt-0.5 text-xs text-zinc-500">
                            Открыт {formatDate(group.openedAt)} · {group.holdingDays} дн.
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div
                          className={`font-mono text-lg font-semibold ${pnlTone(group.totalPnlUsd)}`}
                        >
                          {formatSignedUsd(group.totalPnlUsd)}
                        </div>
                        <div className="text-xs text-zinc-500">
                          {group.returnPct ? `${group.returnPct}%` : '—'}
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 rounded-lg border border-zinc-100 bg-zinc-50/60 p-2 text-[11px] sm:grid-cols-4">
                      <div>
                        <div className="text-zinc-500">Вложено</div>
                        <div className="font-mono text-zinc-800">
                          {formatUsd(group.remainingCostBasisUsd)}
                        </div>
                      </div>
                      <div>
                        <div className="text-zinc-500">Остаток</div>
                        <div className="font-mono text-zinc-800">
                          {formatTokenAmount(group.remainingAmount, 8)}
                        </div>
                      </div>
                      <div>
                        <div className="text-zinc-500">Куплено</div>
                        <div className="font-mono text-zinc-800">{formatUsd(group.buyUsd)}</div>
                      </div>
                      <div>
                        <div className="text-zinc-500">Продано</div>
                        <div className="font-mono text-zinc-800">{formatUsd(group.sellUsd)}</div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </Card>
        </div>
      ) : null}
    </Drawer>
  );
}
