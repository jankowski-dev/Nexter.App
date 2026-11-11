import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import {
  ApiError,
  buildSwap,
  buildSwapApproval,
  cancelSwap,
  cancelSwapSigning,
  fetchAssets,
  fetchSwapConfig,
  fetchSwapOrder,
  markSwapSigning,
  previewSwap,
  quoteSwap,
  readySwap,
  stepUp,
  submitSwap,
  submitSwapApproval,
  type SwapBuildResponse,
} from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import { formatPct, formatPrice, formatTokenAmount, formatUsd, pnlTone } from '@/lib/format';
import { useWallet } from '@/lib/wallet-context';
import {
  isBuildRetryable,
  isStepUpRequired,
  isSwapSettled,
  phaseAfterExecutionFailure,
} from './swap-execution';
import { useAssetUsdPrice } from '../portfolio/use-asset-price';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Decimal } from 'decimal.js';
import { useDeferredValue, useEffect, useRef, useState } from 'react';
import type { Asset, SwapOrderDetail, SwapPreview, SwapQuoteRequest } from '@nexter/contracts';

type Phase =
  | 'idle'
  | 'quoting'
  | 'building'
  | 'approval'
  | 'signing'
  | 'submitting'
  | 'submit_failed'
  | 'confirming'
  | 'success';

function positive(value: string): boolean {
  return /^\d+(?:\.\d+)?$/.test(value) && Number(value) > 0;
}

function chainIdFor(code: 'bsc' | 'ethereum'): number {
  return code === 'ethereum' ? 1 : 56;
}

function assetForToken(
  assetRows: Asset[],
  chainCode: string,
  token: { symbol: string; address: string; native: boolean },
): Asset | null {
  return (
    assetRows.find(
      (asset) =>
        asset.chainCode === chainCode &&
        (token.native
          ? asset.symbol === token.symbol
          : asset.contractAddress?.toLowerCase() === token.address.toLowerCase()),
    ) ?? null
  );
}

function rateFromPreview(preview: SwapPreview | null): string | null {
  if (!preview || !positive(preview.amountIn) || !positive(preview.amountOut)) return null;
  try {
    return new Decimal(preview.amountOut).div(preview.amountIn).toFixed(12);
  } catch {
    return null;
  }
}

