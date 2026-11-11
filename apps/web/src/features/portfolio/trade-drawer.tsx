import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Drawer } from '@/components/ui/drawer';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { fetchAssets, fetchTradeGroup } from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import {
  formatDate,
  formatPrice,
  formatSignedUsd,
  formatTokenAmount,
  formatUsd,
  pnlTone,
} from '@/lib/format';
import type { TradeGroupSummary } from '@nexter/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Decimal } from 'decimal.js';

const subtypeLabels: Record<string, string> = {
  buy: 'Покупка',
  sell: 'Продажа',
  swap: 'Обмен',
  transfer: 'Перевод',
  deposit: 'Пополнение',
  withdrawal: 'Вывод',
  fee: 'Сбор',
  income: 'Доход',
  adjustment: 'Корректировка',
};

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

export function TradeDrawer({
  tradeId,
  onClose,
  onCloseTrade,
}: {
  tradeId: string | null;
  onClose: () => void;
  onCloseTrade?: (group: TradeGroupSummary) => void;
}) {
  const detail = useQuery({
    queryKey: ['trade-group', tradeId],
    queryFn: () => fetchTradeGroup(tradeId as string),
    enabled: Boolean(tradeId),
  });
  const assets = useQuery({ queryKey: ['assets'], queryFn: fetchAssets });
  const data = detail.data;
  const group = data?.group;
  const canClose = Boolean(group && group.status !== 'closed' && Number(group.remainingAmount) > 0);
  const totalBought = (data?.lots ?? []).reduce(
    (total, lot) => total.plus(lot.amount),
    new Decimal(0),
  );
  const averagePrice =
    group && totalBought.gt(0) ? new Decimal(group.buyUsd).div(totalBought) : null;
  const assetById = new Map((assets.data?.assets ?? []).map((asset) => [asset.id, asset]));
  const currentValue =
    group && group.unrealizedPnlUsd !== null
      ? new Decimal(group.remainingCostBasisUsd).plus(group.unrealizedPnlUsd)
      : null;

  return (
    <Drawer
      open={Boolean(tradeId)}
      onClose={onClose}
      title={group ? `${group.asset.symbol} · сделка` : 'Сделка'}
      description={
        group
          ? `${group.asset.chainCode} · ${statusLabels[group.status] ?? group.status}`
          : undefined
      }
      wide
      footer={
        group ? (
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" asChild>
              <Link to="/trades/$tradeId" params={{ tradeId: group.id }} onClick={onClose}>
                Полная карточка
              </Link>
            </Button>
            {canClose && onCloseTrade ? (
              <Button
                onClick={() => {
                  onClose();
                  onCloseTrade(group);
                }}
              >
                Выйти из сделки
              </Button>
            ) : null}
          </div>
        ) : null
      }
    >
      {detail.isPending ? <LoadingRows rows={6} /> : null}
      {detail.isError ? (
        <ErrorState
          message={toRussianError(detail.error, 'Не удалось загрузить сделку')}
          onRetry={() => void detail.refetch()}
        />
      ) : null}

      {group ? (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Metric label="Вложено" value={formatUsd(group.buyUsd)} hint="Стоимость покупки" />
            <Metric
              label="Куплено токенов"
              value={formatTokenAmount(totalBought.toFixed())}
              hint={group.asset.symbol}
            />
            <Metric
              label="Остаток"
              value={formatTokenAmount(group.remainingAmount)}
              hint={`Средняя цена ${formatPrice(averagePrice?.toFixed(12) ?? null)}`}
            />
            <Metric
              label="Текущая стоимость"
              value={formatUsd(currentValue?.toFixed(8) ?? null)}
              hint="Остаток по текущей цене"
            />
            <Metric
              label="Текущая прибыль"
              value={formatSignedUsd(group.totalPnlUsd)}
              tone={pnlTone(group.totalPnlUsd)}
              hint={`Реализовано ${formatSignedUsd(group.realizedPnlUsd)}`}
            />
            <Metric label="Газ" value={formatUsd(group.gasUsd)} hint="Только confirmed swaps" />
          </div>

          <Card>
            <CardTitle>Параметры</CardTitle>
            <CardDescription>
              Открыта {formatDate(group.openedAt)}
              {group.closedAt ? ` · закрыта ${formatDate(group.closedAt)}` : ''} ·{' '}
              {group.holdingDays} дней
            </CardDescription>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge tone="info">{statusLabels[group.status] ?? group.status}</Badge>
              <Badge tone={group.returnPct && Number(group.returnPct) >= 0 ? 'success' : 'danger'}>
                Доходность {group.returnPct ? `${group.returnPct}%` : '—'}
              </Badge>
              {group.notes ? <Badge tone="neutral">Есть заметка</Badge> : null}
            </div>
            {group.notes ? <p className="mt-3 text-sm text-zinc-600">{group.notes}</p> : null}
          </Card>

          <Card>
            <CardTitle>Лоты</CardTitle>
            <CardDescription>Оставшиеся лоты и себестоимость.</CardDescription>
            {data.lots.length === 0 ? (
              <p className="mt-3 text-sm text-zinc-600">Лотов нет.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
                      <th className="py-2 pr-3 font-medium">Дата</th>
                      <th className="py-2 pr-3 text-right font-medium">Количество</th>
                      <th className="py-2 pr-3 text-right font-medium">Остаток</th>
                      <th className="py-2 text-right font-medium">Себестоимость</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.lots.map((lot) => (
                      <tr key={lot.id} className="border-b border-zinc-100 last:border-0">
                        <td className="py-2 pr-3 text-zinc-600">{formatDate(lot.acquiredAt)}</td>
                        <td className="py-2 pr-3 text-right font-mono tabular-nums text-zinc-700">
                          {formatTokenAmount(lot.amount)}
                        </td>
                        <td className="py-2 pr-3 text-right font-mono tabular-nums text-zinc-700">
                          {formatTokenAmount(lot.remainingAmount)}
                        </td>
                        <td className="py-2 text-right font-mono tabular-nums text-zinc-600">
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
            <CardTitle>Движения</CardTitle>
            <CardDescription>Ноги сделки и списания.</CardDescription>
            {data.legs.length === 0 ? (
              <p className="mt-3 text-sm text-zinc-600">Движений нет.</p>
            ) : (
              <div className="mt-3 space-y-2">
                {data.legs.slice(0, 10).map((leg) => (
                  <div
                    key={leg.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-100 px-3 py-2 text-sm"
                  >
                    <span className="text-zinc-700">
                      {subtypeLabels[leg.subtype] ?? leg.subtype} · {formatDate(leg.occurredAt)}
                    </span>
                    <span className="font-mono tabular-nums text-zinc-600">
                      {leg.postings
                        .filter((posting) => Number(posting.amount) !== 0)
                        .slice(0, 2)
                        .map(
                          (posting) =>
                            `${formatTokenAmount(posting.amount)} ${
                              assetById.get(posting.assetId)?.symbol ?? 'актив'
                            }`,
                        )
                        .join(' · ')}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      ) : null}
    </Drawer>
  );
}
