import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { apiFetch, fetchAccounts, fetchAssets } from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import { formatUsd } from '@/lib/format';
import { manualTransactionResponseSchema } from '@nexter/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Decimal } from 'decimal.js';
import { useEffect, useState } from 'react';

type ManualType =
  'buy' | 'sell' | 'swap' | 'transfer' | 'deposit' | 'withdrawal' | 'income' | 'adjustment';

const typeLabels: Record<ManualType, string> = {
  buy: 'Покупка',
  sell: 'Продажа',
  swap: 'Своп',
  transfer: 'Перевод',
  deposit: 'Пополнение',
  withdrawal: 'Вывод',
  income: 'Доход',
  adjustment: 'Корректировка',
};

function isPositiveDecimal(value: string): boolean {
  return /^\d+(?:\.\d+)?$/.test(value) && Number(value) > 0;
}

export function ManualEntryDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [type, setType] = useState<ManualType>('buy');
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: fetchAccounts, enabled: open });
  const assets = useQuery({ queryKey: ['assets'], queryFn: fetchAssets, enabled: open });

  useEffect(() => {
    if (!open) return;
    const wallet = accounts.data?.accounts.find((account) => account.type === 'wallet');
    const external = accounts.data?.accounts.find((account) => account.type === 'external');
    const usdt = assets.data?.assets.find(
      (asset) => asset.chainCode === 'bsc' && asset.symbol === 'USDT',
    );

    setForm((current) => ({
      accountId: current.accountId || wallet?.id || '',
      fromAccountId: current.fromAccountId || wallet?.id || '',
      toAccountId: current.toAccountId || external?.id || '',
      quoteAssetId: current.quoteAssetId || usdt?.id || '',
      proceedsAssetId: current.proceedsAssetId || usdt?.id || '',
      ...current,
    }));
  }, [open, accounts.data, assets.data]);

  const mutation = useMutation({
    mutationFn: async () => {
      const body = buildBody(type, form);
      return apiFetch(
        '/api/v1/transactions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': crypto.randomUUID(),
          },
          body: JSON.stringify(body),
        },
        manualTransactionResponseSchema,
      );
    },
    onSuccess: () => {
      onClose();
      setForm({});
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['positions'] });
      void queryClient.invalidateQueries({ queryKey: ['transactions'] });
      void queryClient.invalidateQueries({ queryKey: ['trade-groups'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard-allocation'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard-active-positions'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard-recent-trades'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard-pnl'] });
      void queryClient.invalidateQueries({ queryKey: ['watchlist'] });
    },
    onError: (err) => setError(toRussianError(err, 'Не удалось создать операцию')),
  });

  function set(field: string, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function canSubmit(): boolean {
    if (type === 'transfer') {
      return Boolean(
        form.fromAccountId &&
        form.toAccountId &&
        form.assetId &&
        isPositiveDecimal(form.amount ?? ''),
      );
    }
    if (type === 'adjustment') {
      return Boolean(
        form.accountId &&
        form.assetId &&
        isPositiveDecimal(form.amount ?? '') &&
        isPositiveDecimal(form.usdValue ?? '') &&
        form.reason?.trim(),
      );
    }
    if (type === 'deposit' || type === 'withdrawal' || type === 'income') {
      return Boolean(
        form.accountId &&
        form.assetId &&
        isPositiveDecimal(form.amount ?? '') &&
        isPositiveDecimal(form.usdValue ?? ''),
      );
    }
    if (type === 'swap') {
      return Boolean(
        form.accountId &&
        form.assetInId &&
        form.assetOutId &&
        isPositiveDecimal(form.amountIn ?? '') &&
        isPositiveDecimal(form.amountOut ?? ''),
      );
    }
    if (type === 'buy') {
      return Boolean(
        form.accountId &&
        form.assetId &&
        form.quoteAssetId &&
        isPositiveDecimal(form.amount ?? '') &&
        isPositiveDecimal(form.quoteAmount ?? ''),
      );
    }
    return Boolean(
      form.accountId &&
      form.assetId &&
      form.proceedsAssetId &&
      isPositiveDecimal(form.amount ?? '') &&
      isPositiveDecimal(form.proceedsAmount ?? ''),
    );
  }

  const assetOptions = assets.data?.assets ?? [];
  const cashAssets = assetOptions.filter((asset) => asset.isCashEquivalent);
  const nonCashAssets = assetOptions.filter((asset) => !asset.isCashEquivalent);

  const preview = buildPreview(type, form);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Новая операция"
      description="Ручная запись в журнал. После сохранения появится аудит и проводки."
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !canSubmit()}>
            {mutation.isPending ? 'Сохраняю…' : 'Сохранить операцию'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-1 rounded-lg border border-zinc-800 bg-zinc-900/40 p-1">
          {(Object.keys(typeLabels) as ManualType[]).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setType(item)}
              className={`rounded-md px-2.5 py-1.5 text-xs ${type === item ? 'bg-zinc-800 text-zinc-50' : 'text-zinc-400 hover:text-zinc-200'}`}
            >
              {typeLabels[item]}
            </button>
          ))}
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {type === 'transfer' ? (
            <>
              <AccountSelect
                label="Со счёта"
                value={form.fromAccountId ?? ''}
                onChange={(value) => set('fromAccountId', value)}
                accounts={accounts.data?.accounts ?? []}
              />
              <AccountSelect
                label="На счёт"
                value={form.toAccountId ?? ''}
                onChange={(value) => set('toAccountId', value)}
                accounts={accounts.data?.accounts ?? []}
              />
            </>
          ) : (
            <AccountSelect
              label="Кошелёк"
              value={form.accountId ?? ''}
              onChange={(value) => set('accountId', value)}
              accounts={accounts.data?.accounts ?? []}
            />
          )}

          {type === 'buy' ? (
            <>
              <AssetSelect
                label="Актив покупки"
                value={form.assetId ?? ''}
                onChange={(value) => set('assetId', value)}
                assets={nonCashAssets}
              />
              <DecimalInput label="Количество актива" field="amount" form={form} set={set} />
              <AssetSelect
                label="Валюта покупки"
                value={form.quoteAssetId ?? ''}
                onChange={(value) => set('quoteAssetId', value)}
                assets={cashAssets}
              />
              <DecimalInput label="Сумма валюты" field="quoteAmount" form={form} set={set} />
            </>
          ) : null}

          {type === 'sell' ? (
            <>
              <AssetSelect
                label="Актив продажи"
                value={form.assetId ?? ''}
                onChange={(value) => set('assetId', value)}
                assets={nonCashAssets}
              />
              <DecimalInput label="Количество актива" field="amount" form={form} set={set} />
              <AssetSelect
                label="Валюта выручки"
                value={form.proceedsAssetId ?? ''}
                onChange={(value) => set('proceedsAssetId', value)}
                assets={cashAssets}
              />
              <DecimalInput label="Сумма выручки" field="proceedsAmount" form={form} set={set} />
            </>
          ) : null}

          {type === 'swap' ? (
            <>
              <AssetSelect
                label="Актив списания"
                value={form.assetInId ?? ''}
                onChange={(value) => set('assetInId', value)}
                assets={assetOptions}
              />
              <DecimalInput label="Количество списания" field="amountIn" form={form} set={set} />
              <AssetSelect
                label="Актив получения"
                value={form.assetOutId ?? ''}
                onChange={(value) => set('assetOutId', value)}
                assets={assetOptions}
              />
              <DecimalInput label="Количество получения" field="amountOut" form={form} set={set} />
              <DecimalInput
                label="USD стоимость списания (опционально)"
                field="usdValueIn"
                form={form}
                set={set}
              />
              <DecimalInput
                label="USD стоимость получения (опционально)"
                field="usdValueOut"
                form={form}
                set={set}
              />
            </>
          ) : null}

          {type === 'transfer' ? (
            <>
              <AssetSelect
                label="Актив"
                value={form.assetId ?? ''}
                onChange={(value) => set('assetId', value)}
                assets={assetOptions}
              />
              <DecimalInput label="Количество" field="amount" form={form} set={set} />
              <DecimalInput
                label="USD стоимость (опционально)"
                field="usdValue"
                form={form}
                set={set}
              />
            </>
          ) : null}

          {type === 'deposit' || type === 'withdrawal' || type === 'income' ? (
            <>
              <AssetSelect
                label="Актив"
                value={form.assetId ?? ''}
                onChange={(value) => set('assetId', value)}
                assets={assetOptions}
              />
              <DecimalInput label="Количество" field="amount" form={form} set={set} />
              <DecimalInput label="USD стоимость" field="usdValue" form={form} set={set} />
              <label className="block text-sm text-zinc-400">
                Заметка
                <Textarea
                  className="mt-1"
                  value={form.notes ?? ''}
                  onChange={(event) => set('notes', event.target.value)}
                />
              </label>
            </>
          ) : null}

          {type === 'adjustment' ? (
            <>
              <AssetSelect
                label="Актив"
                value={form.assetId ?? ''}
                onChange={(value) => set('assetId', value)}
                assets={assetOptions}
              />
              <DecimalInput label="Количество" field="amount" form={form} set={set} />
              <DecimalInput label="USD стоимость" field="usdValue" form={form} set={set} />
              <label className="block text-sm text-zinc-400 md:col-span-2">
                Причина корректировки
                <Textarea
                  className="mt-1"
                  value={form.reason ?? ''}
                  onChange={(event) => set('reason', event.target.value)}
                  placeholder="Обязательное поле"
                />
              </label>
            </>
          ) : null}

          {['buy', 'sell', 'swap', 'transfer'].includes(type) ? (
            <>
              <AssetSelect
                label="Актив сбора (опционально)"
                value={form.feeAssetId ?? ''}
                onChange={(value) => set('feeAssetId', value)}
                assets={assetOptions}
                allowEmpty
              />
              <DecimalInput
                label="Сумма сбора (опционально)"
                field="feeAmount"
                form={form}
                set={set}
              />
              <DecimalInput
                label="USD сбора (опционально)"
                field="feeUsdValue"
                form={form}
                set={set}
              />
              <label className="block text-sm text-zinc-400">
                Заметка
                <Textarea
                  className="mt-1"
                  value={form.notes ?? ''}
                  onChange={(event) => set('notes', event.target.value)}
                />
              </label>
            </>
          ) : null}
        </div>

        {preview ? (
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-3 text-sm text-zinc-300">
            <div className="font-medium text-zinc-200">Предпросмотр</div>
            <div className="mt-1">{preview}</div>
            <div className="mt-1 text-xs text-zinc-500">
              Точные проводки, комиссии и FIFO рассчитает сервер.
            </div>
          </div>
        ) : null}

        {error ? <p className="text-sm text-red-300">{error}</p> : null}
      </div>
    </Dialog>
  );
}