export function ExchangeDrawer({
  onClose,
  onManual,
  onCompleted,
}: {
  onClose: () => void;
  onManual?: () => void;
  onCompleted?: () => void;
}) {
  const wallet = useWallet();
  const queryClient = useQueryClient();
  const config = useQuery({ queryKey: ['swap-config'], queryFn: fetchSwapConfig });
  const assets = useQuery({ queryKey: ['assets'], queryFn: fetchAssets });
  const chainCode = wallet.chain;
  const chain = config.data?.chains.find((item) => item.code === chainCode) ?? null;
  const tokens = chain?.tokens ?? [];
  const [inSymbol, setInSymbol] = useState('USDC');
  const [outSymbol, setOutSymbol] = useState('BASED');
  const [amountIn, setAmountIn] = useState('');
  const [slippageBps, setSlippageBps] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [order, setOrder] = useState<SwapOrderDetail | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [stepUpCode, setStepUpCode] = useState('');
  const [stepUpError, setStepUpError] = useState<string | null>(null);
  const stepUpResolver = useRef<{ resolve: () => void; reject: (error: Error) => void } | null>(
    null,
  );
  const mountedRef = useRef(true);
  const initialApplied = useRef(false);
  const onCompletedRef = useRef(onCompleted);
  const handledOrderRef = useRef<string | null>(null);

  useEffect(() => {
    onCompletedRef.current = onCompleted;
  }, [onCompleted]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!chain || tokens.length === 0) return;
    const nextIn =
      tokens.find((token) => token.symbol === inSymbol) ??
      tokens.find((token) => token.symbol === 'USDC') ??
      tokens.find((token) => !token.native) ??
      tokens[0];
    const nextOut =
      tokens.find((token) => token.symbol === outSymbol) ??
      tokens.find(
        (token) => !token.native && token.address.toLowerCase() !== nextIn?.address.toLowerCase(),
      ) ??
      tokens[0];
    if (!initialApplied.current) {
      initialApplied.current = true;
      setInSymbol(nextIn?.symbol ?? '');
      setOutSymbol(nextOut?.symbol ?? '');
      return;
    }
    if (nextIn?.symbol !== inSymbol) {
      setInSymbol(nextIn?.symbol ?? '');
      setAmountIn('');
    }
    if (nextOut?.symbol !== outSymbol) {
      setOutSymbol(nextOut?.symbol ?? '');
      setAmountIn('');
    }
  }, [chain, tokens, inSymbol, outSymbol]);

  const inToken = tokens.find((token) => token.symbol === inSymbol) ?? tokens[0];
  const outToken = tokens.find((token) => token.symbol === outSymbol) ?? tokens[1] ?? tokens[0];
  const inAsset = inToken ? assetForToken(assets.data?.assets ?? [], chainCode, inToken) : null;
  const outAsset = outToken ? assetForToken(assets.data?.assets ?? [], chainCode, outToken) : null;
  const marketIn = useAssetUsdPrice(inAsset?.id);
  const marketOut = useAssetUsdPrice(outAsset?.id);
  const previewAmount = useDeferredValue(amountIn);
  const allowlistRequired = config.data?.walletAllowlistConfigured ?? false;
  const pendingSubmit = phase === 'submit_failed';
  const executing = !['idle', 'success', 'submit_failed'].includes(phase);
  const closeBlocked = executing || pendingSubmit || stepUpOpen;

  const preview = useQuery({
    queryKey: [
      'exchange-preview',
      chainCode,
      inToken?.address,
      outToken?.address,
      previewAmount,
      slippageBps,
      wallet.address,
    ],
    queryFn: () =>
      previewSwap({
        chain: chainCode,
        tokenIn: inToken!.address,
        tokenOut: outToken!.address,
        amountIn: previewAmount,
        slippageBps: slippageBps ?? config.data?.defaultSlippageBps ?? 50,
        walletAddress: wallet.address ?? undefined,
      }),
    enabled: Boolean(
      config.data?.enabled &&
      chain &&
      inToken &&
      outToken &&
      inToken.address !== outToken.address &&
      positive(previewAmount) &&
      (!allowlistRequired || wallet.address) &&
      !executing &&
      !pendingSubmit,
    ),
    refetchInterval: 10_000,
    retry: false,
  });

  const liveOrder = useQuery({
    queryKey: ['exchange-order', order?.id],
    queryFn: () => fetchSwapOrder(order!.id),
    enabled: Boolean(order?.id && phase === 'confirming'),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === 'SUBMITTED' || status === 'PENDING') return 3_000;
      if (status === 'CONFIRMED' && !query.state.data?.accountingTransactionId) return 3_000;
      return false;
    },
  });

  useEffect(() => {
    const current = liveOrder.data;
    if (!current) return;
    setOrder(current);
    if (isSwapSettled(current)) {
      if (handledOrderRef.current === current.id) return;
      handledOrderRef.current = current.id;
      setPhase('success');
      void queryClient.invalidateQueries({ queryKey: ['positions'] });
      void queryClient.invalidateQueries({ queryKey: ['trade-groups'] });
      void queryClient.invalidateQueries({ queryKey: ['transactions'] });
      void queryClient.invalidateQueries({ queryKey: ['operations'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      onCompletedRef.current?.();
      return;
    }
    if (current.status === 'FAILED' || current.status === 'CANCELLED') {
      if (handledOrderRef.current === current.id) return;
      handledOrderRef.current = current.id;
      setPhase('idle');
      setError(`Обмен ${current.status === 'FAILED' ? 'не выполнен' : 'отменён'}.`);
    }
  }, [liveOrder.data, queryClient]);

  function askStepUp(): Promise<void> {
    setStepUpCode('');
    setStepUpError(null);
    setStepUpOpen(true);
    return new Promise((resolve, reject) => {
      stepUpResolver.current = { resolve, reject };
    });
  }

  async function withStepUp<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'SWAP_STEP_UP_REQUIRED') {
        await askStepUp();
        return action();
      }
      throw err;
    }
  }

  async function confirmStepUp(): Promise<void> {
    setStepUpError(null);
    try {
      await stepUp(stepUpCode);
      setStepUpOpen(false);
      stepUpResolver.current?.resolve();
      stepUpResolver.current = null;
    } catch (err) {
      setStepUpError(toRussianError(err, 'Не удалось подтвердить TOTP'));
    }
  }

  function cancelStepUp(): void {
    setStepUpOpen(false);
    stepUpResolver.current?.reject(new Error('Подтверждение TOTP отменено'));
    stepUpResolver.current = null;
  }

  async function buildWithRecovery(
    request: SwapQuoteRequest,
  ): Promise<{ quoted: SwapOrderDetail; built: SwapBuildResponse }> {
    let quoted = await quoteSwap(request);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (!mountedRef.current) throw new Error('Окно закрыто');
      setOrder(quoted);
      setPhase('building');

      try {
        return { quoted, built: await buildSwap(quoted.id, wallet.address as string) };
      } catch (err) {
        const requiresStepUp = err instanceof ApiError && isStepUpRequired(err.code);
        const retryable = err instanceof ApiError && isBuildRetryable(err.code);
        if (!retryable || attempt === 1) {
          await cancelSwap(quoted.id).catch(() => undefined);
          throw err;
        }

        if (requiresStepUp) {
          try {
            await askStepUp();
          } catch (stepUpError) {
            await cancelSwap(quoted.id).catch(() => undefined);
            throw stepUpError;
          }
        }
        await cancelSwap(quoted.id).catch(() => undefined);
        quoted = await quoteSwap(request);
      }
    }

    throw new Error('Не удалось собрать обмен');
  }

  async function execute(): Promise<void> {
    if (!chain || !inToken || !outToken || inToken.address === outToken.address) {
      setError('Выберите два разных токена.');
      return;
    }
    if (!positive(amountIn)) {
      setError('Введите количество токена.');
      return;
    }
    if (!wallet.connected || !wallet.address) {
      setError('Сначала подключите кошелёк в шапке.');
      return;
    }
    if (!config.data?.enabled || !chain.executionEnabled) {
      setError('On-chain исполнение для этой сети сейчас выключено.');
      return;
    }

    handledOrderRef.current = null;
    setError(null);
    setPhase('quoting');
    setTxHash(null);

    let activeOrder: SwapOrderDetail | null = null;
    let broadcastHash: string | null = null;

    try {
      const request: SwapQuoteRequest = {
        chain: chainCode,
        tokenIn: inToken.address,
        tokenOut: outToken.address,
        amountIn,
        slippageBps: slippageBps ?? config.data.defaultSlippageBps,
        walletAddress: wallet.address,
      };

      const quotedResult = await buildWithRecovery(request);
      const quoted = quotedResult.quoted;
      let built = quotedResult.built;
      activeOrder = quoted;
      if (!mountedRef.current) return;
      setOrder(quoted);

      if (built.approvalRequired) {
        setPhase('approval');
        try {
          const prepared = await withStepUp(() => buildSwapApproval(quoted.id));
          if (!mountedRef.current) return;
          let approvalHash: string;

          try {
            approvalHash = await wallet.sendTransaction({
              chainId: chainIdFor(quoted.chain as 'bsc' | 'ethereum'),
              to: prepared.to,
              data: prepared.calldata,
              value: prepared.value,
            });
          } catch (err) {
            await cancelSwap(quoted.id).catch(() => undefined);
            throw err;
          }

          await submitSwapApproval(prepared.approval.id, approvalHash);
          await wallet.waitForReceipt(approvalHash);
          if (!mountedRef.current) return;
          built = await withStepUp(() => readySwap(quoted.id));
          if (!mountedRef.current) return;
        } catch (err) {
          if (err instanceof ApiError && err.code === 'SWAP_APPROVAL_NOT_REQUIRED') {
            built = await withStepUp(() => readySwap(quoted.id));
          } else {
            throw err;
          }
        }
      }

      if (built.status !== 'READY') {
        built = await withStepUp(() => readySwap(quoted.id));
      }
      if (!built.routerAddress || !built.calldata) {
        throw new Error('Сборка не содержит calldata для подписи');
      }

      setPhase('signing');
      await withStepUp(() => markSwapSigning(quoted.id));
      if (!mountedRef.current) return;

      let hash: string;
      try {
        hash = await wallet.sendTransaction({
          chainId: chainIdFor(quoted.chain as 'bsc' | 'ethereum'),
          to: built.routerAddress,
          data: built.calldata,
          value: built.transactionValue ?? '0',
        });
      } catch (err) {
        await cancelSwapSigning(quoted.id).catch(() => undefined);
        throw err;
      }

      if (!mountedRef.current) return;
      broadcastHash = hash;
      setTxHash(hash);
      setPhase('submitting');
      await withStepUp(() => submitSwap(quoted.id, hash));
      if (!mountedRef.current) return;
      setPhase('confirming');
    } catch (err) {
      if (!mountedRef.current) return;
      const nextPhase = phaseAfterExecutionFailure(Boolean(broadcastHash && activeOrder));
      if (nextPhase === 'submit_failed' && broadcastHash && activeOrder) {
        setTxHash(broadcastHash);
        setOrder(activeOrder);
      } else if (activeOrder) {
        void cancelSwap(activeOrder.id).catch(() => undefined);
      }
      setPhase(nextPhase);
      setError(toRussianError(err, 'Не удалось выполнить обмен'));
    }
  }

  async function retrySubmit(): Promise<void> {
    if (!order || !txHash) return;

    setError(null);
    setPhase('submitting');

    try {
      await withStepUp(() => submitSwap(order.id, txHash));
      if (!mountedRef.current) return;
      setPhase('confirming');
    } catch (err) {
      if (!mountedRef.current) return;

      // The previous submit may have succeeded with a lost response.
      try {
        const current = await fetchSwapOrder(order.id);
        if (mountedRef.current) {
          setOrder(current);
          if (['SUBMITTED', 'PENDING', 'CONFIRMED'].includes(current.status)) {
            setError(null);
            setPhase('confirming');
            return;
          }
          if (['CANCELLED', 'FAILED'].includes(current.status)) {
            setPhase('idle');
            setError('Своп завершился без принятия подписи. Можно начать заново.');
            return;
          }
        }
      } catch {
        // Keep the retry state; the order may still be recoverable.
      }

      if (!mountedRef.current) return;
      setPhase('submit_failed');
      setError(toRussianError(err, 'Не удалось отправить подпись в сеть'));
    }
  }

  const kyberRate = rateFromPreview(preview.data ?? null);
  const marketInUsd = inAsset?.isCashEquivalent ? '1' : marketIn;
  const marketOutUsd = outAsset?.isCashEquivalent ? '1' : marketOut;
  const marketRate =
    marketInUsd && marketOutUsd && Number(marketOutUsd) > 0
      ? (Number(marketInUsd) / Number(marketOutUsd)).toFixed(12)
      : null;
  const rateDifference =
    marketRate && kyberRate && Number(marketRate) > 0
      ? ((Number(kyberRate) - Number(marketRate)) / Number(marketRate)) * 100
      : null;
  const canSubmit =
    Boolean(config.data?.enabled) &&
    Boolean(chain?.executionEnabled) &&
    Boolean(inToken && outToken && inToken.address !== outToken.address) &&
    Boolean(wallet.connected) &&
    positive(amountIn) &&
    !executing &&
    !pendingSubmit;

  return (
    <>
      <Drawer
        open
        onClose={onClose}
        closeDisabled={closeBlocked}
        title="Обмен on-chain"
        description="Курс KyberSwap, автоматическая сборка и подпись в кошельке."
        size="third"
        footer={
          <div className="flex w-full items-center justify-between gap-2">
            <span className="text-xs text-zinc-500">
              {phase === 'confirming'
                ? 'Ожидаю подтверждение сети…'
                : phase === 'submit_failed'
                  ? 'Подпись получена, но не отправлена'
                  : phase === 'success'
                    ? 'Обмен учтён'
                    : 'Котировка обновляется каждые 10 секунд'}
            </span>
            <Button variant="ghost" onClick={onClose} disabled={closeBlocked}>
              Готово
            </Button>
          </div>
        }
      >
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm text-zinc-600">
              Отдаю
              <Select
                className="mt-1"
                value={inToken?.symbol ?? ''}
                onChange={(event) => {
                  setInSymbol(event.target.value);
                  setAmountIn('');
                }}
                disabled={executing}
              >
                {tokens.map((token) => (
                  <option key={token.symbol} value={token.symbol}>
                    {token.symbol}
                  </option>
                ))}
              </Select>
            </label>
            <label className="block text-sm text-zinc-600">
              Получаю
              <Select
                className="mt-1"
                value={outToken?.symbol ?? ''}
                onChange={(event) => {
                  setOutSymbol(event.target.value);
                  setAmountIn('');
                }}
                disabled={executing}
              >
                {tokens
                  .filter((token) => token.address !== inToken?.address)
                  .map((token) => (
                    <option key={token.symbol} value={token.symbol}>
                      {token.symbol}
                    </option>
                  ))}
              </Select>
            </label>
          </div>

          <label className="block text-sm text-zinc-600">
            Сколько {inToken?.symbol ?? ''} отдать
            <Input
              className="mt-1 font-mono"
              inputMode="decimal"
              value={amountIn}
              onChange={(event) => setAmountIn(event.target.value)}
              placeholder="0.00"
              disabled={executing}
            />
          </label>

          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
            <div className="text-xs font-medium uppercase tracking-wide text-emerald-700">
              Получите {outToken?.symbol ?? ''}
            </div>
            <div className="mt-1 font-mono text-2xl font-semibold text-emerald-900">
              {preview.data?.amountOut ? formatTokenAmount(preview.data.amountOut, 8) : '—'}
            </div>
            {preview.data?.minOut ? (
              <div className="mt-1 text-xs text-emerald-700">
                Минимум: {formatTokenAmount(preview.data.minOut, 8)} {outToken?.symbol}
              </div>
            ) : null}
          </div>

          <div className="grid gap-2 text-sm sm:grid-cols-3">
            <div className="rounded-lg border border-zinc-200 p-2">
              <div className="text-xs text-zinc-500">KyberSwap</div>
              <div className="font-mono text-zinc-800">
                {kyberRate ? formatPrice(kyberRate) : '—'}
              </div>
            </div>
            <div className="rounded-lg border border-zinc-200 p-2">
              <div className="text-xs text-zinc-500" title="DexScreener/CoinGecko">
                Рынок
              </div>
              <div className="font-mono text-zinc-800">
                {marketRate ? formatPrice(marketRate) : '—'}
              </div>
            </div>
            <div className="rounded-lg border border-zinc-200 p-2">
              <div className="text-xs text-zinc-500">Разница</div>
              <div className={`font-mono ${pnlTone(rateDifference?.toString())}`}>
                {rateDifference === null ? '—' : formatPct(rateDifference.toFixed(2))}
              </div>
            </div>
            <div className="rounded-lg border border-zinc-200 p-2">
              <div className="text-xs text-zinc-500">Газ</div>
              <div className="font-mono text-zinc-800">
                {preview.data?.gasUsd ? formatUsd(preview.data.gasUsd) : '—'}
              </div>
            </div>
            <div className="rounded-lg border border-zinc-200 p-2">
              <div className="text-xs text-zinc-500">Price impact</div>
              <div className="font-mono text-zinc-800">
                {preview.data?.priceImpactBps == null
                  ? '—'
                  : formatPct((preview.data.priceImpactBps / 100).toFixed(2))}
              </div>
            </div>
            <div className="rounded-lg border border-zinc-200 p-2">
              <div className="text-xs text-zinc-500">Проскальзывание</div>
              <select
                className="mt-1 w-full bg-transparent font-mono text-zinc-800 outline-none"
                value={String(slippageBps ?? config.data?.defaultSlippageBps ?? 50)}
                onChange={(event) => setSlippageBps(Number(event.target.value))}
                disabled={executing}
              >
                {[10, 50, 100, 200].map((value) => (
                  <option key={value} value={value}>
                    {(value / 100).toFixed(2)}%
                  </option>
                ))}
              </select>
            </div>
          </div>

          {!wallet.connected ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              Подключите кошелёк в шапке, чтобы подписать обмен.
              <Button
                className="ml-2"
                variant="secondary"
                onClick={() => void wallet.connect()}
                disabled={wallet.connecting || wallet.restoring || !wallet.projectId}
              >
                {wallet.restoring
                  ? 'Восстанавливаю…'
                  : wallet.connecting
                    ? 'Подключаю…'
                    : 'Подключить'}
              </Button>
            </div>
          ) : null}

          {!config.data?.enabled || !chain?.executionEnabled ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              On-chain исполнение для этой сети выключено. Используйте ручной обмен.
            </div>
          ) : null}

          {preview.isError ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              {toRussianError(preview.error, 'Не удалось получить котировку')}
            </div>
          ) : null}

          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          {phase === 'signing' || phase === 'approval' ? (
            <p className="text-xs text-zinc-500">
              Ожидаю ответ кошелька. Чтобы отменить, отклоните запрос в приложении кошелька.
            </p>
          ) : null}

          {phase === 'success' ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
              Обмен учтён в журнале операций.
            </div>
          ) : null}

          <div className="sticky bottom-0 -mx-5 -mb-5 border-t border-zinc-200 bg-white px-5 py-3">
            {pendingSubmit ? (
              <div className="space-y-2">
                <Button className="w-full" onClick={() => void retrySubmit()}>
                  Повторить отправку подписи
                </Button>
                <p className="text-xs text-amber-700">
                  Транзакция уже подписана. Повторная отправка использует тот же hash и не создаёт
                  дубль.
                </p>
              </div>
            ) : (
              <Button className="w-full" onClick={() => void execute()} disabled={!canSubmit}>
                {executing
                  ? phase === 'quoting'
                    ? 'Получаю котировку…'
                    : phase === 'building'
                      ? 'Проверяю сборку…'
                      : phase === 'approval'
                        ? 'Подтверждаю approval…'
                        : phase === 'signing'
                          ? 'Подписываю…'
                          : phase === 'submitting'
                            ? 'Отправляю…'
                            : 'Ожидаю подтверждение…'
                  : 'Обменять'}
              </Button>
            )}
            {onManual ? (
              <Button
                variant="ghost"
                className="mt-1 w-full text-xs"
                onClick={onManual}
                disabled={executing || pendingSubmit}
              >
                Записать обмен вручную
              </Button>
            ) : null}
            {order ? (
              <p className="mt-2 break-all text-xs text-zinc-500">
                Ордер {order.id.slice(0, 8)} · {order.status}
                {txHash ? ` · tx ${txHash.slice(0, 12)}…` : ''}
              </p>
            ) : null}
          </div>
        </div>
      </Drawer>

      {stepUpOpen ? (
        <div className="dialog-overlay-enter fixed inset-0 z-[70] flex items-center justify-center bg-zinc-900/40 p-4">
          <div className="dialog-panel-enter w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl">
            <h3 className="text-lg font-semibold text-zinc-900">Подтвердите TOTP</h3>
            <p className="mt-1 text-sm text-zinc-500">
              Для этой суммы нужен свежий код двухфакторной аутентификации.
            </p>
            <Input
              className="mt-3 font-mono tracking-[0.3em]"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={stepUpCode}
              onChange={(event) => setStepUpCode(event.target.value.replace(/\D/g, ''))}
              aria-label="Код TOTP"
            />
            {stepUpError ? <p className="mt-2 text-sm text-red-700">{stepUpError}</p> : null}
            <div className="mt-4 flex gap-2">
              <Button onClick={() => void confirmStepUp()} disabled={stepUpCode.length !== 6}>
                Подтвердить
              </Button>
              <Button variant="ghost" onClick={cancelStepUp}>
                Отмена
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
