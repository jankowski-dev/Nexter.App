import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { apiFetch, fetchAccounts, fetchAssets, fetchSwapConfig, fetchTradeGroups } from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import { formatTokenAmount, formatUsd } from '@/lib/format';
import { manualTransactionResponseSchema } from '@nexter/contracts';
import type { Account, Asset, SwapConfigResponse } from '@nexter/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Decimal } from 'decimal.js';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { SwapPage } from '../swap/swap-page';

type OperationMode = 'trade' | 'exchange' | 'deposit' | 'withdrawal';
type TradeSide = 'entry' | 'exit';
type ExecutionMode = 'manual' | 'onchain';

const modeLabels: Record<OperationMode, string> = {
  trade: 'Сделка',
  exchange: 'Обмен',
  deposit: 'Пополнение',
  withdrawal: 'Вывод',
};

const groupStatusLabels: Record<string, string> = {
  open: 'Открыта',
  partial: 'Частично',
  closed: 'Закрыта',
  reserve: 'Резерв',
  for_sale: 'В продажу',
};

const sourceLabels: Record<string, string> = {
  manual: 'Ручная',
  notion: 'Notion',
  onchain: 'On-chain',
  kyberswap: 'KyberSwap',
  system: 'Система',
};

function isPositiveDecimal(value: string): boolean {
  return /^\d+(?:\.\d+)?$/.test(value) && Number(value) > 0;
}

function swapChainForAsset(asset: Asset | undefined): 'bsc' | 'ethereum' | null {
  if (asset?.chainCode === 'bsc' || asset?.chainCode === 'ethereum') return asset.chainCode;
  return null;
}

function swapTokenAddress(
  asset: Asset | undefined,
  config: SwapConfigResponse | undefined,
): string | null {
  if (!asset || !config) return null;

  const chain = config.chains.find((item) => item.code === asset.chainCode);
  if (!chain) return null;

  if (asset.contractAddress) {
    const token = chain.tokens.find(
      (item) => !item.native && item.address.toLowerCase() === asset.contractAddress?.toLowerCase(),
    );
    return token?.address ?? null;
  }

  const native = chain.tokens.find((item) => item.native && item.symbol === asset.symbol);
  return native?.address ?? null;
}

function accountLabel(account: Account): string {
  return `${account.name}${account.chainCode ? ` · ${account.chainCode}` : ''}`;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm text-zinc-600">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}

function AssetSelect({
  label,
  value,
  onChange,
  assets,
  placeholder = 'Выберите актив',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  assets: Asset[];
  placeholder?: string;
}) {
  return (
    <Field label={label}>
      <Select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{placeholder}</option>
        {assets.map((asset) => (
          <option key={asset.id} value={asset.id}>
            {asset.symbol} · {asset.chainCode}
          </option>
        ))}
      </Select>
    </Field>
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
  accounts: Account[];
}) {
  return (
    <Field label={label}>
      <Select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Выберите счёт</option>
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {accountLabel(account)}
          </option>
        ))}
      </Select>
    </Field>
  );
}

function DecimalField({
  label,
  value,
  onChange,
  placeholder = '0',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <Field label={label}>
      <Input
        aria-label={label}
        inputMode="decimal"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </Field>
  );
}

export interface TradeDialogProps {
  open: boolean;
  onClose: () => void;
  initialMode?: OperationMode;
  initialSide?: TradeSide;
  initialAssetId?: string;
  initialAmount?: string;
  initialCloseGroupIds?: string[];
}

