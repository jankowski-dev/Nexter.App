import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { TokenIcon } from '@/components/token-icon';
import {
  ApiError,
  buildSwap,
  buildSwapApproval,
  cancelSwap,
  cancelSwapSigning,
  fetchSwapConfig,
  fetchPortfolioAsset,
  fetchSwapOrder,
  fetchTradeGroup,
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
import {
  formatPct,
  formatPrice,
  formatSignedUsd,
  formatTokenAmount,
  formatUsd,
  pnlTone,
} from '@/lib/format';
import { useWallet } from '@/lib/wallet-context';
import {
  isBuildRetryable,
  isStepUpRequired,
  isSwapSettled,
  phaseAfterExecutionFailure,
} from './swap-execution';
import { Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Decimal } from 'decimal.js';
import { useDeferredValue, useEffect, useRef, useState } from 'react';
import type {
  Asset,
  SwapConfigResponse,
  SwapOrderDetail,
  SwapPreview,
  SwapQuoteRequest,
  TradeGroupDetail,
} from '@nexter/contracts';

type Mode = 'buy' | 'sell';
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

function isPositiveDecimal(value: string): boolean {
  return /^\d+(?:\.\d+)?$/.test(value) && Number(value) > 0;
}

function chainIdFor(code: 'bsc' | 'ethereum'): number {
  return code === 'ethereum' ? 1 : 56;
}

function swapTokenAddress(asset: Asset, config: SwapConfigResponse | undefined): string | null {
  const chain = config?.chains.find((item) => item.code === asset.chainCode);
  if (!chain) return null;

  if (asset.contractAddress) {
    const token = chain.tokens.find(
      (item) => !item.native && item.address.toLowerCase() === asset.contractAddress?.toLowerCase(),
    );
    return token?.address ?? null;
  }

  return chain.tokens.find((item) => item.native && item.symbol === asset.symbol)?.address ?? null;
}

function quoteAssetOptions(config: SwapConfigResponse | undefined, chainCode: string) {
  const chain = config?.chains.find((item) => item.code === chainCode);
  const stable = chain?.tokens.filter(
    (item) => !item.native && (item.symbol === 'USDC' || item.symbol === 'USDT'),
  );
  return stable && stable.length > 0
    ? stable
    : (chain?.tokens.filter((item) => !item.native) ?? []);
}

function orderPrice(order: SwapPreview | SwapOrderDetail, mode: Mode): string | null {
  try {
    if (mode === 'buy') {
      if (!order.amountOut || new Decimal(order.amountOut).lte(0)) return null;
      const usd = order.amountInUsd ? new Decimal(order.amountInUsd) : new Decimal(order.amountIn);
      return usd.div(order.amountOut).toFixed(12);
    }

    if (!order.amountIn || new Decimal(order.amountIn).lte(0)) return null;
    const usd = order.amountOutUsd ? new Decimal(order.amountOutUsd) : new Decimal(order.amountOut);
    return usd.div(order.amountIn).toFixed(12);
  } catch {
    return null;
  }
}

function priceDifference(market: string | null | undefined, kyber: string | null): number | null {
  if (!market || !kyber) return null;
  const marketValue = Number(market);
  const kyberValue = Number(kyber);
  if (!Number.isFinite(marketValue) || !Number.isFinite(kyberValue) || marketValue <= 0)
    return null;
  return ((kyberValue - marketValue) / marketValue) * 100;
}

export function TokenTradeDrawer({
  token,
  initialMode = 'buy',
  tradeGroupId: initialTradeGroupId = null,
  marketPriceUsd = null,
  onClose,
  onCompleted,
  onManual,
}: {
  token: Asset;
  initialMode?: Mode;
  tradeGroupId?: string | null;
  marketPriceUsd?: string | null;
  onClose: () => void;
  onCompleted?: () => void;
  onManual?: (input: { asset: Asset; side: Mode; tradeGroupId: string | null }) => void;
}) {
  const queryClient = useQueryClient();
  const wallet = useWallet();
  const config = useQuery({ queryKey: ['swap-config'], queryFn: fetchSwapConfig });
  const [mode, setMode] = useState<Mode>(initialMode);
  const [quoteSymbol, setQuoteSymbol] = useState('USDC');
  const [amount, setAmount] = useState('');
  const [slippageBps, setSlippageBps] = useState<number | null>(null);
  const [tradeGroupId, setTradeGroupId] = useState<string | null>(initialTradeGroupId);
  const [trade, setTrade] = useState<TradeGroupDetail | null>(null);
  const [order, setOrder] = useState<SwapOrderDetail | null>(null);
  const [, setBuild] = useState<SwapBuildResponse | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [stepUpCode, setStepUpCode] = useState('');
  const [stepUpError, setStepUpError] = useState<string | null>(null);
  const stepUpResolver = useRef<{
    resolve: () => void;
    reject: (error: Error) => void;
  } | null>(null);
  const mountedRef = useRef(true);
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

  const chainCode =
    token.chainCode === 'bsc' || token.chainCode === 'ethereum' ? token.chainCode : null;
  const chain =
    chainCode && config.data?.chains.find((item) => item.code === chainCode)
      ? config.data.chains.find((item) => item.code === chainCode)!
      : null;
  const assetAddress = swapTokenAddress(token, config.data);
  const quoteOptions = chainCode ? quoteAssetOptions(config.data, chainCode) : [];
  const quoteAsset = quoteOptions.find((item) => item.symbol === quoteSymbol) ?? quoteOptions[0];
  const quoteAddress = quoteAsset?.address ?? null;
  const tokenIn = mode === 'buy' ? quoteAddress : assetAddress;
  const tokenOut = mode === 'buy' ? assetAddress : quoteAddress;
  const allowlistRequired = config.data?.walletAllowlistConfigured ?? false;
  const previewAmount = useDeferredValue(amount);
  const pendingSubmit = phase === 'submit_failed';
  const executing = !['idle', 'success', 'submit_failed'].includes(phase);
  const closeBlocked = executing || pendingSubmit || stepUpOpen;

  const preview = useQuery({
    queryKey: [
      'token-trade-preview',
      chainCode,
      tokenIn,
      tokenOut,
      previewAmount,
      slippageBps,
      wallet.address,
    ],
    queryFn: () =>
      previewSwap({
        chain: chainCode as 'bsc' | 'ethereum',
        tokenIn: tokenIn as string,
        tokenOut: tokenOut as string,
        amountIn: previewAmount,
        slippageBps: slippageBps ?? config.data?.defaultSlippageBps ?? 50,
        walletAddress: wallet.address ?? undefined,
      }),
    enabled: Boolean(
      config.data?.enabled &&
      chainCode &&
      tokenIn &&
      tokenOut &&
      isPositiveDecimal(previewAmount) &&
      (!allowlistRequired || wallet.address) &&
      !executing &&
      !pendingSubmit,
    ),
    refetchInterval: 10_000,
    retry: false,
  });

  const fallbackMarket = useQuery({
    queryKey: ['token-market-price', token.id],
    queryFn: async () => {
      const detail = await fetchPortfolioAsset(token.id);
      return (
        detail.position?.priceUsd ?? detail.quote?.priceUsd ?? detail.prices[0]?.priceUsd ?? null
      );
    },
    refetchInterval: 15_000,
  });
  const effectiveMarketPrice = marketPriceUsd ?? fallbackMarket.data ?? null;

  const liveOrder = useQuery({
    queryKey: ['token-trade-order', order?.id],
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
      const groupId = current.tradeGroupId ?? tradeGroupId;
      if (groupId) {
        setTradeGroupId(groupId);
        void loadTrade(groupId);
      }
      void queryClient.invalidateQueries({ queryKey: ['positions'] });
      void queryClient.invalidateQueries({ queryKey: ['trade-groups'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['operations'] });
      void queryClient.invalidateQueries({ queryKey: ['portfolio-asset'] });
      onCompletedRef.current?.();
      return;
    }

    if (current.status === 'FAILED' || current.status === 'CANCELLED') {
      if (handledOrderRef.current === current.id) return;
      handledOrderRef.current = current.id;
      setPhase('idle');
      setError(`Своп ${current.status === 'FAILED' ? 'не выполнен' : 'отменён'}.`);
    }
  }, [liveOrder.data, queryClient, tradeGroupId]);

  useEffect(() => {
    if (initialTradeGroupId) void loadTrade(initialTradeGroupId);
  }, [initialTradeGroupId]);

  useEffect(() => {
    if (mode === 'sell' && trade && !amount) {
      setAmount(trade.group.remainingAmount);
    }
  }, [mode, trade, amount]);

  useEffect(() => {
    if (!tradeGroupId) return;
    const timer = window.setInterval(() => {
      void fetchTradeGroup(tradeGroupId).then((detail) => {
        if (mountedRef.current) setTrade(detail);
      });
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [tradeGroupId]);

  async function loadTrade(groupId: string): Promise<void> {
    try {
      const detail = await fetchTradeGroup(groupId);
      if (!mountedRef.current) return;
      setTrade(detail);
      setMode('sell');
      setAmount(detail.group.remainingAmount);
    } catch (err) {
      if (mountedRef.current) {
        setError(toRussianError(err, 'Не удалось загрузить данные сделки'));
      }
    }
  }

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
    if (!chainCode || !chain || !tokenIn || !tokenOut || !isPositiveDecimal(amount)) {
      setError('Заполните сумму и проверьте сеть.');
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
    if (mode === 'sell' && !tradeGroupId) {
      setError('Не выбрана сделка для продажи.');
      return;
    }

    handledOrderRef.current = null;
    setError(null);
    setPhase('quoting');
    setBuild(null);
    setTxHash(null);

    let activeOrder: SwapOrderDetail | null = null;
    let broadcastHash: string | null = null;

    try {
      const request: SwapQuoteRequest = {
        chain: chainCode,
        tokenIn,
        tokenOut,
        amountIn: amount,
        slippageBps: slippageBps ?? config.data.defaultSlippageBps,
        walletAddress: wallet.address,
        ...(mode === 'sell' && tradeGroupId ? { closeGroupIds: [tradeGroupId] } : {}),
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
      if (!mountedRef.current) return;
      setBuild(built);

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

  const isBuy = mode === 'buy';
  const assetSymbol = token.symbol;
  const quoteDisplay = quoteAsset?.symbol ?? quoteSymbol;
  const previewData = preview.data;
  const kyberPrice = previewData ? orderPrice(previewData, mode) : null;
  const difference = priceDifference(effectiveMarketPrice, kyberPrice);
  const amountOut = previewData?.amountOut;
  const minimumOut = previewData?.minOut;
  const canSubmit =
    Boolean(config.data?.enabled) &&
    Boolean(chain?.executionEnabled) &&
    Boolean(tokenIn && tokenOut) &&
    Boolean(wallet.connected) &&
    isPositiveDecimal(amount) &&
    (mode === 'buy' || Boolean(tradeGroupId)) &&
    !executing &&
    !pendingSubmit;

  return (
    <>
      <Drawer
        open
        onClose={onClose}
        closeDisabled={closeBlocked}
        title={`${isBuy ? 'Купить' : 'Продать'} ${assetSymbol}`}
        titleIcon={
          <TokenIcon logoUrl={token.logoUrl} symbol={token.symbol} className="h-7 w-7 text-xs" />
        }
        description={`${token.name} · ${token.chainCode.toUpperCase()}`}
        size="third"
        footer={
          <div className="flex w-full items-center justify-between gap-2">
            <span className="text-xs text-zinc-500">
              {phase === 'confirming'
                ? 'Ожидаю подтверждение сети…'
                : phase === 'submit_failed'
                  ? 'Подпись получена, но не отправлена'
                  : phase === 'success'
                    ? 'Сделка учтена'
                    : 'Котировка обновляется каждые 10 секунд'}
            </span>
            <Button variant="ghost" onClick={onClose} disabled={closeBlocked}>
              Готово
            </Button>
          </div>
        }
      >
        <div className="space-y-5">
          {trade ? (
            <TradeSummary trade={trade} currentPrice={effectiveMarketPrice} />
          ) : mode === 'sell' ? (
            <div className="h-24 animate-pulse rounded-xl bg-zinc-100" />
          ) : null}

          <div className="flex items-center justify-between gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
            <div>
              <div className="text-xs text-zinc-500" title="DexScreener/CoinGecko">
                Рынок
              </div>
              <div className="font-mono text-lg font-semibold text-zinc-900">
                {formatPrice(effectiveMarketPrice)}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-zinc-500">KyberSwap</div>
              <div className="font-mono text-lg font-semibold text-zinc-900">
                {kyberPrice ? formatPrice(kyberPrice) : '—'}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-zinc-500">Разница</div>
              <div className={`font-mono text-sm ${pnlTone(difference?.toString())}`}>
                {difference === null ? '—' : formatPct(difference.toFixed(2))}
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm text-zinc-600">
              {isBuy ? 'Плачу' : 'Получаю'}
              <Select
                className="mt-1"
                value={quoteSymbol}
                onChange={(event) => setQuoteSymbol(event.target.value)}
                disabled={executing}
              >
                {quoteOptions.map((item) => (
                  <option key={item.symbol} value={item.symbol}>
                    {item.symbol}
                  </option>
                ))}
              </Select>
            </label>
            <label className="block text-sm text-zinc-600">
              Сеть
              <div className="mt-1 flex h-10 items-center rounded-md border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-700">
                {chain?.name ?? '—'}
              </div>
            </label>
          </div>

          <label className="block text-sm text-zinc-600">
            {isBuy ? `Сколько ${quoteDisplay} потратить` : `Сколько ${assetSymbol} продать`}
            <Input
              className="mt-1 font-mono"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0.00"
              disabled={executing}
            />
          </label>

          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
            <div className="text-xs font-medium uppercase tracking-wide text-emerald-700">
              {isBuy ? `Получите ${assetSymbol}` : `Получите ${quoteDisplay}`}
            </div>
            <div className="mt-1 font-mono text-2xl font-semibold text-emerald-900">
              {amountOut ? `${formatTokenAmount(amountOut, 8)}` : '—'}
            </div>
            {minimumOut ? (
              <div className="mt-1 text-xs text-emerald-700">
                Минимум с учётом проскальзывания: {formatTokenAmount(minimumOut, 8)}
              </div>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-lg border border-zinc-200 p-2">
              <div className="text-xs text-zinc-500">Газ</div>
              <div className="font-mono text-zinc-800">
                {previewData?.gasUsd ? formatUsd(previewData.gasUsd) : '—'}
              </div>
            </div>
            <div className="rounded-lg border border-zinc-200 p-2">
              <div className="text-xs text-zinc-500">Price impact</div>
              <div className="font-mono text-zinc-800">
                {previewData?.priceImpactBps == null
                  ? '—'
                  : formatPct((previewData.priceImpactBps / 100).toFixed(2))}
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
            <div className="rounded-lg border border-zinc-200 p-2">
              <div className="text-xs text-zinc-500">Остаток</div>
              <div className="font-mono text-zinc-800">
                {trade
                  ? `${formatTokenAmount(trade.group.remainingAmount, 8)} ${assetSymbol}`
                  : '—'}
              </div>
            </div>
          </div>

          {!wallet.connected ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              Подключите кошелёк в шапке, чтобы подписать сделку.
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
              On-chain исполнение для этой сети выключено. Используйте ручной ввод в разделе
              «Сделки».
            </div>
          ) : null}

          {config.data && chainCode && !assetAddress ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              Токен не входит в on-chain allowlist. Доступна только ручная запись сделки.
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
              {mode === 'buy' ? 'Покупка учтена.' : 'Продажа учтена.'}{' '}
              {trade
                ? trade.group.status === 'closed'
                  ? 'Позиция закрыта.'
                  : `Остаток: ${formatTokenAmount(trade.group.remainingAmount, 8)} ${assetSymbol}.`
                : 'Операция записана в журнал.'}
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
            ) : mode === 'sell' && trade && trade.group.status === 'closed' ? (
              <Button
                className="w-full"
                onClick={() => {
                  setMode('buy');
                  setTradeGroupId(null);
                  setTrade(null);
                  setAmount('');
                  setPhase('idle');
                }}
              >
                Купить ещё
              </Button>
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
                  : isBuy
                    ? `Купить ${assetSymbol}`
                    : `Продать ${assetSymbol}`}
              </Button>
            )}

            {onManual ? (
              <Button
                variant="ghost"
                className="mt-1 w-full text-xs"
                onClick={() => onManual({ asset: token, side: mode, tradeGroupId })}
                disabled={executing || pendingSubmit}
              >
                Записать {isBuy ? 'покупку' : 'продажу'} вручную
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

function TradeSummary({
  trade,
  currentPrice,
}: {
  trade: TradeGroupDetail;
  currentPrice: string | null | undefined;
}) {
  const group = trade.group;
  const originalAmount =
    trade.lots.reduce((total, lot) => total.plus(lot.amount), new Decimal(0)) || new Decimal(0);
  const buyPrice = originalAmount.gt(0) ? new Decimal(group.buyUsd).div(originalAmount) : null;
  const pnl = group.totalPnlUsd;

  return (
    <div className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold text-zinc-900">Текущая сделка</div>
        <Badge tone={group.status === 'closed' ? 'neutral' : 'info'}>
          {group.status === 'closed' ? 'Закрыта' : 'Открыта'}
        </Badge>
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div>
          <div className="text-xs text-zinc-500">Куплено по</div>
          <div className="font-mono text-zinc-900">
            {buyPrice ? formatPrice(buyPrice.toFixed(12)) : '—'}
          </div>
        </div>
        <div>
          <div className="text-xs text-zinc-500">Сейчас</div>
          <div className="font-mono text-zinc-900">{formatPrice(currentPrice)}</div>
        </div>
        <div>
          <div className="text-xs text-zinc-500">Остаток</div>
          <div className="font-mono text-zinc-900">
            {formatTokenAmount(group.remainingAmount, 8)} {group.asset.symbol}
          </div>
        </div>
        <div>
          <div className="text-xs text-zinc-500">P&L</div>
          <div className={`font-mono font-semibold ${pnlTone(pnl)}`}>{formatSignedUsd(pnl)}</div>
        </div>
      </div>
      <Button variant="ghost" className="h-8 px-2 text-xs" asChild>
        <Link to="/trades/$tradeId" params={{ tradeId: group.id }}>
          Полная карточка
        </Link>
      </Button>
    </div>
  );
}
