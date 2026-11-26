import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { TokenIcon } from '@/components/token-icon';
import { BnbIcon, EthIcon } from '@/components/chain-toggle';
import {
  ApiError,
  buildSwap,
  buildSwapApproval,
  cancelSwap,
  createPendingOrder,
  cancelSwapSigning,
  fetchSwapBalances,
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
  updateTradeGroupProtection,
  type SwapBuildResponse,
} from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import { useConfirm } from '@/lib/confirm';
import {
  formatDate,
  formatPct,
  formatPrice,
  formatSignedUsd,
  formatTokenAmount,
  formatUsd,
  normalizeDecimalInput,
  pnlTone,
} from '@/lib/format';
import { useWallet } from '@/lib/wallet-context';
import { useRuntimeSettings } from '../settings/use-settings';
import { ManualOrderForm } from './manual-order-form';
import { StablecoinSelect } from './stablecoin-select';
import {
  isBuildRetryable,
  isStepUpRequired,
  isSwapSettled,
  phaseAfterExecutionFailure,
} from './swap-execution';
import {
  isTransactionHash,
  trackWalletRequest,
  WALLET_RESPONSE_TIMEOUT_MS,
  type TrackedWalletRequest,
} from './wallet-request';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Decimal } from 'decimal.js';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { useCallback, useEffect, useRef, useState } from 'react';
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
  | 'wallet_stalled'
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
}: {
  token: Asset;
  initialMode?: Mode;
  tradeGroupId?: string | null;
  marketPriceUsd?: string | null;
  onClose: () => void;
  onCompleted?: () => void;
}) {
  const queryClient = useQueryClient();
  const wallet = useWallet();
  const confirm = useConfirm();
  const config = useQuery({ queryKey: ['swap-config'], queryFn: fetchSwapConfig });
  const balances = useQuery({
    queryKey: ['swap-balances', wallet.chain, wallet.address],
    queryFn: () => fetchSwapBalances({ chain: wallet.chain, wallet: wallet.address as string }),
    enabled: Boolean(wallet.connected && wallet.address),
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: false,
  });
  const balanceBySymbol = new Map(
    (balances.data?.balances ?? []).map((item) => [item.symbol, item.balance]),
  );
  const runtime = useRuntimeSettings();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [channel, setChannel] = useState<'onchain' | 'manual'>('onchain');
  const [stopLossPct, setStopLossPct] = useState(String(runtime.tradeDefaultStopLossPct));
  const [takeProfitPct, setTakeProfitPct] = useState(String(runtime.tradeDefaultTakeProfitPct));
  const [delayed, setDelayed] = useState(false);
  const [delayedAmountUsd, setDelayedAmountUsd] = useState(runtime.tradeDefaultBuyAmountUsd);
  const [delayedTriggerPrice, setDelayedTriggerPrice] = useState('');
  const [delayedQuantity, setDelayedQuantity] = useState('');
  const [manualQuoteAmount, setManualQuoteAmount] = useState('');
  const delayedLastEdited = useRef<'price' | 'quantity' | 'amount'>('price');
  const [manualPending, setManualPending] = useState(false);
  const [quoteSymbol, setQuoteSymbol] = useState('USDC');
  const [amount, setAmount] = useState('');
  const [slippageBps, setSlippageBps] = useState<number | null>(null);
  const [tradeGroupId, setTradeGroupId] = useState<string | null>(initialTradeGroupId);
  const [trade, setTrade] = useState<TradeGroupDetail | null>(null);
  const [order, setOrder] = useState<SwapOrderDetail | null>(null);
  const [, setBuild] = useState<SwapBuildResponse | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [stalledKind, setStalledKind] = useState<'approval' | 'swap'>('swap');
  const [manualHash, setManualHash] = useState('');
  const [manualHashError, setManualHashError] = useState<string | null>(null);
  const walletRequestRef = useRef<TrackedWalletRequest | null>(null);
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
  const cancelWaitRef = useRef(false);

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
  const onchainConfigured = Boolean(config.data?.enabled && assetAddress);
  const onchainReason = !config.data?.enabled
    ? 'Ончейн-свопы отключены на сервере'
    : !chain
      ? `Сеть ${token.chainCode} не поддерживается для ончейн-свопов`
      : !token.contractAddress
        ? 'У токена не указан контракт — ончейн-своп невозможен'
        : !assetAddress
          ? 'Токен ещё не в swap-allowlist. Проверьте группу «Избранное», переключатель «Ончейн-свопы» и подождите до минуты.'
          : null;
  const quoteOptions = chainCode ? quoteAssetOptions(config.data, chainCode) : [];
  const quoteAsset = quoteOptions.find((item) => item.symbol === quoteSymbol) ?? quoteOptions[0];
  const quoteAddress = quoteAsset?.address ?? null;
  const tokenIn = mode === 'buy' ? quoteAddress : assetAddress;
  const tokenOut = mode === 'buy' ? assetAddress : quoteAddress;
  const explorerUrl = wallet.address
    ? chainCode === 'ethereum'
      ? `https://etherscan.io/address/${wallet.address}`
      : `https://bscscan.com/address/${wallet.address}`
    : null;
  const allowlistRequired = config.data?.walletAllowlistConfigured ?? false;
  const previewAmount = useDebouncedValue(amount, 500);
  const remainingForSell =
    mode === 'sell' && trade ? new Decimal(trade.group.remainingAmount) : null;
  const enteredAmount = isPositiveDecimal(amount) ? new Decimal(amount) : null;
  const sellExceedsRemaining = Boolean(
    remainingForSell && enteredAmount && enteredAmount.gt(remainingForSell),
  );
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
        ...(mode === 'buy'
          ? {
              stopLossPct: stopLossPct.trim() ? Number(stopLossPct) : null,
              takeProfitPct: takeProfitPct.trim() ? Number(takeProfitPct) : null,
            }
          : {}),
      }),
    enabled: Boolean(
      channel === 'onchain' &&
      config.data?.enabled &&
      chainCode &&
      tokenIn &&
      tokenOut &&
      isPositiveDecimal(previewAmount) &&
      !sellExceedsRemaining &&
      (!allowlistRequired || wallet.address) &&
      !executing &&
      !pendingSubmit,
    ),
    refetchInterval: 30_000,
    staleTime: 10_000,
    refetchOnWindowFocus: false,
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
      void queryClient.invalidateQueries({ queryKey: ['portfolio-token-summaries'] });
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
      setAmount(normalizeDecimalInput(trade.group.remainingAmount));
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

  useEffect(() => {
    if (!config.isPending && !onchainConfigured) setChannel('manual');
  }, [config.isPending, onchainConfigured]);

  async function loadTrade(groupId: string): Promise<void> {
    try {
      const detail = await fetchTradeGroup(groupId);
      if (!mountedRef.current) return;
      setTrade(detail);
      setMode('sell');
      setAmount(normalizeDecimalInput(detail.group.remainingAmount));
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

  async function walletHash(request: Promise<string>, kind: 'approval' | 'swap'): Promise<string> {
    const tracked = trackWalletRequest(request, {
      timeoutMs: WALLET_RESPONSE_TIMEOUT_MS,
      onStalled: () => {
        if (!mountedRef.current) return;
        setStalledKind(kind);
        setManualHashError(null);
        setPhase('wallet_stalled');
      },
    });
    walletRequestRef.current = tracked;

    try {
      const outcome = await tracked.outcome;
      if (outcome.status === 'error') throw outcome.error;
      return outcome.hash;
    } finally {
      if (walletRequestRef.current === tracked) walletRequestRef.current = null;
    }
  }

  function applyManualHash(): void {
    const hash = manualHash.trim();
    if (!isTransactionHash(hash)) {
      setManualHashError('Введите хеш транзакции: 0x и 64 hex-символа.');
      return;
    }
    if (!walletRequestRef.current) {
      setManualHashError('Ожидание уже завершено. Обновите страницу и проверьте ордер.');
      return;
    }

    setManualHashError(null);
    setManualHash('');
    walletRequestRef.current.submitManualHash(hash);
    setPhase(stalledKind === 'approval' ? 'approval' : 'submitting');
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
    cancelWaitRef.current = false;
    walletRequestRef.current = null;
    setManualHash('');
    setManualHashError(null);
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
        ...(mode === 'buy'
          ? {
              stopLossPct: stopLossPct.trim() ? Number(stopLossPct) : null,
              takeProfitPct: takeProfitPct.trim() ? Number(takeProfitPct) : null,
            }
          : {}),
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
            approvalHash = await walletHash(
              wallet.sendTransaction({
                chainId: chainIdFor(quoted.chain as 'bsc' | 'ethereum'),
                to: prepared.to,
                data: prepared.calldata,
                value: prepared.value,
                gas: prepared.gasLimit ?? undefined,
              }),
              'approval',
            );
          } catch (err) {
            await cancelSwap(quoted.id).catch(() => undefined);
            throw err;
          }

          cancelWaitRef.current = false;
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
        hash = await walletHash(
          wallet.sendTransaction({
            chainId: chainIdFor(quoted.chain as 'bsc' | 'ethereum'),
            to: built.routerAddress,
            data: built.calldata,
            value: built.transactionValue ?? '0',
            gas: built.gasLimit ?? undefined,
          }),
          'swap',
        );
      } catch (err) {
        await cancelSwapSigning(quoted.id).catch(() => undefined);
        throw err;
      }

      cancelWaitRef.current = false;
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

  async function cancelWalletWait(): Promise<void> {
    if (
      !(await confirm({
        title: 'Отменить ожидание кошелька?',
        description:
          'Подтвердите, только если запрос отклонён в кошельке. Если транзакция уже подписана, не отменяйте ожидание.',
        confirmLabel: 'Отменить ожидание',
        variant: 'danger',
      }))
    ) {
      return;
    }

    cancelWaitRef.current = true;
    setManualHash('');
    setManualHashError(null);
    setPhase('idle');
    setError('Ожидание ответа кошелька отменено. Если запрос ещё висит в кошельке, отклоните его.');

    // A signature request has not broadcast anything yet, so it is safe to put the
    // order back to READY. An approval request may already be broadcast; leave it
    // alone and let the wallet response (or expiry/supersede) decide.
    if (order && (phase === 'signing' || (phase === 'wallet_stalled' && stalledKind === 'swap'))) {
      await cancelSwapSigning(order.id).catch(() => undefined);
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
  const previewStale = previewAmount !== amount;
  const showPreview = !sellExceedsRemaining && !previewStale;
  const amountOut = showPreview ? previewData?.amountOut : undefined;
  const minimumOut = showPreview ? previewData?.minOut : undefined;
  const sellCostBasis =
    remainingForSell && enteredAmount && remainingForSell.gt(0) && trade
      ? new Decimal(trade.group.remainingCostBasisUsd).mul(enteredAmount).div(remainingForSell)
      : null;
  const sellProceedsUsd = showPreview
    ? previewData
      ? previewData.amountOutUsd
        ? new Decimal(previewData.amountOutUsd)
        : new Decimal(previewData.amountOut)
      : enteredAmount && effectiveMarketPrice
        ? enteredAmount.mul(effectiveMarketPrice)
        : null
    : null;
  const sellPnl =
    !isBuy && sellCostBasis && sellProceedsUsd ? sellProceedsUsd.minus(sellCostBasis) : null;
  const canSubmit =
    Boolean(config.data?.enabled) &&
    Boolean(chain?.executionEnabled) &&
    Boolean(tokenIn && tokenOut) &&
    Boolean(wallet.connected) &&
    isPositiveDecimal(amount) &&
    !sellExceedsRemaining &&
    (mode === 'buy' || Boolean(tradeGroupId)) &&
    !executing &&
    !pendingSubmit;

  function quantityFor(amountUsd: string, price: string): string {
    if (!isPositiveDecimal(amountUsd) || !isPositiveDecimal(price)) return '';
    return normalizeDecimalInput(new Decimal(amountUsd).div(price).toFixed(8));
  }

  function priceFor(amountUsd: string, quantity: string): string {
    if (!isPositiveDecimal(amountUsd) || !isPositiveDecimal(quantity)) return '';
    return normalizeDecimalInput(new Decimal(amountUsd).div(quantity).toFixed(12));
  }

  function changeDelayedAmount(value: string): void {
    setDelayedAmountUsd(value);
    if (delayedLastEdited.current === 'quantity' && delayedQuantity) {
      setDelayedTriggerPrice(priceFor(value, delayedQuantity));
    } else if (delayedTriggerPrice) {
      setDelayedQuantity(quantityFor(value, delayedTriggerPrice));
    }
  }

  function changeDelayedPrice(value: string): void {
    setDelayedTriggerPrice(value);
    delayedLastEdited.current = 'price';
    setDelayedQuantity(quantityFor(delayedAmountUsd, value));
  }

  function changeDelayedQuantity(value: string): void {
    setDelayedQuantity(value);
    delayedLastEdited.current = 'quantity';
    setDelayedTriggerPrice(priceFor(delayedAmountUsd, value));
  }

  const buyAmountUsd = delayed
    ? Number(delayedAmountUsd)
    : channel === 'manual'
      ? Number(manualQuoteAmount)
      : previewData?.amountInUsd
        ? Number(previewData.amountInUsd)
        : Number(amount);

  function buyTargetHint(pct: string, direction: 1 | -1): string | undefined {
    const value = Number(pct);
    if (!effectiveMarketPrice || !pct.trim() || !Number.isFinite(value) || value <= 0) {
      return undefined;
    }
    const target = new Decimal(effectiveMarketPrice).mul(1 + (direction * value) / 100);
    const result =
      Number.isFinite(buyAmountUsd) && buyAmountUsd > 0 ? buyAmountUsd * (value / 100) : null;
    return `Цель ${formatPrice(target.toFixed(18))}${
      result !== null ? ` · ${direction > 0 ? '+' : '−'}${formatUsd(result.toFixed(2))}` : ''
    }`;
  }

  const delayedDiff =
    isPositiveDecimal(delayedTriggerPrice) && effectiveMarketPrice
      ? new Decimal(delayedTriggerPrice).div(effectiveMarketPrice).minus(1).times(100)
      : null;

  const createPendingMutation = useMutation({
    mutationFn: () =>
      createPendingOrder({
        assetId: token.id,
        amountUsd: delayedAmountUsd,
        triggerPriceUsd: delayedTriggerPrice,
        stopLossPct: stopLossPct.trim() ? Number(stopLossPct) : null,
        takeProfitPct: takeProfitPct.trim() ? Number(takeProfitPct) : null,
      }),
    onSuccess: () => {
      onCompletedRef.current?.();
      onClose();
    },
    onError: (err) => setError(toRussianError(err, 'Не удалось создать отложенную покупку')),
  });

  return (
    <>
      <Drawer
        open
        onClose={onClose}
        closeDisabled={closeBlocked}
        title={
          delayed
            ? `Отложенная покупка · ${assetSymbol}`
            : `${isBuy ? 'Создание ордера' : 'Закрытие ордера'} · ${assetSymbol}`
        }
        titleIcon={
          <TokenIcon logoUrl={token.logoUrl} symbol={token.symbol} className="h-7 w-7 text-xs" />
        }
        description={`${token.name} · ${token.chainCode.toUpperCase()}`}
        size="third"
        footer={
          delayed ? (
            <div className="flex w-full flex-wrap items-center justify-end gap-2">
              <Button variant="secondary" onClick={onClose}>
                Отмена
              </Button>
              <Button
                onClick={() => createPendingMutation.mutate()}
                disabled={
                  createPendingMutation.isPending ||
                  !isPositiveDecimal(delayedAmountUsd) ||
                  !isPositiveDecimal(delayedTriggerPrice)
                }
              >
                {createPendingMutation.isPending ? 'Создаю…' : 'Создать отложенную покупку'}
              </Button>
            </div>
          ) : channel === 'manual' ? (
            <div className="flex w-full flex-wrap items-center justify-end gap-2">
              <Button variant="secondary" onClick={onClose} disabled={manualPending}>
                Отмена
              </Button>
              <Button type="submit" form="manual-order-form" disabled={manualPending}>
                {manualPending ? 'Сохраняю…' : isBuy ? 'Сохранить покупку' : 'Сохранить продажу'}
              </Button>
            </div>
          ) : (
            <div className="w-full">
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
              ) : phase === 'success' ? (
                <div className="flex w-full justify-end">
                  <Button onClick={onClose}>Готово</Button>
                </div>
              ) : (
                <div className="flex w-full flex-wrap items-center justify-between gap-2">
                  <Button variant="secondary" onClick={onClose} disabled={closeBlocked}>
                    Отмена
                  </Button>
                  <Button className="flex-1" onClick={() => void execute()} disabled={!canSubmit}>
                    {executing
                      ? phase === 'quoting'
                        ? 'Получаю котировку…'
                        : phase === 'building'
                          ? 'Проверяю сборку…'
                          : phase === 'approval'
                            ? 'Подтверждаю approval…'
                            : phase === 'signing'
                              ? 'Подписываю…'
                              : phase === 'wallet_stalled'
                                ? 'Ожидаю хеш…'
                                : phase === 'submitting'
                                  ? 'Отправляю…'
                                  : 'Ожидаю подтверждение…'
                      : isBuy
                        ? `Купить ${assetSymbol}`
                        : `Продать ${assetSymbol}`}
                  </Button>
                </div>
              )}
            </div>
          )
        }
      >
        <div className="space-y-5">
          {trade ? (
            <>
              <TradeSummary trade={trade} currentPrice={effectiveMarketPrice} />
              <ProtectionEditor
                trade={trade}
                currentPrice={effectiveMarketPrice}
                onUpdated={setTrade}
              />
            </>
          ) : mode === 'sell' ? (
            <div className="h-24 animate-pulse rounded-xl bg-zinc-100" />
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2">
            <div>
              <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                Рынок
              </div>
              <div className="font-mono text-lg font-semibold text-zinc-900">
                {formatPrice(effectiveMarketPrice)}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] text-zinc-500">KyberSwap</div>
              <div className="font-mono text-sm font-semibold text-zinc-900">
                {kyberPrice ? formatPrice(kyberPrice) : '—'}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] text-zinc-500">Разница</div>
              <div className={`font-mono text-sm ${pnlTone(difference?.toString())}`}>
                {difference === null ? '—' : formatPct(difference.toFixed(2))}
              </div>
            </div>
          </div>

          {isBuy ? (
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                    Защита и отложенная покупка
                  </div>
                  <div className="text-[11px] text-zinc-500">
                    Только для этого ордера. Пустые поля отключают защиту.
                  </div>
                </div>
                <label className="flex items-center gap-2 text-xs text-zinc-700">
                  <input
                    type="checkbox"
                    checked={delayed}
                    onChange={(event) => setDelayed(event.target.checked)}
                  />
                  Отложенная покупка
                </label>
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <ProtectionInputCard
                  tone="sky"
                  title="Тейк-профит"
                  value={takeProfitPct}
                  onChange={setTakeProfitPct}
                  direction={1}
                  hint={buyTargetHint(takeProfitPct, 1)}
                />
                <ProtectionInputCard
                  tone="rose"
                  title="Стоп-лосс"
                  value={stopLossPct}
                  onChange={setStopLossPct}
                  direction={-1}
                  hint={buyTargetHint(stopLossPct, -1)}
                />
              </div>
              {delayed ? (
                <div className="mt-2 space-y-2 rounded-lg border border-zinc-200 bg-white/70 p-2">
                  <div className="grid gap-2 sm:grid-cols-3">
                    <label className="text-[11px] text-zinc-600">
                      Сумма, USD
                      <Input
                        className="mt-1 h-8 text-xs"
                        inputMode="decimal"
                        value={delayedAmountUsd}
                        onChange={(event) => changeDelayedAmount(event.target.value)}
                      />
                    </label>
                    <label className="text-[11px] text-zinc-600">
                      Цена покупки
                      <Input
                        className="mt-1 h-8 text-xs"
                        inputMode="decimal"
                        value={delayedTriggerPrice}
                        onChange={(event) => changeDelayedPrice(event.target.value)}
                      />
                    </label>
                    <label className="text-[11px] text-zinc-600">
                      Количество {assetSymbol}
                      <Input
                        className="mt-1 h-8 text-xs"
                        inputMode="decimal"
                        value={delayedQuantity}
                        onChange={(event) => changeDelayedQuantity(event.target.value)}
                      />
                    </label>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-500">
                    <span>Текущий курс: {formatPrice(effectiveMarketPrice)}</span>
                    {delayedDiff !== null ? (
                      <span className={pnlTone(delayedDiff.toString())}>
                        К рынку: {formatPct(delayedDiff.toFixed(2))}
                      </span>
                    ) : null}
                    {delayedQuantity ? (
                      <span>
                        Получите ~{delayedQuantity} {assetSymbol}
                      </span>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {delayed ? null : (
            <TradeChannelTabs
              value={channel}
              onChange={setChannel}
              disabled={executing || pendingSubmit || manualPending}
              onchainConfigured={onchainConfigured}
              onchainReason={onchainReason}
            />
          )}

          <div className={!delayed && channel === 'onchain' ? 'space-y-5' : 'hidden'}>
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <label className="block text-sm text-zinc-600">
                {isBuy ? `Сколько ${quoteDisplay} потратить` : `Сколько ${assetSymbol} продать`}
                <Input
                  className="mt-1 font-mono"
                  inputMode="decimal"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder="0.00"
                  disabled={executing}
                  aria-invalid={sellExceedsRemaining}
                />
                {!isBuy && remainingForSell ? (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {[10, 25, 50, 100].map((pct) => (
                      <button
                        key={pct}
                        type="button"
                        className="rounded-md border border-zinc-200 bg-white px-1.5 py-0.5 text-[10px] text-zinc-600 hover:border-emerald-300 hover:text-emerald-700"
                        onClick={() =>
                          setAmount(
                            normalizeDecimalInput(remainingForSell.mul(pct).div(100).toFixed(8)),
                          )
                        }
                        disabled={executing}
                      >
                        {pct}%
                      </button>
                    ))}
                  </div>
                ) : null}
                {sellExceedsRemaining && trade ? (
                  <p className="mt-1 text-xs text-red-700">
                    Нельзя продать больше остатка:{' '}
                    {formatTokenAmount(trade.group.remainingAmount, 8)} {assetSymbol}.
                  </p>
                ) : null}
              </label>
              <div className="block text-sm text-zinc-600">
                {isBuy ? 'Плачу' : 'Получаю'}
                <StablecoinSelect
                  options={quoteOptions}
                  value={quoteDisplay}
                  onChange={setQuoteSymbol}
                  balances={balanceBySymbol}
                  disabled={executing}
                />
              </div>
              <div className="block text-sm text-zinc-600">
                Сеть
                <div
                  className="mt-1 flex h-10 w-10 items-center justify-center rounded-md border border-zinc-200 bg-zinc-50"
                  title={chain?.name ?? 'Сеть'}
                  role="img"
                  aria-label={chain?.name ?? 'Сеть'}
                >
                  {chainCode === 'bsc' ? (
                    <BnbIcon />
                  ) : chainCode === 'ethereum' ? (
                    <EthIcon />
                  ) : (
                    <span className="text-[10px] text-zinc-400">—</span>
                  )}
                </div>
              </div>
            </div>

            <div className={`grid gap-2 ${!isBuy ? 'sm:grid-cols-2' : ''}`}>
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
              {!isBuy ? (
                <div
                  className={`rounded-xl border p-3 ${
                    sellPnl?.gt(0)
                      ? 'border-emerald-200 bg-emerald-50'
                      : sellPnl?.lt(0)
                        ? 'border-red-200 bg-red-50'
                        : 'border-zinc-200 bg-zinc-50'
                  }`}
                >
                  <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                    P&L по продаже
                  </div>
                  <div
                    className={`mt-1 font-mono text-2xl font-semibold ${
                      sellPnl?.gt(0)
                        ? 'text-emerald-900'
                        : sellPnl?.lt(0)
                          ? 'text-red-900'
                          : 'text-zinc-800'
                    }`}
                  >
                    {sellPnl ? formatSignedUsd(sellPnl.toFixed(2)) : '—'}
                  </div>
                  <div className="mt-1 text-xs text-zinc-500">
                    Вложено:{' '}
                    {showPreview && sellCostBasis ? formatUsd(sellCostBasis.toFixed(2)) : '—'}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <div className="rounded-lg border border-zinc-200 p-2">
                <div className="text-[10px] text-zinc-500">Газ</div>
                <div className="font-mono text-xs text-zinc-800">
                  {previewData?.gasUsd ? formatUsd(previewData.gasUsd) : '—'}
                </div>
              </div>
              <div className="rounded-lg border border-zinc-200 p-2">
                <div className="text-[10px] text-zinc-500">Price impact</div>
                <div className="font-mono text-xs text-zinc-800">
                  {previewData?.priceImpactBps == null
                    ? '—'
                    : formatPct((previewData.priceImpactBps / 100).toFixed(2))}
                </div>
              </div>
              <div className="rounded-lg border border-zinc-200 p-2">
                <div className="text-[10px] text-zinc-500">Проскальзывание</div>
                <Select
                  className="mt-1 h-8 border-0 bg-transparent px-0 pr-6 font-mono text-xs"
                  value={String(slippageBps ?? config.data?.defaultSlippageBps ?? 50)}
                  onChange={(event) => setSlippageBps(Number(event.target.value))}
                  disabled={executing}
                >
                  {Array.from(new Set([config.data?.defaultSlippageBps ?? 50, 10, 50, 100, 200]))
                    .filter((value) => value <= (config.data?.maxSlippageBps ?? 200))
                    .sort((left, right) => left - right)
                    .map((value) => (
                      <option key={value} value={value}>
                        {(value / 100).toFixed(2)}%
                      </option>
                    ))}
                </Select>
              </div>
              <div className="rounded-lg border border-zinc-200 p-2">
                <div className="text-[10px] text-zinc-500">{isBuy ? 'Мин. выход' : 'Остаток'}</div>
                <div className="font-mono text-xs text-zinc-800">
                  {isBuy
                    ? minimumOut
                      ? `${formatTokenAmount(minimumOut, 8)} ${assetSymbol}`
                      : '—'
                    : trade
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
                <p>On-chain исполнение для этой сети выключено. Используйте вкладку «Вручную».</p>
                <Button
                  className="mt-2 h-8 px-3 text-xs"
                  variant="secondary"
                  onClick={() => setChannel('manual')}
                >
                  Перейти к ручному вводу
                </Button>
              </div>
            ) : null}

            {config.data && chainCode && !assetAddress ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <p>Токен не входит в on-chain allowlist. Доступна вкладка «Вручную».</p>
                <Button
                  className="mt-2 h-8 px-3 text-xs"
                  variant="secondary"
                  onClick={() => setChannel('manual')}
                >
                  Перейти к ручному вводу
                </Button>
              </div>
            ) : null}

            {preview.isError ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <p>{toRussianError(preview.error, 'Не удалось получить котировку')}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    className="h-8 px-3 text-xs"
                    variant="secondary"
                    onClick={() => void preview.refetch()}
                    disabled={preview.isFetching}
                  >
                    {preview.isFetching ? 'Обновляю…' : 'Обновить котировку'}
                  </Button>
                  <Button
                    className="h-8 px-3 text-xs"
                    variant="ghost"
                    onClick={() => setChannel('manual')}
                  >
                    Ручной ввод
                  </Button>
                </div>
              </div>
            ) : null}

            {error ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            ) : null}

            {phase === 'wallet_stalled' ? (
              <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <p>
                  {stalledKind === 'approval'
                    ? 'Кошелёк не вернул хеш approval.'
                    : 'Кошелёк не вернул хеш транзакции.'}{' '}
                  Если операция уже прошла, вставьте её хеш — ордер будет учтён.
                </p>
                <Input
                  value={manualHash}
                  onChange={(event) => {
                    setManualHash(event.target.value);
                    setManualHashError(null);
                  }}
                  placeholder="0x…"
                  className="h-9 font-mono text-xs"
                  aria-invalid={Boolean(manualHashError)}
                  autoComplete="off"
                  spellCheck={false}
                />
                {manualHashError ? <p className="text-xs text-red-700">{manualHashError}</p> : null}
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="secondary"
                    className="h-8 px-3 text-xs"
                    onClick={applyManualHash}
                    disabled={!manualHash.trim()}
                  >
                    Учесть хеш
                  </Button>
                  {explorerUrl ? (
                    <a
                      href={explorerUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs font-medium text-emerald-700 underline-offset-2 hover:underline"
                    >
                      История кошелька
                    </a>
                  ) : null}
                  <Button
                    variant="ghost"
                    className="h-8 px-3 text-xs"
                    onClick={() => void cancelWalletWait()}
                  >
                    Я отклонил запрос
                  </Button>
                </div>
                <p className="text-xs text-amber-700">
                  Не отправляйте новую транзакцию, пока не проверите историю кошелька: подпись могла
                  уже пройти.
                </p>
              </div>
            ) : phase === 'signing' || phase === 'approval' ? (
              <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <p>Ожидаю ответ кошелька. Если вы отклонили запрос, нажмите «Отменить ожидание».</p>
                <Button
                  variant="secondary"
                  className="h-8 px-3 text-xs"
                  onClick={() => void cancelWalletWait()}
                >
                  Отменить ожидание
                </Button>
              </div>
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
          </div>

          <div className={!delayed && channel === 'manual' ? '' : 'hidden'}>
            <ManualOrderForm
              key={`${mode}-${token.id}-${tradeGroupId ?? 'new'}`}
              token={token}
              side={mode}
              trade={trade}
              marketPriceUsd={effectiveMarketPrice}
              onSaved={() => onCompletedRef.current?.()}
              onClose={onClose}
              onPendingChange={setManualPending}
              stopLossPct={stopLossPct.trim() ? Number(stopLossPct) : null}
              takeProfitPct={takeProfitPct.trim() ? Number(takeProfitPct) : null}
              onQuoteAmountChange={setManualQuoteAmount}
            />
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

function TradeChannelTabs({
  value,
  onChange,
  disabled,
  onchainConfigured,
  onchainReason,
}: {
  value: 'onchain' | 'manual';
  onChange: (value: 'onchain' | 'manual') => void;
  disabled: boolean;
  onchainConfigured: boolean;
  onchainReason: string | null;
}) {
  return (
    <div
      className="flex gap-1 rounded-xl border border-zinc-200 bg-zinc-50 p-1"
      role="tablist"
      aria-label="Способ сделки"
    >
      <button
        type="button"
        role="tab"
        aria-selected={value === 'onchain'}
        disabled={disabled}
        title={onchainConfigured ? undefined : (onchainReason ?? 'On-chain исполнение недоступно')}
        onClick={() => onChange('onchain')}
        className={`flex-1 rounded-lg px-3 py-1.5 text-sm ${
          value === 'onchain'
            ? 'bg-white font-medium text-zinc-900 shadow-sm'
            : 'text-zinc-500 hover:text-zinc-900'
        }`}
      >
        Ончейн
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={value === 'manual'}
        disabled={disabled}
        onClick={() => onChange('manual')}
        className={`flex-1 rounded-lg px-3 py-1.5 text-sm ${
          value === 'manual'
            ? 'bg-white font-medium text-zinc-900 shadow-sm'
            : 'text-zinc-500 hover:text-zinc-900'
        }`}
      >
        Вручную
      </button>
    </div>
  );
}

function ProtectionInputCard({
  tone,
  title,
  value,
  onChange,
  onBlur,
  direction,
  hint,
}: {
  tone: 'sky' | 'rose';
  title: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  direction: 1 | -1;
  hint?: string;
}) {
  const styles =
    tone === 'sky'
      ? {
          card: 'border-sky-200 bg-sky-50/70',
          label: 'text-sky-800',
          button: 'border-sky-200 text-sky-800 hover:bg-sky-100',
          hint: 'text-sky-800/70',
        }
      : {
          card: 'border-red-200 bg-red-50/70',
          label: 'text-red-800',
          button: 'border-red-200 text-red-800 hover:bg-red-100',
          hint: 'text-red-800/70',
        };

  return (
    <div className={`rounded-xl border p-2.5 ${styles.card}`}>
      <div className="flex items-center justify-between gap-2">
        <div className={`text-[11px] font-semibold uppercase tracking-wide ${styles.label}`}>
          {title}
        </div>
        <span className={`text-[10px] ${styles.hint}`}>%</span>
      </div>
      <Input
        className="mt-1 h-8 text-xs"
        type="number"
        min={1}
        placeholder="не задан"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
      />
      <div className="mt-1.5 flex flex-wrap gap-1">
        {[5, 10, 20, 50].map((pct) => (
          <button
            key={pct}
            type="button"
            className={`rounded-md border bg-white/60 px-1.5 py-0.5 text-[10px] font-medium ${styles.button}`}
            onClick={() => onChange(String(pct))}
          >
            {direction > 0 ? '+' : '−'}
            {pct}%
          </button>
        ))}
      </div>
      {hint ? <div className={`mt-1 text-[10px] ${styles.hint}`}>{hint}</div> : null}
    </div>
  );
}

function ProtectionEditor({
  trade,
  currentPrice,
  onUpdated,
}: {
  trade: TradeGroupDetail;
  currentPrice: string | null | undefined;
  onUpdated: (trade: TradeGroupDetail) => void;
}) {
  const queryClient = useQueryClient();
  const group = trade.group;
  const [stopPct, setStopPct] = useState(group.stopLossPct ?? '');
  const [takePct, setTakePct] = useState(group.takeProfitPct ?? '');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const valuesRef = useRef({ stopPct, takePct });
  valuesRef.current = { stopPct, takePct };
  const savedRef = useRef(`${group.stopLossPct ?? ''}|${group.takeProfitPct ?? ''}`);
  const savingRef = useRef(false);

  useEffect(() => {
    if (group.status === 'closed') return;
    setStopPct(group.stopLossPct ?? '');
    setTakePct(group.takeProfitPct ?? '');
    savedRef.current = `${group.stopLossPct ?? ''}|${group.takeProfitPct ?? ''}`;
    // Only reset the draft when the edited order changes, not on each poll.
  }, [group.id]);

  const saveNow = useCallback(async () => {
    const current = valuesRef.current;
    const key = `${current.stopPct}|${current.takePct}`;
    if (key === savedRef.current || savingRef.current) return;
    savingRef.current = true;
    setStatus('saving');
    setError(null);
    let saved = false;
    try {
      const updated = await updateTradeGroupProtection(group.id, {
        stopLossPct: current.stopPct.trim() ? Number(current.stopPct) : null,
        takeProfitPct: current.takePct.trim() ? Number(current.takePct) : null,
      });
      savedRef.current = key;
      saved = true;
      onUpdated(updated);
      setStatus('saved');
      void queryClient.invalidateQueries({ queryKey: ['trade-groups'] });
      void queryClient.invalidateQueries({ queryKey: ['portfolio-token-summaries'] });
    } catch (err) {
      setStatus('error');
      setError(toRussianError(err, 'Не удалось сохранить защиту'));
    } finally {
      savingRef.current = false;
      const latest = valuesRef.current;
      if (saved && `${latest.stopPct}|${latest.takePct}` !== savedRef.current) {
        void saveNow();
      }
    }
  }, [group.id, onUpdated, queryClient]);

  useEffect(() => {
    const key = `${stopPct}|${takePct}`;
    if (key === savedRef.current) return;
    const timer = window.setTimeout(() => void saveNow(), 700);
    return () => window.clearTimeout(timer);
  }, [stopPct, takePct, saveNow]);

  useEffect(
    () => () => {
      const current = valuesRef.current;
      const key = `${current.stopPct}|${current.takePct}`;
      if (key === savedRef.current) return;
      void updateTradeGroupProtection(group.id, {
        stopLossPct: current.stopPct.trim() ? Number(current.stopPct) : null,
        takeProfitPct: current.takePct.trim() ? Number(current.takePct) : null,
      }).catch(() => undefined);
    },
    [group.id],
  );

  if (group.status === 'closed') return null;

  const remaining = new Decimal(group.remainingAmount);
  const cost = new Decimal(group.remainingCostBasisUsd);
  const average = remaining.gt(0) ? cost.div(remaining) : null;
  const reference = average ?? (currentPrice ? new Decimal(currentPrice) : null);

  function targetHint(pct: string, direction: 1 | -1): string | undefined {
    const value = Number(pct);
    if (!reference || !pct.trim() || !Number.isFinite(value) || value <= 0) return undefined;
    const target = reference.mul(1 + (direction * value) / 100);
    if (!remaining.gt(0)) return `Цель ${formatPrice(target.toFixed(18))}`;
    const diff = remaining.mul(target.minus(reference));
    return `Цель ${formatPrice(target.toFixed(18))} · ${
      diff.gte(0) ? '+' : '−'
    }${formatUsd(diff.abs().toFixed(2))}`;
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
          Защита этой сделки
        </div>
        <div className="text-[10px] text-zinc-400">
          {status === 'saving'
            ? 'Сохраняю…'
            : status === 'error'
              ? error
              : status === 'saved' && !stopPct && !takePct
                ? 'Защита отключена'
                : status === 'saved'
                  ? 'Сохранено'
                  : 'Сохраняется автоматически'}
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <ProtectionInputCard
          tone="sky"
          title="Тейк-профит"
          value={takePct}
          onChange={(value) => {
            setTakePct(value);
            setStatus('idle');
          }}
          onBlur={() => void saveNow()}
          direction={1}
          hint={targetHint(takePct, 1)}
        />
        <ProtectionInputCard
          tone="rose"
          title="Стоп-лосс"
          value={stopPct}
          onChange={(value) => {
            setStopPct(value);
            setStatus('idle');
          }}
          onBlur={() => void saveNow()}
          direction={-1}
          hint={targetHint(stopPct, -1)}
        />
      </div>
    </div>
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
  const pnlValue = pnl ? Number(pnl) : 0;
  const surface =
    pnlValue > 0
      ? 'tone-surface tone-surface-emerald border-emerald-200'
      : pnlValue < 0
        ? 'tone-surface tone-surface-rose border-rose-200'
        : 'border-zinc-200 bg-zinc-50';

  return (
    <div className={`rounded-2xl border p-3.5 ${surface}`}>
      <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
        Текущая сделка
      </div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <TokenIcon
            logoUrl={group.asset.logoUrl}
            symbol={group.asset.symbol}
            className="h-10 w-10 text-[10px]"
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-base font-semibold text-zinc-900">
                {group.asset.symbol}
              </span>
              <Badge tone={group.status === 'closed' ? 'neutral' : 'info'}>
                {group.status === 'closed'
                  ? 'Закрыта'
                  : group.status === 'partial'
                    ? 'Частично'
                    : 'Открыта'}
              </Badge>
            </div>
            <div className="truncate text-[11px] text-zinc-500">
              {group.asset.name} · {group.asset.chainCode.toUpperCase()}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
            Результат
          </div>
          <div className={`font-mono text-2xl font-semibold tracking-tight ${pnlTone(pnl)}`}>
            {pnl ? formatSignedUsd(pnl) : '—'}
          </div>
          <div className={`text-[11px] font-medium ${pnlTone(group.returnPct)}`}>
            {group.returnPct ? formatPct(group.returnPct) : '—'}
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
            Куплено по
          </div>
          <div className="mt-0.5 font-mono text-[14px] font-semibold tabular-nums text-zinc-900">
            {buyPrice ? formatPrice(buyPrice.toFixed(12)) : '—'}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
            Сейчас
          </div>
          <div className="mt-0.5 font-mono text-[14px] font-semibold tabular-nums text-zinc-900">
            {formatPrice(currentPrice)}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
            Остаток
          </div>
          <div className="mt-0.5 font-mono text-[14px] font-semibold tabular-nums text-zinc-900">
            {formatTokenAmount(group.remainingAmount, 8)} {group.asset.symbol}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
            Вложено
          </div>
          <div className="mt-0.5 font-mono text-[14px] font-semibold tabular-nums text-zinc-900">
            {formatUsd(group.buyUsd)}
          </div>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-zinc-500">
        <span>Открыта {formatDate(group.openedAt)}</span>
        <span>{group.holdingDays} дн. в сделке</span>
      </div>
    </div>
  );
}