function AccountSelect({
  label,
  value,
  onChange,
  accounts,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  accounts: Array<{ id: string; name: string; type: string }>;
}) {
  return (
    <label className="block text-sm text-zinc-400">
      {label}
      <Select className="mt-1" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Выберите счёт</option>
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {account.name} · {account.type}
          </option>
        ))}
      </Select>
    </label>
  );
}

function AssetSelect({
  label,
  value,
  onChange,
  assets,
  allowEmpty = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  assets: Array<{ id: string; symbol: string; chainCode: string }>;
  allowEmpty?: boolean;
}) {
  return (
    <label className="block text-sm text-zinc-400">
      {label}
      <Select className="mt-1" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{allowEmpty ? 'Без сбора' : 'Выберите актив'}</option>
        {assets.map((asset) => (
          <option key={asset.id} value={asset.id}>
            {asset.symbol} · {asset.chainCode}
          </option>
        ))}
      </Select>
    </label>
  );
}

function DecimalInput({
  label,
  field,
  form,
  set,
}: {
  label: string;
  field: string;
  form: Record<string, string>;
  set: (field: string, value: string) => void;
}) {
  return (
    <label className="block text-sm text-zinc-400">
      {label}
      <Input
        className="mt-1"
        inputMode="decimal"
        value={form[field] ?? ''}
        onChange={(event) => set(field, event.target.value)}
        placeholder="0"
      />
    </label>
  );
}

