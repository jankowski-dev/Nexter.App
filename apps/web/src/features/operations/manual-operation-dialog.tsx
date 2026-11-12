import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { createManualTransaction, fetchAccounts, fetchAssets } from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import { formatPrice, formatUsd } from '@/lib/format';
import { idempotencyForPayload } from '@/lib/idempotency';
import { useWallet } from '@/lib/wallet-context';
import { localDateKey } from '@/lib/tasks';
import { useAssetUsdPrice } from '../portfolio/use-asset-price';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Decimal } from 'decimal.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Account, Asset, ManualTransactionRequest } from '@nexter/contracts';

type Mode = 'exchange' | 'deposit' | 'withdrawal' | 'income' | 'adjustment';

const modeLabels: Record<Mode, string> = {
  exchange: 'Обмен',
  deposit: 'Пополнение',
  withdrawal: 'Вывод',
  income: 'Доход',
  adjustment: 'Корректировка',
};

function today(): string {
  return localDateKey(new Date());
}

function positive(value: string): boolean {
  return /^\d+(?:\.\d+)?$/.test(value) && Number(value) > 0;
}

function usdFrom(amount: string, price: string | null, cash: boolean): string | null {
  if (!positive(amount)) return null;
  if (cash) return amount;
  if (!price || !positive(price)) return null;
  return new Decimal(amount).mul(price).toFixed(8);
}

