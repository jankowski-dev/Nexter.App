import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Drawer } from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { TokenIcon } from '@/components/token-icon';
import { fetchPendingOrders, updatePendingOrder } from '@/lib/api';
import { useConfirm } from '@/lib/confirm';
import { toRussianError } from '@/lib/error-messages';
import { formatDateTime, formatPrice, formatUsd } from '@/lib/format';
import type { PendingOrder } from '@nexter/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

export function PendingOrdersPanel() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const query = useQuery({
    queryKey: ['pending-orders'],
    queryFn: fetchPendingOrders,
    refetchInterval: 30_000,
  });
  const [editing, setEditing] = useState<PendingOrder | null>(null);
  const [amountUsd, setAmountUsd] = useState('');
  const [triggerPriceUsd, setTriggerPriceUsd] = useState('');
  const [stopLossPct, setStopLossPct] = useState('');
  const [takeProfitPct, setTakeProfitPct] = useState('');
  const [error, setError] = useState<string | null>(null);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['pending-orders'] });
  };

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Parameters<typeof updatePendingOrder>[1] }) =>
      updatePendingOrder(id, body),
    onSuccess: () => {
      invalidate();
      setEditing(null);
      setError(null);
    },
    onError: (err) => setError(toRussianError(err, 'Не удалось обновить отложенную покупку')),
  });

  function openEdit(order: PendingOrder): void {
    setEditing(order);
    setAmountUsd(order.amountUsd);
    setTriggerPriceUsd(order.triggerPriceUsd);
    setStopLossPct(order.stopLossPct ?? '');
    setTakeProfitPct(order.takeProfitPct ?? '');
    setError(null);
  }

  const active = (query.data?.data ?? []).filter(
    (order) => order.status === 'pending' || order.status === 'proposed',
  );

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle>Отложенные покупки</CardTitle>
          <CardDescription>
            Заявка срабатывает по цене и присылает уведомление. Покупку подтверждаете вы.
          </CardDescription>
        </div>
        <Badge tone={active.length > 0 ? 'info' : 'neutral'}>
          {active.length} {active.length === 1 ? 'заявка' : 'заявок'}
        </Badge>
      </div>

      {query.isPending ? (
        <div className="mt-4">
          <LoadingRows rows={2} />
        </div>
      ) : null}
      {query.isError ? (
        <div className="mt-4">
          <ErrorState
            message={toRussianError(query.error, 'Не удалось загрузить отложенные покупки')}
            onRetry={() => void query.refetch()}
          />
        </div>
      ) : null}

      {!query.isPending && !query.isError ? (
        <div className="mt-4 space-y-2">
          {active.length === 0 ? (
            <p className="text-sm text-zinc-500">
              Отложенных покупок нет. Их можно создать в окне покупки токена.
            </p>
          ) : (
            active.map((order) => (
              <div
                key={order.id}
                className={`rounded-xl border border-zinc-200 px-3 py-2 ${
                  order.status === 'proposed' ? 'border-emerald-300 bg-emerald-50/40' : ''
                }`}
              >
                <div className="flex flex-wrap items-center gap-3">
                  <TokenIcon
                    logoUrl={order.asset.logoUrl}
                    symbol={order.asset.symbol}
                    className="h-8 w-8 text-[9px]"
                  />
                  <div className="min-w-[180px] flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-zinc-900">
                        {order.asset.symbol}
                      </span>
                      <Badge tone={order.status === 'proposed' ? 'success' : 'info'}>
                        {order.status === 'proposed' ? 'сработала' : 'ожидает'}
                      </Badge>
                    </div>
                    <div className="text-[11px] text-zinc-500">
                      Купить на {formatUsd(order.amountUsd)} при цене ≤{' '}
                      {formatPrice(order.triggerPriceUsd)}
                    </div>
                    <div className="text-[11px] text-zinc-500">
                      Стоп-лосс: {order.stopLossPct ? `${order.stopLossPct}%` : '—'} · Тейк-профит:{' '}
                      {order.takeProfitPct ? `${order.takeProfitPct}%` : '—'}
                    </div>
                  </div>
                  <div className="text-right text-[11px] text-zinc-500">
                    {formatDateTime(order.createdAt)}
                  </div>
                  <div className="flex gap-1.5">
                    <Button
                      variant="secondary"
                      className="h-8 px-2.5 text-xs"
                      onClick={() => openEdit(order)}
                    >
                      Изменить
                    </Button>
                    <Button
                      variant="ghost"
                      className="h-8 px-2.5 text-xs text-red-700 hover:text-red-800"
                      onClick={async () => {
                        if (
                          await confirm({
                            title: 'Отменить отложенную покупку?',
                            description: `${order.asset.symbol}: заявка больше не будет срабатывать.`,
                            confirmLabel: 'Отменить',
                            variant: 'danger',
                          })
                        ) {
                          update.mutate({ id: order.id, body: { status: 'cancelled' } });
                        }
                      }}
                    >
                      Отменить
                    </Button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      ) : null}

      <Drawer
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing ? `Отложенная покупка · ${editing.asset.symbol}` : 'Отложенная покупка'}
        description="Сумма, цена срабатывания и защита этой заявки."
        size="third"
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-red-700">{error}</span>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setEditing(null)}>
                Отмена
              </Button>
              <Button
                disabled={update.isPending}
                onClick={() => {
                  if (!editing) return;
                  update.mutate({
                    id: editing.id,
                    body: {
                      amountUsd,
                      triggerPriceUsd,
                      stopLossPct: stopLossPct.trim() ? Number(stopLossPct) : null,
                      takeProfitPct: takeProfitPct.trim() ? Number(takeProfitPct) : null,
                    },
                  });
                }}
              >
                Сохранить
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          <label className="block text-sm text-zinc-600">
            Сумма, USD
            <Input
              className="mt-1"
              inputMode="decimal"
              value={amountUsd}
              onChange={(event) => setAmountUsd(event.target.value)}
            />
          </label>
          <label className="block text-sm text-zinc-600">
            Купить при цене ≤, USD
            <Input
              className="mt-1"
              inputMode="decimal"
              value={triggerPriceUsd}
              onChange={(event) => setTriggerPriceUsd(event.target.value)}
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-sm text-zinc-600">
              Стоп-лосс, %
              <Input
                className="mt-1"
                type="number"
                value={stopLossPct}
                onChange={(event) => setStopLossPct(event.target.value)}
              />
            </label>
            <label className="text-sm text-zinc-600">
              Тейк-профит, %
              <Input
                className="mt-1"
                type="number"
                value={takeProfitPct}
                onChange={(event) => setTakeProfitPct(event.target.value)}
              />
            </label>
          </div>
        </div>
      </Drawer>
    </Card>
  );
}
