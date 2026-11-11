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
  fetchAccounts,
  fetchAssets,
  fetchTradeGroup,
  sellTradeGroup,
  updateTradeGroupNotes,
} from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import { idempotencyForPayload } from '@/lib/idempotency';
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
import { useEffect, useRef, useState } from 'react';

const statusLabels: Record<string, string> = {
  open: 'Открыта',
  partial: 'Частично',
  closed: 'Закрыта',
  reserve: 'Резерв',
  for_sale: 'В продажу',
};

function isPositiveDecimal(value: string): boolean {
  return /^\d+(?:\.\d+)?$/.test(value) && Number(value) > 0;
}

export function TradeDetailPage() {
  const { tradeId } = useParams({ strict: false }) as { tradeId: string };
  const queryClient = useQueryClient();
  const [sellOpen, setSellOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [accountId, setAccountId] = useState('');
  const [proceedsAssetId, setProceedsAssetId] = useState('');
  const [amount, setAmount] = useState('');
  const [proceedsAmount, setProceedsAmount] = useState('');
  const [sellNotes, setSellNotes] = useState('');
  const [sellError, setSellError] = useState<string | null>(null);
  const sellIdempotencyKey = useRef<string>(crypto.randomUUID());
  const sellPayloadSignature = useRef<string | null>(null);
  const [notesError, setNotesError] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: ['trade-group', tradeId],
    queryFn: () => fetchTradeGroup(tradeId),
    enabled: Boolean(tradeId),
  });
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: fetchAccounts });
  const assets = useQuery({ queryKey: ['assets'], queryFn: fetchAssets });

  useEffect(() => {
    if (!detail.data) return;
    setNotes(detail.data.group.notes ?? '');
    const chainCode = detail.data.group.asset.chainCode;
    const wallet = accounts.data?.accounts.find(
      (account) => account.type === 'wallet' && account.chainCode === chainCode,
    );
    const cashAssets = (assets.data?.assets ?? []).filter(
      (asset) => asset.isCashEquivalent && asset.chainCode === chainCode,
    );
    const proceeds =
      cashAssets.find((asset) => asset.symbol === 'USDT') ??
      cashAssets.find((asset) => asset.symbol === 'USDC') ??
      cashAssets[0];
    if (wallet) {
      setAccountId((current) =>
        accounts.data?.accounts.some(
          (account) =>
            account.id === current && account.type === 'wallet' && account.chainCode === chainCode,
        )
          ? current
          : wallet.id,
      );
    } else {
      setAccountId('');
    }
    if (proceeds) {
      setProceedsAssetId((current) =>
        cashAssets.some((asset) => asset.id === current) ? current : proceeds.id,
      );
    } else {
      setProceedsAssetId('');
    }
  }, [detail.data, accounts.data, assets.data]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['trade-group', tradeId] });
    void queryClient.invalidateQueries({ queryKey: ['trade-groups'] });
    void queryClient.invalidateQueries({ queryKey: ['positions'] });
    void queryClient.invalidateQueries({ queryKey: ['transactions'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard-allocation'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard-active-positions'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard-recent-trades'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard-pnl'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard-equity-curve'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard-data-quality'] });
  };

  const sellMutation = useMutation({
    mutationFn: () => {
      const payload = {
        accountId,
        amount,
        proceedsAssetId,
        proceedsAmount,
        notes: sellNotes || undefined,
      };
      const signature = JSON.stringify(payload);
      const next = idempotencyForPayload(
        sellIdempotencyKey.current,
        sellPayloadSignature.current,
        signature,
      );
      sellIdempotencyKey.current = next.key;
      sellPayloadSignature.current = next.signature;

      return sellTradeGroup(tradeId, payload, next.key);
    },
    onSuccess: () => {
      setSellOpen(false);
      setAmount('');
      setProceedsAmount('');
      setSellNotes('');
      setSellError(null);
      sellIdempotencyKey.current = crypto.randomUUID();
      sellPayloadSignature.current = null;
      invalidate();
    },
    onError: (error) => {
      setSellError(toRussianError(error, 'Не удалось добавить продажу'));
    },
  });

  const notesMutation = useMutation({
    mutationFn: () => updateTradeGroupNotes(tradeId, notes || null),
    onSuccess: () => {
      setNotesOpen(false);
      setNotesError(null);
      invalidate();
    },
    onError: (error) => {
      setNotesError(toRussianError(error, 'Не удалось сохранить заметку'));
    },
  });

  if (detail.isPending) {
    return (
      <div className="space-y-6">
        <PageHeader title="Сделка" />
        <LoadingRows rows={8} />
      </div>
    );
  }

  if (detail.isError || !detail.data) {
    return (
      <div className="space-y-6">
        <PageHeader title="Сделка" />
        <ErrorState
          message={toRussianError(detail.error, 'Не удалось загрузить сделку')}
          onRetry={() => void detail.refetch()}
        />
      </div>
    );
  }

  const { group, legs, lots, consumptions, audit } = detail.data;
  const chainWallets =
    accounts.data?.accounts.filter(
      (account) => account.type === 'wallet' && account.chainCode === group.asset.chainCode,
    ) ?? [];
  const proceedsAssets =
    assets.data?.assets.filter(
      (asset) => asset.isCashEquivalent && asset.chainCode === group.asset.chainCode,
    ) ?? [];
  const assetById = new Map(assets.data?.assets.map((asset) => [asset.id, asset.symbol]) ?? []);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${group.asset.symbol} · сделка`}
        subtitle={`${statusLabels[group.status] ?? group.status} · открыта ${formatDate(group.openedAt)}`}
        actions={
          <>
            <Button variant="secondary" asChild>
              <Link to="/portfolio" hash="trades">
                Назад
              </Link>
            </Button>
            <Button
              onClick={() => {
                sellIdempotencyKey.current = crypto.randomUUID();
                sellPayloadSignature.current = null;
                setSellOpen(true);
              }}
              disabled={group.status === 'closed'}
            >
              Добавить продажу
            </Button>
            <Button variant="secondary" onClick={() => setNotesOpen(true)}>
              Заметка
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardTitle>Покупка</CardTitle>
          <div className="mt-1 font-mono text-2xl font-semibold text-zinc-900">
            {formatUsd(group.buyUsd)}
          </div>
          <CardDescription>{group.source}</CardDescription>
        </Card>
        <Card>
          <CardTitle>Продажи</CardTitle>
          <div className="mt-1 font-mono text-2xl font-semibold text-zinc-900">
            {formatUsd(group.sellUsd)}
          </div>
          <CardDescription>{consumptions.length} списаний</CardDescription>
        </Card>
        <Card>
          <CardTitle>P&L</CardTitle>
          <div className={`mt-1 font-mono text-2xl font-semibold ${pnlTone(group.totalPnlUsd)}`}>
            {formatSignedUsd(group.totalPnlUsd)}
          </div>
          <CardDescription>
            Реализованный {formatSignedUsd(group.realizedPnlUsd)} · нереализованный{' '}
            {formatSignedUsd(group.unrealizedPnlUsd)}
          </CardDescription>
        </Card>
        <Card>
          <CardTitle>Доходность / срок</CardTitle>
          <div className={`mt-1 font-mono text-2xl font-semibold ${pnlTone(group.returnPct)}`}>
            {group.returnPct ? `${group.returnPct}%` : '—'}
          </div>
          <CardDescription>{group.holdingDays} дн.</CardDescription>
        </Card>
      </div>

      <Card>
        <CardTitle>Заметка</CardTitle>
        <CardDescription>{group.notes ?? 'Заметки нет.'}</CardDescription>
      </Card>

      <Card>
        <CardTitle>Ноги сделки</CardTitle>
        <CardDescription>Проводки покупки и продаж.</CardDescription>
        <div className="mt-4 space-y-4">
          {legs.map((leg) => (
            <div key={leg.id} className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <div className="flex items-center gap-2">
                  <Badge tone={leg.subtype === 'buy' ? 'info' : 'warning'}>{leg.subtype}</Badge>
                  <span className="text-zinc-700">{formatDateTime(leg.occurredAt)}</span>
                  <Badge tone={leg.source === 'notion' ? 'info' : 'neutral'}>{leg.source}</Badge>
                </div>
                <span className="font-mono text-xs text-zinc-500">
                  fees {formatUsd(leg.feesUsd)}
                </span>
              </div>
              <div className="mt-2 grid gap-1 text-xs text-zinc-600 md:grid-cols-2">
                {leg.postings.map((posting) => (
                  <div key={posting.id} className="flex justify-between gap-2 font-mono">
                    <span>{assetById.get(posting.assetId) ?? posting.assetId.slice(0, 8)}</span>
                    <span className="tabular-nums">{formatTokenAmount(posting.amount)}</span>
                    <span className="tabular-nums">{formatUsd(posting.usdValue)}</span>
                  </div>
                ))}
              </div>
              {leg.notes ? <p className="mt-2 text-xs text-zinc-500">{leg.notes}</p> : null}
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardTitle>Лоты</CardTitle>
          <CardDescription>Себестоимость и остаток.</CardDescription>
          <div className="mt-4 overflow-x-auto">
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
                {lots.map((lot) => (
                  <tr
                    key={lot.id}
                    className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50"
                  >
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
        </Card>

        <Card>
          <CardTitle>Списания</CardTitle>
          <CardDescription>Реализованный P&L по лотам.</CardDescription>
          {consumptions.length === 0 ? (
            <p className="mt-4 text-sm text-zinc-600">Списаний нет.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
                    <th className="py-2 pr-3 font-medium">Дата</th>
                    <th className="py-2 pr-3 text-right font-medium">Количество</th>
                    <th className="py-2 pr-3 text-right font-medium">Выручка</th>
                    <th className="py-2 text-right font-medium">P&L</th>
                  </tr>
                </thead>
                <tbody>
                  {consumptions.map((consumption) => (
                    <tr
                      key={consumption.id}
                      className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50"
                    >
                      <td className="py-2 pr-3 text-zinc-600">
                        {formatDateTime(consumption.disposalOccurredAt)}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums text-zinc-700">
                        {formatTokenAmount(consumption.amount)}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums text-zinc-700">
                        {formatUsd(consumption.proceedsUsd)}
                      </td>
                      <td
                        className={`py-2 text-right font-mono tabular-nums ${pnlTone(consumption.realizedPnlUsd)}`}
                      >
                        {formatSignedUsd(consumption.realizedPnlUsd)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <Card>
        <CardTitle>Аудит</CardTitle>
        <CardDescription>Связанные записи журнала аудита.</CardDescription>
        {audit.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-600">Записей аудита нет.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
                  <th className="py-2 pr-3 font-medium">Дата</th>
                  <th className="py-2 pr-3 font-medium">Действие</th>
                  <th className="py-2 font-medium">Объект</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((entry) => (
                  <tr
                    key={entry.id}
                    className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50"
                  >
                    <td className="py-2 pr-3 text-zinc-600">{formatDateTime(entry.createdAt)}</td>
                    <td className="py-2 pr-3 font-mono text-xs text-zinc-700">{entry.action}</td>
                    <td className="py-2 text-zinc-500">
                      {entry.entityType} · {entry.entityId?.slice(0, 8) ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Dialog
        open={sellOpen}
        onClose={() => setSellOpen(false)}
        title="Добавить продажу"
        description={`${group.asset.symbol}: продажа из этой торговой группы.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setSellOpen(false)}>
              Отмена
            </Button>
            <Button
              onClick={() => sellMutation.mutate()}
              disabled={
                sellMutation.isPending ||
                !accountId ||
                !proceedsAssetId ||
                !isPositiveDecimal(amount) ||
                !isPositiveDecimal(proceedsAmount)
              }
            >
              {sellMutation.isPending ? 'Сохраняю…' : 'Добавить продажу'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <label className="block text-sm text-zinc-600">
            Кошелёк
            <Select
              className="mt-1"
              value={accountId}
              onChange={(event) => setAccountId(event.target.value)}
            >
              <option value="">Выберите счёт</option>
              {chainWallets.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="block text-sm text-zinc-600">
            Количество {group.asset.symbol}
            <Input
              className="mt-1"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0"
            />
          </label>
          <label className="block text-sm text-zinc-600">
            Валюта выручки
            <Select
              className="mt-1"
              value={proceedsAssetId}
              onChange={(event) => setProceedsAssetId(event.target.value)}
            >
              <option value="">Выберите актив</option>
              {proceedsAssets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.symbol} · {asset.chainCode}
                </option>
              ))}
            </Select>
          </label>
          <label className="block text-sm text-zinc-600">
            Сумма выручки
            <Input
              className="mt-1"
              inputMode="decimal"
              value={proceedsAmount}
              onChange={(event) => setProceedsAmount(event.target.value)}
              placeholder="0"
            />
          </label>
          <label className="block text-sm text-zinc-600">
            Заметка
            <Textarea
              className="mt-1"
              value={sellNotes}
              onChange={(event) => setSellNotes(event.target.value)}
              placeholder="Необязательно"
            />
          </label>
          {proceedsAssets.length > 0 ? null : (
            <p className="text-xs text-amber-700">
              На сети {group.asset.chainCode.toUpperCase()} не найден cash-equivalent актив;
              добавьте USDT или USDC.
            </p>
          )}
          {sellError ? <p className="text-sm text-red-700">{sellError}</p> : null}
        </div>
      </Dialog>

      <Dialog
        open={notesOpen}
        onClose={() => setNotesOpen(false)}
        title="Заметка к сделке"
        description="Заметка не влияет на учёт."
        footer={
          <>
            <Button variant="ghost" onClick={() => setNotesOpen(false)}>
              Отмена
            </Button>
            <Button onClick={() => notesMutation.mutate()} disabled={notesMutation.isPending}>
              {notesMutation.isPending ? 'Сохраняю…' : 'Сохранить'}
            </Button>
          </>
        }
      >
        <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
        {notesError ? <p className="mt-2 text-sm text-red-700">{notesError}</p> : null}
      </Dialog>
    </div>
  );
}