export function ManualOperationDialog({
  open,
  initialMode = 'exchange',
  onClose,
  onSaved,
}: {
  open: boolean;
  initialMode?: Mode;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const queryClient = useQueryClient();
  const wallet = useWallet();
  const idempotencyKey = useRef<string>(crypto.randomUUID());
  const lastPayloadSignature = useRef<string | null>(null);
  const wasOpen = useRef(false);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [accountId, setAccountId] = useState('');
  const [assetId, setAssetId] = useState('');
  const [assetInId, setAssetInId] = useState('');
  const [assetOutId, setAssetOutId] = useState('');
  const [amount, setAmount] = useState('');
  const [amountOut, setAmountOut] = useState('');
  const [usdValue, setUsdValue] = useState('');
  const [reason, setReason] = useState('');
  const [occurredAt, setOccurredAt] = useState(today);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const assets = useQuery({ queryKey: ['assets'], queryFn: fetchAssets, enabled: open });
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: fetchAccounts, enabled: open });
  const priceIn = useAssetUsdPrice(assetInId || null);
  const priceOut = useAssetUsdPrice(assetOutId || null);
  const priceSingle = useAssetUsdPrice(assetId || null);

  const allAssets = assets.data?.assets ?? [];
  const walletAccounts =
    accounts.data?.accounts.filter((account) => account.type === 'wallet') ?? [];
  const selectedAccount = walletAccounts.find((account) => account.id === accountId);
  const chainCode = selectedAccount?.chainCode ?? wallet.chain;
  const chainAssets = allAssets.filter((asset) => asset.chainCode === chainCode);
  const chainAccounts = walletAccounts;
  const selectedAsset = allAssets.find((asset) => asset.id === assetId);
  const selectedIn = allAssets.find((asset) => asset.id === assetInId);
  const selectedOut = allAssets.find((asset) => asset.id === assetOutId);
  const effectiveAccountId =
    accountId && chainAccounts.some((account) => account.id === accountId)
      ? accountId
      : (chainAccounts.find((account) => account.chainCode === wallet.chain)?.id ??
        chainAccounts[0]?.id ??
        '');

  const autoUsdIn = useMemo(
    () => (selectedIn ? usdFrom(amount, priceIn, selectedIn.isCashEquivalent) : null),
    [selectedIn, amount, priceIn],
  );
  const autoUsdOut = useMemo(
    () => (selectedOut ? usdFrom(amountOut, priceOut, selectedOut.isCashEquivalent) : null),
    [selectedOut, amountOut, priceOut],
  );
  const autoUsd = useMemo(
    () => (selectedAsset ? usdFrom(amount, priceSingle, selectedAsset.isCashEquivalent) : null),
    [selectedAsset, amount, priceSingle],
  );

  function reset(): void {
    idempotencyKey.current = crypto.randomUUID();
    lastPayloadSignature.current = null;
    setMode(initialMode);
    setAccountId('');
    setAssetId('');
    setAssetInId('');
    setAssetOutId('');
    setAmount('');
    setAmountOut('');
    setUsdValue('');
    setReason('');
    setOccurredAt(today());
    setNotes('');
    setError(null);
  }

  useEffect(() => {
    if (open && !wasOpen.current) reset();
    wasOpen.current = open;
  }, [open]);

  function submitManual(
    request: ManualTransactionRequest,
    signaturePayload: Record<string, unknown>,
  ) {
    const signature = JSON.stringify(signaturePayload);
    const next = idempotencyForPayload(
      idempotencyKey.current,
      lastPayloadSignature.current,
      signature,
    );
    idempotencyKey.current = next.key;
    lastPayloadSignature.current = next.signature;
    return createManualTransaction(request, next.key);
  }

  const save = useMutation({
    mutationFn: async () => {
      if (!effectiveAccountId) throw new Error('Выберите кошелёк.');
      const occurred = occurredAt
        ? { occurredAt: new Date(`${occurredAt}T12:00:00`).toISOString() }
        : {};
      const note = notes.trim() ? { notes: notes.trim() } : {};
      const signaturePayload = {
        mode,
        accountId: effectiveAccountId,
        assetId,
        assetInId,
        assetOutId,
        amount,
        amountOut,
        usdValue: usdValue.trim(),
        reason: reason.trim(),
        occurredAt,
        notes: notes.trim(),
      };

      if (mode === 'exchange') {
        if (!assetInId || !assetOutId || !positive(amount) || !positive(amountOut)) {
          throw new Error('Заполните оба актива и количества.');
        }
        if (!autoUsdIn || !autoUsdOut) {
          throw new Error('Не удалось определить USD-стоимость. Проверьте цены активов.');
        }
        return submitManual(
          {
            type: 'swap',
            accountId: effectiveAccountId,
            assetInId,
            amountIn: amount,
            assetOutId,
            amountOut,
            usdValueIn: autoUsdIn,
            usdValueOut: autoUsdOut,
            ...occurred,
            ...note,
          },
          signaturePayload,
        );
      }

      if (!assetId || !positive(amount)) {
        throw new Error('Выберите актив и количество.');
      }
      if (mode === 'deposit') {
        if (!positive(usdValue)) throw new Error('Укажите, сколько USD потрачено.');
        return submitManual(
          {
            type: 'deposit',
            accountId: effectiveAccountId,
            assetId,
            amount,
            usdValue,
            ...occurred,
            ...note,
          },
          signaturePayload,
        );
      }
      if (mode === 'withdrawal') {
        if (!positive(usdValue)) throw new Error('Укажите, сколько USD получено.');
        return submitManual(
          {
            type: 'withdrawal',
            accountId: effectiveAccountId,
            assetId,
            amount,
            usdValue,
            ...occurred,
            ...note,
          },
          signaturePayload,
        );
      }
      if (mode === 'income') {
        const value = usdValue || autoUsd;
        if (!value || !positive(value)) throw new Error('Укажите USD-стоимость дохода.');
        return submitManual(
          {
            type: 'income',
            accountId: effectiveAccountId,
            assetId,
            amount,
            usdValue: value,
            ...occurred,
            ...note,
          },
          signaturePayload,
        );
      }
      if (!reason.trim()) throw new Error('Укажите причину корректировки.');
      const value = usdValue || autoUsd;
      if (!value || !positive(value)) throw new Error('Укажите USD-стоимость корректировки.');
      return submitManual(
        {
          type: 'adjustment',
          accountId: effectiveAccountId,
          assetId,
          amount,
          usdValue: value,
          reason: reason.trim(),
          ...occurred,
          ...note,
        },
        signaturePayload,
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['positions'] });
      void queryClient.invalidateQueries({ queryKey: ['trade-groups'] });
      void queryClient.invalidateQueries({ queryKey: ['transactions'] });
      void queryClient.invalidateQueries({ queryKey: ['operations'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      reset();
      onSaved?.();
      onClose();
    },
    onError: (err) => setError(toRussianError(err, 'Не удалось сохранить операцию')),
  });

  function assetOption(asset: Asset) {
    return (
      <option key={asset.id} value={asset.id}>
        {asset.symbol} · {asset.chainCode}
      </option>
    );
  }

  function accountOption(account: Account) {
    return (
      <option key={account.id} value={account.id}>
        {account.name}
        {account.chainCode ? ` · ${account.chainCode}` : ''}
      </option>
    );
  }

  const singleUsd = usdValue || autoUsd || '';

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Новая операция"
      description="Обмен, пополнение, вывод, доход или корректировка. Только ручной ввод."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? 'Сохраняю…' : 'Сохранить'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1 rounded-xl border border-zinc-200 bg-zinc-50 p-1">
          {(Object.keys(modeLabels) as Mode[]).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setMode(value);
                setError(null);
              }}
              className={`rounded-lg px-3 py-1.5 text-sm ${
                mode === value
                  ? 'bg-white font-medium text-zinc-900 shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-900'
              }`}
              aria-pressed={mode === value}
            >
              {modeLabels[value]}
            </button>
          ))}
        </div>

        <label className="block text-sm text-zinc-600">
          Кошелёк
          <Select
            className="mt-1"
            value={effectiveAccountId}
            onChange={(event) => {
              const nextId = event.target.value;
              const nextAccount = walletAccounts.find((account) => account.id === nextId);
              if (nextAccount?.chainCode !== chainCode) {
                setAssetId('');
                setAssetInId('');
                setAssetOutId('');
              }
              setAccountId(nextId);
            }}
          >
            {chainAccounts.map(accountOption)}
          </Select>
        </label>

        {mode === 'exchange' ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm text-zinc-600">
                Отдаю
                <Select
                  className="mt-1"
                  value={assetInId}
                  onChange={(event) => setAssetInId(event.target.value)}
                >
                  <option value="">Выберите актив</option>
                  {chainAssets.map(assetOption)}
                </Select>
              </label>
              <label className="block text-sm text-zinc-600">
                Получаю
                <Select
                  className="mt-1"
                  value={assetOutId}
                  onChange={(event) => setAssetOutId(event.target.value)}
                >
                  <option value="">Выберите актив</option>
                  {chainAssets.map(assetOption)}
                </Select>
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm text-zinc-600">
                Количество {selectedIn?.symbol ?? ''}
                <Input
                  className="mt-1"
                  inputMode="decimal"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                />
                <span className="mt-1 block text-xs text-zinc-500">
                  {autoUsdIn ? `≈ ${formatUsd(autoUsdIn)}` : 'USD-цена не найдена'}
                </span>
              </label>
              <label className="block text-sm text-zinc-600">
                Количество {selectedOut?.symbol ?? ''}
                <Input
                  className="mt-1"
                  inputMode="decimal"
                  value={amountOut}
                  onChange={(event) => setAmountOut(event.target.value)}
                />
                <span className="mt-1 block text-xs text-zinc-500">
                  {autoUsdOut ? `≈ ${formatUsd(autoUsdOut)}` : 'USD-цена не найдена'}
                </span>
              </label>
            </div>
          </>
        ) : (
          <>
            <label className="block text-sm text-zinc-600">
              Актив
              <Select
                className="mt-1"
                value={assetId}
                onChange={(event) => setAssetId(event.target.value)}
              >
                <option value="">Выберите актив</option>
                {chainAssets.map(assetOption)}
              </Select>
            </label>
            <label className="block text-sm text-zinc-600">
              Количество {selectedAsset?.symbol ?? ''}
              <Input
                className="mt-1"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
              {mode === 'income' || mode === 'adjustment' ? (
                <span className="mt-1 block text-xs text-zinc-500">
                  {autoUsd ? `≈ ${formatUsd(autoUsd)}` : 'Введите USD-стоимость вручную'}
                </span>
              ) : null}
            </label>
            {mode === 'deposit' ? (
              <label className="block text-sm text-zinc-600">
                Сколько USD потрачено на токены
                <Input
                  className="mt-1"
                  inputMode="decimal"
                  value={usdValue}
                  onChange={(event) => setUsdValue(event.target.value)}
                  placeholder="0.00"
                />
              </label>
            ) : null}
            {mode === 'withdrawal' ? (
              <label className="block text-sm text-zinc-600">
                Сколько USD получено
                <Input
                  className="mt-1"
                  inputMode="decimal"
                  value={usdValue}
                  onChange={(event) => setUsdValue(event.target.value)}
                  placeholder="0.00"
                />
              </label>
            ) : null}
            {mode === 'income' || mode === 'adjustment' ? (
              <label className="block text-sm text-zinc-600">
                USD-стоимость
                <Input
                  className="mt-1"
                  inputMode="decimal"
                  value={singleUsd}
                  onChange={(event) => setUsdValue(event.target.value)}
                  placeholder={autoUsd ? `≈ ${formatUsd(autoUsd)}` : '0.00'}
                />
              </label>
            ) : null}
            {mode === 'adjustment' ? (
              <label className="block text-sm text-zinc-600">
                Причина
                <Input
                  className="mt-1"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Почему меняется баланс"
                />
              </label>
            ) : null}
          </>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm text-zinc-600">
            Дата
            <Input
              className="mt-1"
              type="date"
              value={occurredAt}
              onChange={(event) => setOccurredAt(event.target.value)}
            />
          </label>
          <label className="block text-sm text-zinc-600">
            Заметка
            <Input
              className="mt-1"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Комментарий"
            />
          </label>
        </div>

        {selectedAsset && mode !== 'exchange' ? (
          <p className="text-xs text-zinc-500">Текущая цена: {formatPrice(priceSingle)} USD.</p>
        ) : null}

        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}
      </div>
    </Drawer>
  );
}
