import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { createManualTransaction, fetchAccounts, fetchAssets, fetchTradeGroups } from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import { formatTokenAmount } from '@/lib/format';
import { idempotencyForPayload } from '@/lib/idempotency';
import { useWallet } from '@/lib/wallet-context';
import { localDateKey } from '@/lib/tasks';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type {
  Account,
  Asset,
  ManualTransactionRequest,
  TradeGroupSummary,
} from '@nexter/contracts';

type Side = 'entry' | 'exit';

function today(): string {
  return localDateKey(new Date());
}

function positive(value: string): boolean {
  return /^\d+(?:\.\d+)?$/.test(value) && Number(value) > 0;
}

export function ManualTradeDialog({
  open,
  initialAssetId = '',
  initialSide = 'entry',
  initialTradeGroupId,
  onClose,
  onSaved,
}: {
  open: boolean;
  initialAssetId?: string;
  initialSide?: Side;
  initialTradeGroupId?: string;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const queryClient = useQueryClient();
  const wallet = useWallet();
  const idempotencyKey = useRef<string>(crypto.randomUUID());
  const lastPayloadSignature = useRef<string | null>(null);
  const [side, setSide] = useState<Side>(initialSide);
  const [assetId, setAssetId] = useState(initialAssetId);
  const [quoteAssetId, setQuoteAssetId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [tradeGroupId, setTradeGroupId] = useState(initialTradeGroupId ?? '');
  const [amount, setAmount] = useState('');
  const [quoteAmount, setQuoteAmount] = useState('');
  const [occurredAt, setOccurredAt] = useState(today);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const assets = useQuery({
    queryKey: ['assets'],
    queryFn: fetchAssets,
    enabled: open,
  });
  const accountsQuery = useQuery({
    queryKey: ['accounts'],
    queryFn: fetchAccounts,
    enabled: open,
  });
  const groups = useQuery({
    queryKey: ['manual-trade-groups', assetId],
    queryFn: () => fetchTradeGroups({ assetId, limit: 100 }),
    enabled: open && side === 'exit' && Boolean(assetId),
  });

  const allAssets = assets.data?.assets ?? [];
  const walletAccounts =
    accountsQuery.data?.accounts.filter((account) => account.type === 'wallet') ?? [];
  const selectedAsset = allAssets.find((asset) => asset.id === assetId);
  const chainCode = selectedAsset?.chainCode ?? wallet.chain;
  const nonCashAssets = allAssets.filter(
    (asset) => !asset.isCashEquivalent && (asset.chainCode === chainCode || asset.id === assetId),
  );
  const cashAssets = allAssets.filter(
    (asset) =>
      asset.isCashEquivalent && (asset.chainCode === chainCode || asset.id === quoteAssetId),
  );
  const chainAccounts = walletAccounts.filter(
    (account) => !chainCode || account.chainCode === chainCode,
  );
  const openGroups = (groups.data?.data ?? []).filter(
    (group) => group.status !== 'closed' && Number(group.remainingAmount) > 0,
  );
  const selectedGroup = openGroups.find((group) => group.id === tradeGroupId);
  const effectiveAccountId =
    accountId && chainAccounts.some((account) => account.id === accountId)
      ? accountId
      : (chainAccounts[0]?.id ?? '');

  useEffect(() => {
    if (side === 'exit' && selectedGroup && !amount) {
      setAmount(selectedGroup.remainingAmount);
    }
  }, [side, selectedGroup, amount]);

  function reset(): void {
    idempotencyKey.current = crypto.randomUUID();
    lastPayloadSignature.current = null;
    setSide(initialSide);
    setAssetId(initialAssetId);
    setQuoteAssetId('');
    setAccountId('');
    setTradeGroupId(initialTradeGroupId ?? '');
    setAmount('');
    setQuoteAmount('');
    setOccurredAt(today());
    setNotes('');
    setError(null);
  }

  function submitManual(request: ManualTransactionRequest) {
    const signature = JSON.stringify(request);
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
      if (!assetId || !quoteAssetId || !effectiveAccountId) {
        throw new Error('Выберите актив, валюту и кошелёк.');
      }
      if (!positive(amount) || !positive(quoteAmount)) {
        throw new Error('Введите положительные количества.');
      }

      const common = {
        accountId: effectiveAccountId,
        assetId,
        amount,
        ...(occurredAt ? { occurredAt: new Date(`${occurredAt}T12:00:00`).toISOString() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      };

      if (side === 'entry') {
        return submitManual({
          type: 'buy',
          ...common,
          quoteAssetId,
          quoteAmount,
        });
      }

      return submitManual({
        type: 'sell',
        ...common,
        proceedsAssetId: quoteAssetId,
        proceedsAmount: quoteAmount,
        ...(tradeGroupId ? { tradeGroupId } : {}),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['positions'] });
      void queryClient.invalidateQueries({ queryKey: ['portfolio-token-summaries'] });
      void queryClient.invalidateQueries({ queryKey: ['trade-groups'] });
      void queryClient.invalidateQueries({ queryKey: ['transactions'] });
      void queryClient.invalidateQueries({ queryKey: ['operations'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      reset();
      onSaved?.();
      onClose();
    },
    onError: (err) => setError(toRussianError(err, 'Не удалось сохранить сделку')),
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

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Ручная сделка"
      description="Покупка или продажа без on-chain подписи. Для продажи можно выбрать конкретную сделку."
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
        <div className="flex gap-1 rounded-xl border border-zinc-200 bg-zinc-50 p-1">
          {(
            [
              ['entry', 'Покупка'],
              ['exit', 'Продажа'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setSide(value);
                setTradeGroupId('');
              }}
              className={`rounded-lg px-3 py-1.5 text-sm ${
                side === value
                  ? 'bg-white font-medium text-zinc-900 shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-900'
              }`}
              aria-pressed={side === value}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm text-zinc-600">
            Актив
            <Select
              className="mt-1"
              value={assetId}
              onChange={(event) => {
                setAssetId(event.target.value);
                setQuoteAssetId('');
                setTradeGroupId('');
                setAmount('');
              }}
            >
              <option value="">Выберите актив</option>
              {nonCashAssets.map(assetOption)}
            </Select>
          </label>
          <label className="block text-sm text-zinc-600">
            {side === 'entry' ? 'Валюта покупки' : 'Валюта продажи'}
            <Select
              className="mt-1"
              value={quoteAssetId}
              onChange={(event) => setQuoteAssetId(event.target.value)}
            >
              <option value="">Выберите валюту</option>
              {cashAssets.map(assetOption)}
            </Select>
          </label>
        </div>

        <label className="block text-sm text-zinc-600">
          Кошелёк
          <Select
            className="mt-1"
            value={effectiveAccountId}
            onChange={(event) => setAccountId(event.target.value)}
          >
            {chainAccounts.map(accountOption)}
          </Select>
        </label>

        {side === 'exit' ? (
          <label className="block text-sm text-zinc-600">
            Сделка
            <Select
              className="mt-1"
              value={tradeGroupId}
              onChange={(event) => {
                const group = openGroups.find((item) => item.id === event.target.value);
                setTradeGroupId(event.target.value);
                if (group) setAmount(group.remainingAmount);
              }}
            >
              <option value="">Все лоты (FIFO)</option>
              {openGroups.map((group: TradeGroupSummary) => (
                <option key={group.id} value={group.id}>
                  {formatTokenAmount(group.remainingAmount, 8)} · открыта{' '}
                  {new Date(group.openedAt).toLocaleDateString('ru-RU')}
                </option>
              ))}
            </Select>
            {selectedGroup ? (
              <span className="mt-1 block text-xs text-zinc-500">
                Остаток сделки: {formatTokenAmount(selectedGroup.remainingAmount, 8)}{' '}
                {selectedAsset?.symbol}
              </span>
            ) : null}
          </label>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm text-zinc-600">
            Количество {selectedAsset?.symbol ?? 'актива'}
            <Input
              className="mt-1"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0.00"
            />
          </label>
          <label className="block text-sm text-zinc-600">
            {side === 'entry' ? 'Сумма покупки' : 'Сумма продажи'}
            <Input
              className="mt-1"
              inputMode="decimal"
              value={quoteAmount}
              onChange={(event) => setQuoteAmount(event.target.value)}
              placeholder="0.00"
            />
          </label>
        </div>

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

        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}
      </div>
    </Drawer>
  );
}
