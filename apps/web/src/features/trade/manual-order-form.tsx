import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { createManualTransaction, fetchAccounts, fetchAssets } from '@/lib/api';
import { ClientValidationError, toRussianError } from '@/lib/error-messages';
import { formatPrice, formatTokenAmount, formatUsd, normalizeDecimalInput } from '@/lib/format';
import { idempotencyForPayload } from '@/lib/idempotency';
import { localDateKey } from '@/lib/tasks';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Decimal } from 'decimal.js';
import { useEffect, useRef, useState } from 'react';
import type { Asset, ManualTransactionRequest, TradeGroupDetail } from '@nexter/contracts';

type Side = 'buy' | 'sell';

function positive(value: string): boolean {
  return /^\d+(?:\.\d+)?$/.test(value) && Number(value) > 0;
}

export function ManualOrderForm({
  token,
  side,
  trade,
  marketPriceUsd,
  onSaved,
  onClose,
  onPendingChange,
  stopLossPct,
  takeProfitPct,
}: {
  token: Asset;
  side: Side;
  trade: TradeGroupDetail | null;
  marketPriceUsd: string | null;
  onSaved?: () => void;
  onClose: () => void;
  onPendingChange?: (pending: boolean) => void;
  stopLossPct?: number | null;
  takeProfitPct?: number | null;
}) {
  const queryClient = useQueryClient();
  const idempotencyKey = useRef<string>(crypto.randomUUID());
  const lastPayloadSignature = useRef<string | null>(null);
  const [accountId, setAccountId] = useState('');
  const [quoteAssetId, setQuoteAssetId] = useState('');
  const [amount, setAmount] = useState('');
  const [quoteAmount, setQuoteAmount] = useState('');
  const [occurredAt, setOccurredAt] = useState(() => localDateKey(new Date()));
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const assets = useQuery({ queryKey: ['assets'], queryFn: fetchAssets });
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: fetchAccounts });

  const allAssets = assets.data?.assets ?? [];
  const walletAccounts =
    accounts.data?.accounts.filter((account) => account.type === 'wallet') ?? [];
  const chainAccounts = walletAccounts.filter((account) => account.chainCode === token.chainCode);
  const effectiveAccountId =
    accountId && chainAccounts.some((account) => account.id === accountId)
      ? accountId
      : (chainAccounts[0]?.id ?? '');
  const cashAssets = allAssets.filter(
    (asset) => asset.isCashEquivalent && asset.chainCode === token.chainCode,
  );
  const quoteAsset = allAssets.find((asset) => asset.id === quoteAssetId) ?? null;
  const remaining = trade ? new Decimal(trade.group.remainingAmount) : null;

  useEffect(() => {
    if (quoteAssetId) return;
    const preferred =
      cashAssets.find((asset) => asset.symbol === 'USDT') ??
      cashAssets.find((asset) => asset.symbol === 'USDC') ??
      cashAssets[0];
    if (preferred) setQuoteAssetId(preferred.id);
  }, [cashAssets, quoteAssetId]);

  useEffect(() => {
    if (side === 'sell' && trade && !amount)
      setAmount(normalizeDecimalInput(trade.group.remainingAmount));
  }, [side, trade, amount]);

  function submitManual(request: ManualTransactionRequest) {
    const signature = JSON.stringify(request);
    const next = idempotencyForPayload(
      idempotencyKey.current,
      lastPayloadSignature.current,
      signature,
    );
    idempotencyKey.current = next.key;
    lastPayloadSignature.current = next.signature;
    return createManualTransaction(request, next.key, side === 'buy' ? 'main-list' : 'order');
  }

  const save = useMutation({
    mutationFn: async () => {
      if (!effectiveAccountId) throw new ClientValidationError('Выберите кошелёк на этой сети.');
      if (!quoteAssetId) throw new ClientValidationError('Выберите валюту оплаты или получения.');
      if (!positive(amount) || !positive(quoteAmount)) {
        throw new ClientValidationError('Введите положительные количества.');
      }
      if (side === 'sell') {
        if (!trade) throw new ClientValidationError('Не удалось загрузить ордер для продажи.');
        if (remaining && new Decimal(amount).gt(remaining)) {
          throw new ClientValidationError(
            `Нельзя продать больше остатка: ${formatTokenAmount(trade.group.remainingAmount, 8)} ${token.symbol}.`,
          );
        }
      }

      const common = {
        accountId: effectiveAccountId,
        assetId: token.id,
        amount,
        ...(occurredAt ? { occurredAt: new Date(`${occurredAt}T12:00:00`).toISOString() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      };

      if (side === 'buy') {
        return submitManual({
          type: 'buy',
          ...common,
          quoteAssetId,
          quoteAmount,
          ...(stopLossPct != null ? { stopLossPct } : {}),
          ...(takeProfitPct != null ? { takeProfitPct } : {}),
        });
      }

      return submitManual({
        type: 'sell',
        ...common,
        proceedsAssetId: quoteAssetId,
        proceedsAmount: quoteAmount,
        ...(trade ? { tradeGroupId: trade.group.id } : {}),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['positions'] });
      void queryClient.invalidateQueries({ queryKey: ['portfolio-token-summaries'] });
      void queryClient.invalidateQueries({ queryKey: ['trade-groups'] });
      void queryClient.invalidateQueries({ queryKey: ['transactions'] });
      void queryClient.invalidateQueries({ queryKey: ['operations'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['portfolio-asset'] });
      onSaved?.();
      onClose();
    },
    onError: (err) => setError(toRussianError(err, 'Не удалось сохранить сделку')),
  });

  useEffect(() => {
    onPendingChange?.(save.isPending);
  }, [save.isPending, onPendingChange]);

  return (
    <form
      id="manual-order-form"
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        save.mutate();
      }}
    >
      <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
        <div className="text-sm font-medium text-zinc-800">
          Ручная {side === 'buy' ? 'покупка' : 'продажа'}
        </div>
        <p className="mt-0.5 text-xs leading-5 text-zinc-500">
          Без on-chain подписи. Сделка попадёт в учёт, аудит и журнал операций.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm text-zinc-600">
          Кошелёк
          <Select
            className="mt-1"
            value={effectiveAccountId}
            onChange={(event) => setAccountId(event.target.value)}
            disabled={save.isPending}
          >
            {chainAccounts.length === 0 ? (
              <option value="">Нет кошелька на этой сети</option>
            ) : null}
            {chainAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="block text-sm text-zinc-600">
          {side === 'buy' ? 'Валюта оплаты' : 'Валюта получения'}
          <Select
            className="mt-1"
            value={quoteAssetId}
            onChange={(event) => setQuoteAssetId(event.target.value)}
            disabled={save.isPending}
          >
            <option value="">Выберите валюту</option>
            {cashAssets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.symbol} · {asset.chainCode}
              </option>
            ))}
          </Select>
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm text-zinc-600">
          Количество {token.symbol}
          <Input
            className="mt-1 font-mono"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="0.00"
            disabled={save.isPending}
          />
          {side === 'sell' && remaining ? (
            <span className="mt-1 block text-xs text-zinc-500">
              Остаток ордера: {formatTokenAmount(trade?.group.remainingAmount ?? '0', 8)}{' '}
              {token.symbol}
            </span>
          ) : null}
        </label>
        <label className="block text-sm text-zinc-600">
          {side === 'buy' ? 'Сумма оплаты' : 'Сумма получения'}
          <Input
            className="mt-1 font-mono"
            inputMode="decimal"
            value={quoteAmount}
            onChange={(event) => setQuoteAmount(event.target.value)}
            placeholder="0.00"
            disabled={save.isPending}
          />
        </label>
      </div>

      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
        <div className="text-xs font-medium uppercase tracking-wide text-emerald-700">
          {side === 'buy' ? 'Покупка' : 'Продажа'}
        </div>
        <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2">
          <span className="font-mono text-2xl font-semibold text-emerald-900">
            {amount ? `${formatTokenAmount(amount, 8)} ${token.symbol}` : '—'}
          </span>
          <span className="font-mono text-sm text-emerald-800">
            {side === 'buy' ? 'за' : 'получу'} {formatUsd(quoteAmount)} {quoteAsset?.symbol ?? ''}
          </span>
        </div>
        <div className="mt-1 text-xs text-emerald-700">
          Рынок: {formatPrice(marketPriceUsd)}
          {side === 'sell' && trade
            ? ` · остаток ${formatTokenAmount(trade.group.remainingAmount, 8)} ${token.symbol}`
            : ''}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm text-zinc-600">
          Дата
          <Input
            className="mt-1"
            type="date"
            value={occurredAt}
            onChange={(event) => setOccurredAt(event.target.value)}
            disabled={save.isPending}
          />
        </label>
        <label className="block text-sm text-zinc-600">
          Заметка
          <Input
            className="mt-1"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Комментарий"
            disabled={save.isPending}
          />
        </label>
      </div>

      {side === 'sell' && trade ? (
        <p className="text-xs text-zinc-500">
          Себестоимость остатка: {formatUsd(trade.group.remainingCostBasisUsd)}.
        </p>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}
    </form>
  );
}