function buildBody(type: ManualType, form: Record<string, string>): Record<string, unknown> {
  const notes = form.notes?.trim() ? { notes: form.notes.trim() } : {};
  const fees =
    form.feeAssetId && form.feeAmount
      ? {
          feeAssetId: form.feeAssetId,
          feeAmount: form.feeAmount,
          ...(form.feeUsdValue ? { feeUsdValue: form.feeUsdValue } : {}),
        }
      : {};

  switch (type) {
    case 'buy':
      return {
        type,
        accountId: form.accountId,
        assetId: form.assetId,
        amount: form.amount,
        quoteAssetId: form.quoteAssetId,
        quoteAmount: form.quoteAmount,
        ...(form.usdValue ? { usdValue: form.usdValue } : {}),
        ...fees,
        ...notes,
      };
    case 'sell':
      return {
        type,
        accountId: form.accountId,
        assetId: form.assetId,
        amount: form.amount,
        proceedsAssetId: form.proceedsAssetId,
        proceedsAmount: form.proceedsAmount,
        ...(form.usdValue ? { usdValue: form.usdValue } : {}),
        ...fees,
        ...notes,
      };
    case 'swap':
      return {
        type,
        accountId: form.accountId,
        assetInId: form.assetInId,
        amountIn: form.amountIn,
        assetOutId: form.assetOutId,
        amountOut: form.amountOut,
        ...(form.usdValueIn ? { usdValueIn: form.usdValueIn } : {}),
        ...(form.usdValueOut ? { usdValueOut: form.usdValueOut } : {}),
        ...fees,
        ...notes,
      };
    case 'transfer':
      return {
        type,
        fromAccountId: form.fromAccountId,
        toAccountId: form.toAccountId,
        assetId: form.assetId,
        amount: form.amount,
        ...(form.usdValue ? { usdValue: form.usdValue } : {}),
        ...fees,
        ...notes,
      };
    case 'adjustment':
      return {
        type,
        accountId: form.accountId,
        assetId: form.assetId,
        amount: form.amount,
        usdValue: form.usdValue,
        reason: form.reason,
        ...notes,
      };
    default:
      return {
        type,
        accountId: form.accountId,
        assetId: form.assetId,
        amount: form.amount,
        usdValue: form.usdValue,
        ...notes,
      };
  }
}

function buildPreview(type: ManualType, form: Record<string, string>): string | null {
  try {
    if (type === 'buy' && form.amount && form.quoteAmount) {
      const price = new Decimal(form.quoteAmount).div(form.amount);
      return `${form.amount} актива за ${formatUsd(form.quoteAmount)} · цена ${formatUsd(price.toFixed(8), 8)}`;
    }
    if (type === 'sell' && form.amount && form.proceedsAmount) {
      const price = new Decimal(form.proceedsAmount).div(form.amount);
      return `${form.amount} актива за ${formatUsd(form.proceedsAmount)} · цена ${formatUsd(price.toFixed(8), 8)}`;
    }
    if (type === 'swap' && form.usdValueIn && form.usdValueOut) {
      const cost = new Decimal(form.usdValueIn).minus(form.usdValueOut);
      return `Execution cost: ${formatUsd(cost.toFixed(8))}`;
    }
    if (form.amount && form.usdValue) {
      return `${form.amount} · ${formatUsd(form.usdValue)}`;
    }
    return null;
  } catch {
    return null;
  }
}