export function TradeDialog({
  open,
  onClose,
  initialMode = 'trade',
  initialSide = 'entry',
  initialAssetId = '',
  initialAmount = '',
  initialCloseGroupIds,
}: TradeDialogProps) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<OperationMode>(initialMode);
  const [side, setSide] = useState<TradeSide>(initialSide);
  const [execution, setExecution] = useState<ExecutionMode>('manual');
  const [accountId, setAccountId] = useState('');
  const [assetId, setAssetId] = useState(initialAssetId);
  const [quoteAssetId, setQuoteAssetId] = useState('');
  const [amount, setAmount] = useState(initialAmount);
  const [quoteAmount, setQuoteAmount] = useState('');
  const [assetInId, setAssetInId] = useState('');
  const [assetOutId, setAssetOutId] = useState('');
  const [amountIn, setAmountIn] = useState('');
  const [amountOut, setAmountOut] = useState('');
  const [usdValue, setUsdValue] = useState('');
  const [usdValueIn, setUsdValueIn] = useState('');
  const [usdValueOut, setUsdValueOut] = useState('');
  const [notes, setNotes] = useState('');
  const [occurredAt, setOccurredAt] = useState('');
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const appliedInitialGroups = useRef(false);

  const assetsQuery = useQuery({ queryKey: ['assets'], queryFn: fetchAssets, enabled: open });
  const accountsQuery = useQuery({
    queryKey: ['accounts'],
    queryFn: fetchAccounts,
    enabled: open,
  });
  const swapConfig = useQuery({
    queryKey: ['swap-config'],
    queryFn: fetchSwapConfig,
    enabled: open,
  });

  const assets = assetsQuery.data?.assets ?? [];
  const walletAccounts =
    accountsQuery.data?.accounts.filter((account) => account.type === 'wallet') ?? [];
  const nonCashAssets = assets.filter((asset) => !asset.isCashEquivalent);
  const cashAssets = assets.filter((asset) => asset.isCashEquivalent);

  const selectedAsset = assets.find((asset) => asset.id === assetId);
  const selectedQuoteAsset = assets.find((asset) => asset.id === quoteAssetId);
  const selectedAssetIn = assets.find((asset) => asset.id === assetInId);
  const selectedAssetOut = assets.find((asset) => asset.id === assetOutId);

  const chainCode =
    mode === 'exchange' ? selectedAssetIn?.chainCode : (selectedAsset?.chainCode ?? null);
  const chainAccounts = walletAccounts.filter(
    (account) => !chainCode || account.chainCode === chainCode,
  );

  const groupsQuery = useQuery({
    queryKey: ['trade-groups-close', assetId],
    queryFn: () => fetchTradeGroups({ assetId, limit: 100 }),
    enabled: open && mode === 'trade' && side === 'exit' && Boolean(assetId),
  });
  const openGroups = (groupsQuery.data?.data ?? []).filter(
    (group) => group.status !== 'closed' && Number(group.remainingAmount) > 0,
  );

  const selectedGroups = useMemo(
    () => openGroups.filter((group) => selectedGroupIds.includes(group.id)),
    [openGroups, selectedGroupIds],
  );
  const selectedGroupTotal = selectedGroups.reduce(
    (total, group) => total.plus(group.remainingAmount),
    new Decimal(0),
  );

  useEffect(() => {
    if (!open) return;

    setMode(initialMode);
    setSide(initialSide);
    setExecution('manual');
    setAssetId(initialAssetId);
    setAmount(initialAmount);
    setSelectedGroupIds(initialCloseGroupIds ?? []);
    setAccountId('');
    setQuoteAssetId('');
    setQuoteAmount('');
    setAssetInId('');
    setAssetOutId('');
    setAmountIn('');
    setAmountOut('');
    setUsdValue('');
    setUsdValueIn('');
    setUsdValueOut('');
    setNotes('');
    setOccurredAt('');
    setError(null);
    setIdempotencyKey(crypto.randomUUID());
    appliedInitialGroups.current = false;
  }, [open, initialMode, initialSide, initialAssetId, initialAmount, initialCloseGroupIds]);

  useEffect(() => {
    if (!open || appliedInitialGroups.current || !initialCloseGroupIds?.length) return;
    if (openGroups.length === 0) return;

    appliedInitialGroups.current = true;
    setSelectedGroupIds(initialCloseGroupIds);
  }, [open, initialCloseGroupIds, openGroups.length]);

  useEffect(() => {
    if (!accountId && chainAccounts[0]) setAccountId(chainAccounts[0].id);
  }, [accountId, chainAccounts]);

  useEffect(() => {
    if (mode !== 'trade' || side !== 'exit') return;
    if (selectedGroups.length === 0) return;

    const decimals = selectedAsset?.decimals ?? 18;
    setAmount(selectedGroupTotal.toFixed(decimals));
  }, [mode, side, selectedGroups.length, selectedGroupTotal, selectedAsset?.decimals]);

  const swapReady = (() => {
    if (!swapConfig.data) return null;

    if (mode === 'trade' && side === 'entry') {
      const tokenIn = swapTokenAddress(selectedQuoteAsset, swapConfig.data);
      const tokenOut = swapTokenAddress(selectedAsset, swapConfig.data);
      const chain = swapChainForAsset(selectedAsset);
      return tokenIn && tokenOut && chain && isPositiveDecimal(quoteAmount)
        ? { chain, tokenIn, tokenOut, amountIn: quoteAmount, closeGroupIds: undefined }
        : null;
    }

    if (mode === 'trade' && side === 'exit') {
      const tokenIn = swapTokenAddress(selectedAsset, swapConfig.data);
      const tokenOut = swapTokenAddress(selectedQuoteAsset, swapConfig.data);
      const chain = swapChainForAsset(selectedAsset);
      return tokenIn &&
        tokenOut &&
        chain &&
        isPositiveDecimal(amount) &&
        selectedGroupIds.length > 0
        ? { chain, tokenIn, tokenOut, amountIn: amount, closeGroupIds: selectedGroupIds }
        : null;
    }

    if (mode === 'exchange') {
      const tokenIn = swapTokenAddress(selectedAssetIn, swapConfig.data);
      const tokenOut = swapTokenAddress(selectedAssetOut, swapConfig.data);
      const chain = swapChainForAsset(selectedAssetIn);
      return tokenIn && tokenOut && chain && isPositiveDecimal(amountIn)
        ? { chain, tokenIn, tokenOut, amountIn, closeGroupIds: undefined }
        : null;
    }

    return null;
  })();

  const manualMutation = useMutation({
    mutationFn: async () => {
      const body = buildBody();
      return apiFetch(
        '/api/v1/transactions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': idempotencyKey,
          },
          body: JSON.stringify(body),
        },
        manualTransactionResponseSchema,
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['positions'] });
      void queryClient.invalidateQueries({ queryKey: ['transactions'] });
      void queryClient.invalidateQueries({ queryKey: ['trade-groups'] });
      void queryClient.invalidateQueries({ queryKey: ['operations'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard-allocation'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard-active-positions'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard-recent-trades'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard-pnl'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard-equity-curve'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard-data-quality'] });
      onClose();
    },
    onError: (err) => setError(toRussianError(err, 'Не удалось сохранить операцию')),
  });

  function resetError(): void {
    if (error) setError(null);
  }

  function buildBody(): Record<string, unknown> {
    const occurred = occurredAt
      ? { occurredAt: new Date(`${occurredAt}T12:00:00`).toISOString() }
      : {};
    const note = notes.trim() ? { notes: notes.trim() } : {};

    if (mode === 'trade' && side === 'entry') {
      return {
        type: 'buy',
        accountId,
        assetId,
        amount,
        quoteAssetId,
        quoteAmount,
        ...occurred,
        ...note,
      };
    }

    if (mode === 'trade' && side === 'exit') {
      return {
        type: 'sell',
        accountId,
        assetId,
        amount,
        proceedsAssetId: quoteAssetId,
        proceedsAmount: quoteAmount,
        ...(selectedGroupIds.length === 1 ? { tradeGroupId: selectedGroupIds[0] } : {}),
        ...occurred,
        ...note,
      };
    }

    if (mode === 'exchange') {
      return {
        type: 'swap',
        accountId,
        assetInId,
        amountIn,
        assetOutId,
        amountOut,
        ...(usdValueIn ? { usdValueIn } : {}),
        ...(usdValueOut ? { usdValueOut } : {}),
        ...occurred,
        ...note,
      };
    }

    return {
      type: mode,
      accountId,
      assetId,
      amount,
      usdValue,
      ...occurred,
      ...note,
    };
  }

  function canSubmit(): boolean {
    if (!accountId) return false;

    if (mode === 'trade' && side === 'entry') {
      return Boolean(
        assetId && quoteAssetId && isPositiveDecimal(amount) && isPositiveDecimal(quoteAmount),
      );
    }

    if (mode === 'trade' && side === 'exit') {
      return Boolean(
        assetId &&
        quoteAssetId &&
        isPositiveDecimal(amount) &&
        isPositiveDecimal(quoteAmount) &&
        selectedGroupIds.length === 1,
      );
    }

    if (mode === 'exchange') {
      return Boolean(
        assetInId &&
        assetOutId &&
        isPositiveDecimal(amountIn) &&
        isPositiveDecimal(amountOut) &&
        assetInId !== assetOutId,
      );
    }

    return Boolean(assetId && isPositiveDecimal(amount) && isPositiveDecimal(usdValue));
  }

  const title =
    execution === 'onchain'
      ? 'On-chain операция'
      : mode === 'trade'
        ? side === 'entry'
          ? 'Новая сделка · вход'
          : 'Закрытие позиции'
        : mode === 'exchange'
          ? 'Обмен крипты'
          : modeLabels[mode];

  const description =
    execution === 'onchain'
      ? 'Котировка, проверка сборки и подпись в Tangem. Security gates остаются включёнными.'
      : 'Ручная запись в журнал. Для on-chain используйте переключатель «Выполнить on-chain».';

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="xl"
      footer={
        execution === 'onchain' ? (
          <Button variant="secondary" onClick={onClose}>
            Закрыть
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Отмена
            </Button>
            <Button
              onClick={() => manualMutation.mutate()}
              disabled={manualMutation.isPending || !canSubmit()}
            >
              {manualMutation.isPending ? 'Сохраняю…' : 'Сохранить'}
            </Button>
          </>
        )
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-1 rounded-lg border border-zinc-200 bg-zinc-50 p-1">
          {(Object.keys(modeLabels) as OperationMode[]).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => {
                setMode(item);
                setExecution('manual');
                setError(null);
              }}
              className={`rounded-md px-3 py-1.5 text-sm ${
                mode === item
                  ? 'bg-white text-zinc-900 shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-900'
              }`}
              aria-selected={mode === item}
              role="tab"
            >
              {modeLabels[item]}
            </button>
          ))}
        </div>

        {(mode === 'trade' || mode === 'exchange') && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            {mode === 'trade' ? (
              <div className="flex gap-1 rounded-lg border border-zinc-200 p-1">
                <button
                  type="button"
                  onClick={() => {
                    setSide('entry');
                    setExecution('manual');
                  }}
                  className={`rounded-md px-3 py-1.5 text-sm ${
                    side === 'entry'
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'text-zinc-500 hover:text-zinc-900'
                  }`}
                >
                  Вход
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSide('exit');
                    setExecution('manual');
                  }}
                  className={`rounded-md px-3 py-1.5 text-sm ${
                    side === 'exit'
                      ? 'bg-amber-50 text-amber-700'
                      : 'text-zinc-500 hover:text-zinc-900'
                  }`}
                >
                  Выход
                </button>
              </div>
            ) : (
              <div className="text-sm text-zinc-500">Крипта → крипта, без сделки в журнале.</div>
            )}

            <div className="flex gap-1 rounded-lg border border-zinc-200 p-1">
              <button
                type="button"
                onClick={() => setExecution('manual')}
                className={`rounded-md px-3 py-1.5 text-sm ${
                  execution === 'manual'
                    ? 'bg-white text-zinc-900 shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-900'
                }`}
              >
                Записать
              </button>
              <button
                type="button"
                onClick={() => {
                  setExecution('onchain');
                  setError(null);
                }}
                disabled={!swapReady}
                className={`rounded-md px-3 py-1.5 text-sm ${
                  execution === 'onchain'
                    ? 'bg-white text-zinc-900 shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-900 disabled:opacity-40'
                }`}
                title={swapReady ? 'Выполнить через Tangem' : 'Заполните параметры и allowlist'}
              >
                Выполнить on-chain
              </button>
            </div>
          </div>
        )}

        {execution === 'onchain' ? (
          swapReady ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                <Badge tone="info">Tangem</Badge>
                <span>
                  {swapReady.chain.toUpperCase()} · {formatTokenAmount(swapReady.amountIn, 8)}
                </span>
                {swapReady.closeGroupIds?.length ? (
                  <Badge tone="warning">закрытие {swapReady.closeGroupIds.length} поз.</Badge>
                ) : null}
              </div>
              <SwapPage
                embedded
                autoQuote
                initialChain={swapReady.chain}
                initialTokenIn={swapReady.tokenIn}
                initialTokenOut={swapReady.tokenOut}
                initialAmountIn={swapReady.amountIn}
                closeGroupIds={swapReady.closeGroupIds}
              />
            </div>
          ) : (
            <Card className="border-amber-200 bg-amber-50">
              <CardTitle className="text-amber-800">On-chain пока недоступен</CardTitle>
              <CardDescription className="text-amber-700">
                Заполните актив, сумму и выберите счёт. Для on-chain оба токена должны быть в swap
                allowlist; иначе доступна только ручная запись.
              </CardDescription>
              <Button className="mt-3" variant="secondary" onClick={() => setExecution('manual')}>
                Вернуться к ручной записи
              </Button>
            </Card>
          )
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {mode === 'trade' && side === 'entry' ? (
              <>
                <AssetSelect
                  label="Актив"
                  value={assetId}
                  onChange={(value) => {
                    setAssetId(value);
                    resetError();
                  }}
                  assets={nonCashAssets}
                />
                <DecimalField
                  label={`Количество ${selectedAsset?.symbol ?? 'актива'}`}
                  value={amount}
                  onChange={(value) => {
                    setAmount(value);
                    resetError();
                  }}
                />
                <AssetSelect
                  label="Валюта покупки"
                  value={quoteAssetId}
                  onChange={(value) => {
                    setQuoteAssetId(value);
                    resetError();
                  }}
                  assets={cashAssets.filter(
                    (asset) => !selectedAsset || asset.chainCode === selectedAsset.chainCode,
                  )}
                />
                <DecimalField
                  label={`Сумма ${selectedQuoteAsset?.symbol ?? 'валюты'}`}
                  value={quoteAmount}
                  onChange={(value) => {
                    setQuoteAmount(value);
                    resetError();
                  }}
                />
              </>
            ) : null}

            {mode === 'trade' && side === 'exit' ? (
              <>
                <AssetSelect
                  label="Актив"
                  value={assetId}
                  onChange={(value) => {
                    setAssetId(value);
                    setSelectedGroupIds([]);
                    setAmount('');
                    resetError();
                  }}
                  assets={nonCashAssets}
                />
                <AssetSelect
                  label="Валюта выручки"
                  value={quoteAssetId}
                  onChange={(value) => {
                    setQuoteAssetId(value);
                    resetError();
                  }}
                  assets={cashAssets.filter(
                    (asset) => !selectedAsset || asset.chainCode === selectedAsset.chainCode,
                  )}
                />
                <div className="md:col-span-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium text-zinc-700">Закрываемые позиции</div>
                    {openGroups.length > 0 ? (
                      <button
                        type="button"
                        className="text-xs text-emerald-700 hover:text-emerald-800"
                        onClick={() =>
                          setSelectedGroupIds(
                            selectedGroupIds.length === openGroups.length
                              ? []
                              : openGroups.map((group) => group.id),
                          )
                        }
                      >
                        {selectedGroupIds.length === openGroups.length
                          ? 'Снять все'
                          : 'Выбрать все'}
                      </button>
                    ) : null}
                  </div>
                  {groupsQuery.isPending ? (
                    <p className="mt-2 text-sm text-zinc-500">Загружаю позиции…</p>
                  ) : openGroups.length === 0 ? (
                    <p className="mt-2 text-sm text-zinc-500">Открытых позиций по активу нет.</p>
                  ) : (
                    <div className="mt-2 max-h-56 space-y-2 overflow-y-auto rounded-lg border border-zinc-200 p-2">
                      {openGroups.map((group) => (
                        <label
                          key={group.id}
                          className="flex cursor-pointer items-start gap-3 rounded-md p-2 text-sm hover:bg-zinc-50"
                        >
                          <input
                            type="checkbox"
                            className="mt-1 h-4 w-4 rounded border-zinc-300"
                            checked={selectedGroupIds.includes(group.id)}
                            onChange={(event) => {
                              setSelectedGroupIds((current) =>
                                event.target.checked
                                  ? [...current, group.id]
                                  : current.filter((id) => id !== group.id),
                              );
                              resetError();
                            }}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center justify-between gap-2">
                              <span className="text-zinc-800">
                                {formatTokenAmount(group.remainingAmount)} {group.asset.symbol}
                              </span>
                              <span className="font-mono text-xs text-zinc-500">
                                {group.returnPct ? `${group.returnPct}%` : '—'}
                              </span>
                            </span>
                            <span className="text-xs text-zinc-500">
                              {groupStatusLabels[group.status] ?? group.status} ·{' '}
                              {sourceLabels[group.source] ?? group.source} ·{' '}
                              {formatUsd(group.totalPnlUsd)}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                  {selectedGroupIds.length > 1 ? (
                    <p className="mt-2 text-xs text-amber-700">
                      Для нескольких позиций используйте on-chain; ручная продажа закрывает одну
                      группу.
                    </p>
                  ) : null}
                </div>
                <DecimalField
                  label={`Количество ${selectedAsset?.symbol ?? 'актива'}`}
                  value={amount}
                  onChange={(value) => {
                    setAmount(value);
                    resetError();
                  }}
                />
                <DecimalField
                  label={`Сумма ${selectedQuoteAsset?.symbol ?? 'выручки'}`}
                  value={quoteAmount}
                  onChange={(value) => {
                    setQuoteAmount(value);
                    resetError();
                  }}
                />
              </>
            ) : null}

            {mode === 'exchange' ? (
              <>
                <AssetSelect
                  label="Отдаю"
                  value={assetInId}
                  onChange={(value) => {
                    setAssetInId(value);
                    resetError();
                  }}
                  assets={nonCashAssets}
                />
                <DecimalField
                  label={`Количество ${selectedAssetIn?.symbol ?? ''}`}
                  value={amountIn}
                  onChange={(value) => {
                    setAmountIn(value);
                    resetError();
                  }}
                />
                <AssetSelect
                  label="Получаю"
                  value={assetOutId}
                  onChange={(value) => {
                    setAssetOutId(value);
                    resetError();
                  }}
                  assets={nonCashAssets.filter((asset) => asset.id !== assetInId)}
                />
                <DecimalField
                  label={`Количество ${selectedAssetOut?.symbol ?? ''}`}
                  value={amountOut}
                  onChange={(value) => {
                    setAmountOut(value);
                    resetError();
                  }}
                />
                <DecimalField
                  label="USD стоимость отдачи (опционально)"
                  value={usdValueIn}
                  onChange={setUsdValueIn}
                />
                <DecimalField
                  label="USD стоимость получения (опционально)"
                  value={usdValueOut}
                  onChange={setUsdValueOut}
                />
              </>
            ) : null}

            {mode === 'deposit' || mode === 'withdrawal' ? (
              <>
                <AssetSelect
                  label="Актив"
                  value={assetId}
                  onChange={(value) => {
                    setAssetId(value);
                    resetError();
                  }}
                  assets={assets}
                />
                <DecimalField
                  label="Количество"
                  value={amount}
                  onChange={(value) => {
                    setAmount(value);
                    resetError();
                  }}
                />
                <DecimalField
                  label="USD стоимость"
                  value={usdValue}
                  onChange={(value) => {
                    setUsdValue(value);
                    resetError();
                  }}
                />
              </>
            ) : null}

            <AccountSelect
              label="Кошелёк"
              value={accountId}
              onChange={(value) => {
                setAccountId(value);
                resetError();
              }}
              accounts={chainAccounts}
            />
            <Field label="Дата (опционально)">
              <Input
                type="date"
                value={occurredAt}
                onChange={(event) => setOccurredAt(event.target.value)}
              />
            </Field>
            <div className="md:col-span-2">
              <Field label="Заметка">
                <Textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Комментарий к операции"
                />
              </Field>
            </div>
          </div>
        )}

        {execution === 'manual' &&
        mode === 'trade' &&
        side === 'exit' &&
        selectedGroups.length > 0 ? (
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700">
            Выбрано {selectedGroups.length} поз. на{' '}
            {formatTokenAmount(selectedGroupTotal.toFixed(8))} {selectedAsset?.symbol}. Ручная
            продажа закроет одну группу; для нескольких используйте on-chain.
          </div>
        ) : null}

        {execution === 'manual' && mode === 'exchange' ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            Обмен не создаёт сделку в журнале. Для некассовых активов укажите USD-стоимость обеих
            сторон, иначе сервер отклонит проводку.
          </div>
        ) : null}

        {error ? <p className="text-sm text-red-700">{error}</p> : null}
      </div>
    </Dialog>
  );
}
