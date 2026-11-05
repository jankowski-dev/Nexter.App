import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import {
  ApiError,
  buildSwap,
  buildSwapApproval,
  cancelSwapSigning,
  fetchSwapConfig,
  fetchSwapOrder,
  fetchSwapOrders,
  markSwapSigning,
  quoteSwap,
  readySwap,
  stepUp,
  submitSwap,
  submitSwapApproval,
  type ApprovalBuildResponse,
  type SwapBuildResponse,
} from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import { formatDateTime, formatPct, formatTokenAmount, formatUsd } from '@/lib/format';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useWalletConnect } from '@/lib/walletconnect';
import { Decimal } from 'decimal.js';
import { useEffect, useMemo, useState } from 'react';

function isPositiveDecimal(value: string): boolean {
  return /^\d+(?:\.\d+)?$/.test(value) && Number(value) > 0;
}

export function SwapPage() {
  const config = useQuery({ queryKey: ['swap-config'], queryFn: fetchSwapConfig });
  const [tokenIn, setTokenIn] = useState('0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d');
  const [tokenOut, setTokenOut] = useState('0x1d28d989f9e3ccb8b15d0cec601734514f958e4d');
  const [amountIn, setAmountIn] = useState('1');
  const [walletAddress, setWalletAddress] = useState('');
  const [slippageBps, setSlippageBps] = useState<number | null>(null);

  const wallet = useWalletConnect(config.data?.walletConnectProjectId ?? null);

  useEffect(() => {
    if (wallet.address) setWalletAddress(wallet.address);
  }, [wallet.address]);

  const quote = useMutation({
    mutationFn: () =>
      quoteSwap({
        chain: 'bsc',
        tokenIn,
        tokenOut,
        amountIn,
        slippageBps: slippageBps ?? config.data?.defaultSlippageBps ?? 50,
        walletAddress: walletAddress || undefined,
      }),
  });

  const [buildData, setBuildData] = useState<SwapBuildResponse | null>(null);
  const [approvalData, setApprovalData] = useState<ApprovalBuildResponse | null>(null);
  const [approvalConfirmed, setApprovalConfirmed] = useState(false);
  const [approvalTxHash, setApprovalTxHash] = useState<string | null>(null);
  const [swapTxHash, setSwapTxHash] = useState<string | null>(null);
  const [executionBusy, setExecutionBusy] = useState(false);
  const [executionError, setExecutionError] = useState<string | null>(null);
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [stepUpCode, setStepUpCode] = useState('');
  const [stepUpError, setStepUpError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<{ run: () => void } | null>(null);

  const build = useMutation({
    mutationFn: (input: { orderId: string; walletAddress: string }) =>
      buildSwap(input.orderId, input.walletAddress),
  });
  const approval = useMutation({
    mutationFn: (orderId: string) => buildSwapApproval(orderId),
  });
  const ready = useMutation({
    mutationFn: (orderId: string) => readySwap(orderId),
  });
  const stepUpMutation = useMutation({ mutationFn: (code: string) => stepUp(code) });

  const liveOrder = useQuery({
    queryKey: ['swap-order', quote.data?.id],
    queryFn: () => fetchSwapOrder(quote.data!.id),
    enabled: Boolean(quote.data?.id && (swapTxHash || buildData)),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'SUBMITTED' || status === 'PENDING' ? 5_000 : false;
    },
  });

  const recentOrders = useQuery({
    queryKey: ['swap-orders-recent'],
    queryFn: async () => {
      const page = await fetchSwapOrders({ limit: 5 });
      return Promise.all(page.data.map((order) => fetchSwapOrder(order.id)));
    },
    refetchInterval: 5_000,
  });

  useEffect(() => {
    setBuildData(null);
    setApprovalData(null);
    setApprovalConfirmed(false);
    setApprovalTxHash(null);
    setSwapTxHash(null);
    setExecutionError(null);
    setStepUpOpen(false);
    setPendingAction(null);
  }, [quote.data?.id]);

  function retryWithStepUp(error: unknown, retry: () => void, fallback: string): void {
    if (error instanceof ApiError && error.code === 'SWAP_STEP_UP_REQUIRED') {
      setPendingAction({ run: retry });
      setStepUpCode('');
      setStepUpError(null);
      setStepUpOpen(true);
      return;
    }

    setExecutionError(toRussianError(error, fallback));
  }

  async function runBuild(): Promise<void> {
    if (!quote.data || !walletAddress) return;
    setExecutionBusy(true);
    setExecutionError(null);

    try {
      const result = await build.mutateAsync({
        orderId: quote.data.id,
        walletAddress,
      });
      setBuildData(result);
      setApprovalData(null);
      setApprovalConfirmed(false);
      setApprovalTxHash(null);
      setSwapTxHash(null);
    } catch (error) {
      retryWithStepUp(error, () => void runBuild(), 'Не удалось проверить сборку');
    } finally {
      setExecutionBusy(false);
    }
  }

  async function runApprovalBuild(): Promise<void> {
    if (!quote.data) return;
    setExecutionBusy(true);
    setExecutionError(null);

    try {
      const result = await approval.mutateAsync(quote.data.id);
      setApprovalData(result);
      setApprovalConfirmed(false);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'SWAP_APPROVAL_NOT_REQUIRED') {
        await runReady();
        return;
      }
      retryWithStepUp(error, () => void runApprovalBuild(), 'Не удалось подготовить approval');
    } finally {
      setExecutionBusy(false);
    }
  }

  async function runReady(): Promise<void> {
    if (!quote.data) return;
    setExecutionBusy(true);
    setExecutionError(null);

    try {
      const result = await ready.mutateAsync(quote.data.id);
      setBuildData(result);
      setApprovalConfirmed(true);
      await liveOrder.refetch();
    } catch (error) {
      retryWithStepUp(
        error,
        () => void runReady(),
        'Разрешение ещё не подтверждено. Подождите и попробуйте снова.',
      );
    } finally {
      setExecutionBusy(false);
    }
  }

  function canSignFor(expectedWallet: string | null | undefined): boolean {
    if (!wallet.address || !expectedWallet) {
      setExecutionError('Кошелёк не подключён к сборке. Переподключите Tangem.');
      return false;
    }

    if (wallet.address.toLowerCase() !== expectedWallet.toLowerCase()) {
      setExecutionError(
        'Подключённый кошелёк не совпадает с адресом сборки. Переподключите нужный кошелёк.',
      );
      return false;
    }

    if (buildData?.deadline && Date.now() / 1000 >= buildData.deadline) {
      setExecutionError('Срок действия сборки истёк. Запросите новую котировку.');
      return false;
    }

    return true;
  }

  async function signApproval(): Promise<void> {
    if (!approvalData || !quote.data) return;
    if (!canSignFor(approvalData.approval.walletAddress)) return;
    setExecutionBusy(true);
    setExecutionError(null);

    try {
      const hash = await wallet.sendTransaction({
        to: approvalData.to,
        data: approvalData.calldata,
        value: approvalData.value,
      });
      setApprovalTxHash(hash);
      await submitSwapApproval(approvalData.approval.id, hash);
      await wallet.waitForReceipt(hash);
      await runReady();
    } catch (error) {
      setExecutionError(toRussianError(error, 'Не удалось подписать approval в Tangem'));
    } finally {
      setExecutionBusy(false);
    }
  }

  async function cancelSigning(): Promise<void> {
    if (!quote.data) return;
    setExecutionError(null);

    try {
      const result = await cancelSwapSigning(quote.data.id);
      setBuildData((current) => (current ? { ...current, status: result.status } : current));
      await liveOrder.refetch();
    } catch (error) {
      const refreshed = await liveOrder.refetch();
      if (refreshed.data) {
        setBuildData((current) =>
          current ? { ...current, status: refreshed.data.status } : current,
        );
      }
      setExecutionError(toRussianError(error, 'Не удалось отменить подпись'));
    }
  }

  async function submitSignedSwap(hash: string): Promise<void> {
    if (!quote.data) return;

    try {
      const submitted = await submitSwap(quote.data.id, hash);
      setBuildData((current) => (current ? { ...current, status: submitted.status } : current));
      await liveOrder.refetch();
    } catch (error) {
      retryWithStepUp(
        error,
        () => void submitSignedSwap(hash),
        'Транзакция подписана, но сервер не принял hash. Скопируйте hash и проверьте статус.',
      );
    }
  }

  async function signSwap(): Promise<void> {
    if (!buildData?.routerAddress || !buildData.calldata || !quote.data) return;
    if (!canSignFor(buildData.walletAddress)) return;
    setExecutionBusy(true);
    setExecutionError(null);

    try {
      await markSwapSigning(quote.data.id);
      setBuildData((current) => (current ? { ...current, status: 'AWAITING_SIGNATURE' } : current));
    } catch (error) {
      setExecutionBusy(false);
      retryWithStepUp(error, () => void signSwap(), 'Не удалось перевести сборку в статус подписи');
      return;
    }

    try {
      const hash = await wallet.sendTransaction({
        to: buildData.routerAddress,
        data: buildData.calldata,
        value: buildData.transactionValue ?? '0',
      });
      setSwapTxHash(hash);
      await submitSignedSwap(hash);
    } catch (error) {
      try {
        const cancelled = await cancelSwapSigning(quote.data.id);
        setBuildData((current) => (current ? { ...current, status: cancelled.status } : current));
        await liveOrder.refetch();
      } catch {
        const refreshed = await liveOrder.refetch();
        if (refreshed.data) {
          setBuildData((current) =>
            current ? { ...current, status: refreshed.data.status } : current,
          );
        }
      }
      setExecutionError(toRussianError(error, 'Не удалось подписать своп в Tangem'));
    } finally {
      setExecutionBusy(false);
    }
  }

  async function confirmStepUp(): Promise<void> {
    setStepUpError(null);

    try {
      await stepUpMutation.mutateAsync(stepUpCode);
      setStepUpOpen(false);
      const action = pendingAction;
      setPendingAction(null);
      action?.run();
    } catch (error) {
      setStepUpError(toRussianError(error, 'Не удалось подтвердить TOTP'));
    }
  }

  const tokens = config.data?.chains[0]?.tokens ?? [];
  const selectedIn = tokens.find((token) => token.address.toLowerCase() === tokenIn.toLowerCase());
  const selectedOut = tokens.find(
    (token) => token.address.toLowerCase() === tokenOut.toLowerCase(),
  );
  const walletRequired = config.data?.walletAllowlistConfigured ?? false;

  const canQuote = useMemo(() => {
    if (!config.data?.enabled) return false;
    if (!selectedIn || !selectedOut || tokenIn.toLowerCase() === tokenOut.toLowerCase())
      return false;
    if (!isPositiveDecimal(amountIn)) return false;
    if (walletRequired && !/^0x[0-9a-fA-F]{40}$/.test(walletAddress)) return false;
    return true;
  }, [
    config.data?.enabled,
    selectedIn,
    selectedOut,
    tokenIn,
    tokenOut,
    amountIn,
    walletRequired,
    walletAddress,
  ]);

  if (config.isPending) {
    return (
      <div className="space-y-6">
        <PageHeader title="Своп" subtitle="Загружаю конфигурацию…" />
        <LoadingRows rows={6} />
      </div>
    );
  }

  if (config.isError || !config.data) {
    return (
      <div className="space-y-6">
        <PageHeader title="Своп" />
        <ErrorState
          message={toRussianError(config.error, 'Не удалось загрузить конфигурацию свопов')}
          onRetry={() => void config.refetch()}
        />
      </div>
    );
  }

  const data = config.data;
  const chain = data.chains[0];
  const executionReady = buildData?.status === 'READY';
  const deadlineExpired = Boolean(buildData?.deadline && Date.now() / 1000 >= buildData.deadline);
  const executionOrder = liveOrder.data ?? buildData ?? quote.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Своп"
        subtitle="Phase 8: котировки KyberSwap, проверка сборки, точный approval и подпись Tangem на BSC."
        actions={
          <Badge tone={data.enabled ? 'success' : 'warning'}>
            {data.enabled ? 'Котировки включены' : data.killSwitch ? 'Kill switch' : 'Отключено'}
          </Badge>
        }
      />

      {!data.enabled ? (
        <Card className="border-amber-200 bg-amber-50">
          <CardTitle className="text-amber-800">Свопы отключены</CardTitle>
          <CardDescription className="text-amber-700">
            {data.killSwitch
              ? 'Сработал kill switch. Новые котировки и сборка транзакций недоступны; существующие ордера можно только просматривать.'
              : 'SWAP_ENABLED=false. Владелец должен явно включить котировки после настройки провайдера и allowlist.'}
          </CardDescription>
        </Card>
      ) : null}

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Кошелёк Tangem</CardTitle>
            <CardDescription>
              WalletConnect v2 · BSC only. Приватные ключи и seed-фраза не передаются серверу.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {wallet.connected ? (
              <Badge tone={wallet.onBsc ? 'success' : 'warning'}>
                {wallet.onBsc ? 'BSC' : `chain ${wallet.chainId ?? '—'}`}
              </Badge>
            ) : null}
            {wallet.connected ? (
              <>
                {!wallet.onBsc ? (
                  <Button variant="secondary" onClick={() => void wallet.switchToBsc()}>
                    Переключить на BSC
                  </Button>
                ) : null}
                <Button variant="ghost" onClick={() => void wallet.disconnect()}>
                  Отключить
                </Button>
              </>
            ) : (
              <Button
                onClick={() => void wallet.connect()}
                disabled={wallet.connecting || !data.walletConnectProjectId}
              >
                {wallet.connecting ? 'Подключаю…' : 'Подключить Tangem'}
              </Button>
            )}
          </div>
        </div>

        {wallet.connected ? (
          <div className="mt-3 font-mono text-xs text-zinc-600">{wallet.address}</div>
        ) : null}
        {wallet.error ? <p className="mt-2 text-sm text-red-700">{wallet.error}</p> : null}
        {!data.walletConnectProjectId ? (
          <p className="mt-2 text-sm text-amber-700">
            WalletConnect Project ID не настроен на сервере.
          </p>
        ) : null}
        {!data.buildEnabled ? (
          <p className="mt-2 text-sm text-zinc-500">
            Подпись и отправка выключены до завершения allowlist/full calldata review. Сейчас
            доступна только котировка.
          </p>
        ) : null}
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardTitle>Параметры котировки</CardTitle>
          <CardDescription>
            {chain
              ? `${chain.name} · chainId ${chain.chainId} · провайдер ${data.providerConfigured ? data.providerMode : 'не настроен'}`
              : 'Сеть не настроена'}
          </CardDescription>

          <div className="mt-4 grid gap-3">
            <label className="block text-sm text-zinc-600">
              Отдаю
              <div className="mt-1 grid grid-cols-[1fr_120px] gap-2">
                <Select
                  value={tokenIn}
                  onChange={(event) => {
                    setTokenIn(event.target.value);
                    quote.reset();
                  }}
                  aria-label="Токен отдачи"
                >
                  {tokens.map((token) => (
                    <option key={token.address} value={token.address}>
                      {token.symbol}
                    </option>
                  ))}
                </Select>
                <Input
                  inputMode="decimal"
                  value={amountIn}
                  onChange={(event) => {
                    setAmountIn(event.target.value);
                    quote.reset();
                  }}
                  aria-label="Количество токена отдачи"
                />
              </div>
            </label>

            <label className="block text-sm text-zinc-600">
              Получаю
              <Select
                className="mt-1"
                value={tokenOut}
                onChange={(event) => {
                  setTokenOut(event.target.value);
                  quote.reset();
                }}
                aria-label="Токен получения"
              >
                {tokens.map((token) => (
                  <option key={token.address} value={token.address}>
                    {token.symbol}
                  </option>
                ))}
              </Select>
            </label>

            <label className="block text-sm text-zinc-600">
              Допустимое проскальзывание
              <Select
                className="mt-1"
                value={String(slippageBps ?? data.defaultSlippageBps)}
                onChange={(event) => {
                  setSlippageBps(Number(event.target.value));
                  quote.reset();
                }}
                aria-label="Проскальзывание"
              >
                {[10, 50, 100, 200].map((value) => (
                  <option key={value} value={value}>
                    {(value / 100).toFixed(2)}%
                  </option>
                ))}
              </Select>
            </label>

            {walletRequired ? (
              <label className="block text-sm text-zinc-600">
                Адрес кошелька (allowlist)
                <Input
                  className="mt-1 font-mono text-xs"
                  value={walletAddress}
                  onChange={(event) => {
                    setWalletAddress(event.target.value.trim());
                    quote.reset();
                  }}
                  placeholder="0x…"
                  aria-label="Адрес кошелька"
                />
                <span className="mt-1 block text-xs text-zinc-500">
                  Для котировки нужен адрес из SWAP_WALLET_ALLOWLIST. Приватные ключи и seed-фраза
                  не запрашиваются.
                </span>
              </label>
            ) : null}

            <Button
              className="mt-2"
              onClick={() => quote.mutate()}
              disabled={!canQuote || quote.isPending}
            >
              {quote.isPending ? 'Запрашиваю котировку…' : 'Получить котировку'}
            </Button>

            {quote.isError ? (
              <p className="text-sm text-red-700">
                {toRussianError(quote.error, 'Не удалось получить котировку')}
              </p>
            ) : null}
          </div>
        </Card>

        <Card>
          <CardTitle>Результат</CardTitle>
          <CardDescription>
            Маршрут и суммы приходят от KyberSwap. Сборка доступна через API; подпись и отправка —
            Phase 8.
          </CardDescription>

          {quote.data ? (
            <div className="mt-4 space-y-3 text-sm">
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                <div className="text-xs text-zinc-500">Получаю</div>
                <div className="mt-1 font-mono text-2xl font-semibold text-zinc-900">
                  {formatTokenAmount(quote.data.amountOut, 8)} {quote.data.tokenOut.symbol}
                </div>
                <div className="mt-1 text-xs text-zinc-500">
                  Минимум: {formatTokenAmount(quote.data.minOut, 8)} {quote.data.tokenOut.symbol}
                </div>
              </div>

              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                <div className="text-xs text-zinc-500">Курс</div>
                <div className="mt-1 font-mono text-sm text-zinc-800">
                  1 {quote.data.tokenIn.symbol} ={' '}
                  {formatTokenAmount(
                    new Decimal(quote.data.amountOut).div(quote.data.amountIn).toFixed(6),
                    6,
                  )}{' '}
                  {quote.data.tokenOut.symbol}
                </div>
                <div className="font-mono text-sm text-zinc-600">
                  1 {quote.data.tokenOut.symbol} ={' '}
                  {formatTokenAmount(
                    new Decimal(quote.data.amountIn).div(quote.data.amountOut).toFixed(6),
                    6,
                  )}{' '}
                  {quote.data.tokenIn.symbol}
                </div>
                {quote.data.amountInUsd && quote.data.amountOutUsd ? (
                  <div className="mt-1 text-xs text-zinc-500">
                    Стоимость: {formatUsd(quote.data.amountInUsd)} →{' '}
                    {formatUsd(quote.data.amountOutUsd)}
                  </div>
                ) : null}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-md border border-zinc-200 p-2">
                  <div className="text-xs text-zinc-500">Price impact</div>
                  <div className="font-mono text-zinc-800">
                    {quote.data.priceImpactBps === null
                      ? '—'
                      : formatPct(String(quote.data.priceImpactBps / 100))}
                  </div>
                </div>
                <div className="rounded-md border border-zinc-200 p-2">
                  <div className="text-xs text-zinc-500">Газ</div>
                  <div className="font-mono text-zinc-800">{formatUsd(quote.data.gasUsd)}</div>
                </div>
                <div className="rounded-md border border-zinc-200 p-2">
                  <div className="text-xs text-zinc-500">Маршрут</div>
                  <div className="truncate font-mono text-xs text-zinc-700">
                    {quote.data.routeId ?? 'без routeID'}
                  </div>
                </div>
                <div className="rounded-md border border-zinc-200 p-2">
                  <div className="text-xs text-zinc-500">Действует до</div>
                  <div className="text-zinc-700">{formatDateTime(quote.data.quoteExpiresAt)}</div>
                </div>
              </div>

              {quote.data.errors.length > 0 ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-700">
                  {quote.data.errors.map((item) => (
                    <div key={item}>{item}</div>
                  ))}
                </div>
              ) : null}

              <div className="text-xs text-zinc-500">
                Ордер {quote.data.id.slice(0, 8)} · {quote.data.status} · котировка не является
                обещанием исполнения.
              </div>
            </div>
          ) : (
            <p className="mt-4 text-sm text-zinc-600">
              Заполните параметры и запросите котировку. Сервер проверит allowlist, сумму, price
              impact и срок жизни котировки.
            </p>
          )}
        </Card>
      </div>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Исполнение</CardTitle>
            <CardDescription>
              Проверка сборки, точный approval и подпись в Tangem. Приватные ключи не покидают
              устройство.
            </CardDescription>
          </div>
          {buildData ? (
            <Badge
              tone={
                buildData.status === 'READY'
                  ? 'success'
                  : buildData.status === 'APPROVAL_REQUIRED' || buildData.status === 'BUILT'
                    ? 'warning'
                    : 'neutral'
              }
            >
              {buildData.status === 'APPROVAL_REQUIRED'
                ? 'Нужно approval'
                : buildData.status === 'BUILT'
                  ? 'Собрано, нужна проверка'
                  : buildData.status === 'READY'
                    ? 'Готово к подписи'
                    : buildData.status}
            </Badge>
          ) : null}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            onClick={() => void runBuild()}
            disabled={!quote.data || !walletAddress || !data.buildEnabled || executionBusy}
          >
            {executionBusy && !buildData ? 'Проверяю сборку…' : 'Проверить сборку'}
          </Button>
          {buildData?.approvalRequired && !approvalData ? (
            <Button
              variant="secondary"
              onClick={() => void runApprovalBuild()}
              disabled={executionBusy}
            >
              Подготовить approval
            </Button>
          ) : null}
          {buildData?.status === 'APPROVAL_REQUIRED' ||
          (buildData?.status === 'BUILT' && !buildData.approvalRequired) ? (
            <Button variant="secondary" onClick={() => void runReady()} disabled={executionBusy}>
              Проверить готовность
            </Button>
          ) : null}
          {executionReady && !swapTxHash && executionOrder?.status !== 'AWAITING_SIGNATURE' ? (
            <Button
              onClick={() => void signSwap()}
              disabled={
                executionBusy ||
                !wallet.connected ||
                !data.enabled ||
                !data.executionEnabled ||
                deadlineExpired
              }
            >
              {executionBusy ? 'Подписываю…' : 'Подписать своп в Tangem'}
            </Button>
          ) : null}
          {swapTxHash &&
          (executionOrder?.status === 'READY' ||
            executionOrder?.status === 'BUILT' ||
            executionOrder?.status === 'AWAITING_SIGNATURE') ? (
            <Button
              variant="secondary"
              onClick={() => void submitSignedSwap(swapTxHash)}
              disabled={executionBusy}
            >
              Отправить hash повторно
            </Button>
          ) : null}
          {!swapTxHash &&
          (buildData?.status === 'AWAITING_SIGNATURE' ||
            executionOrder?.status === 'AWAITING_SIGNATURE') ? (
            <Button variant="secondary" onClick={() => void cancelSigning()}>
              Отменить подпись
            </Button>
          ) : null}
        </div>

        {!data.executionEnabled ? (
          <p className="mt-3 text-sm text-amber-700">
            Исполнение выключено до финального security review. Сборку и approval можно подготовить,
            но подпись в Tangem недоступна.
          </p>
        ) : null}
        {executionError ? <p className="mt-3 text-sm text-red-700">{executionError}</p> : null}
        {swapTxHash ? (
          <p className="mt-3 break-all text-xs text-zinc-600">
            Подписанный hash:{' '}
            <a
              className="text-emerald-700 underline"
              href={`https://bscscan.com/tx/${swapTxHash}`}
              target="_blank"
              rel="noreferrer"
            >
              {swapTxHash}
            </a>
          </p>
        ) : null}

        {buildData ? (
          <div className="mt-4 space-y-3 text-sm">
            <div className="grid gap-2 md:grid-cols-2">
              <div className="rounded-md border border-zinc-200 p-2">
                <div className="text-xs text-zinc-500">Router</div>
                <div className="truncate font-mono text-xs text-zinc-700">
                  {buildData.routerAddress ?? '—'}
                </div>
              </div>
              <div className="rounded-md border border-zinc-200 p-2">
                <div className="text-xs text-zinc-500">Минимум на выходе</div>
                <div className="font-mono text-zinc-800">
                  {formatTokenAmount(buildData.minOut, 8)} {buildData.tokenOut.symbol}
                </div>
              </div>
              <div className="rounded-md border border-zinc-200 p-2">
                <div className="text-xs text-zinc-500">Deadline</div>
                <div className="text-zinc-700">
                  {buildData.deadline
                    ? formatDateTime(new Date(buildData.deadline * 1000).toISOString())
                    : '—'}
                </div>
              </div>
              <div className="rounded-md border border-zinc-200 p-2">
                <div className="text-xs text-zinc-500">Allowance</div>
                <div className="font-mono text-xs text-zinc-700">
                  {buildData.allowance ?? 'native'}
                </div>
              </div>
              <div className="rounded-md border border-zinc-200 p-2 md:col-span-2">
                <div className="text-xs text-zinc-500">Получатель</div>
                <div className="break-all font-mono text-xs text-zinc-700">
                  {buildData.walletAddress ?? '—'}
                </div>
              </div>
            </div>

            <div className="max-h-40 overflow-auto rounded-md border border-zinc-200 bg-zinc-50 p-2 font-mono text-xs text-zinc-600">
              {buildData.validation.map((item) => (
                <div key={item.check} className={item.passed ? 'text-zinc-600' : 'text-amber-700'}>
                  {item.passed ? '✓' : '•'} {item.check}
                  {item.detail ? ` — ${item.detail}` : ''}
                </div>
              ))}
            </div>

            {approvalData ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
                <div className="font-medium text-amber-800">Approval токена</div>
                <div className="mt-1 break-all font-mono text-xs text-amber-700">
                  token: {approvalData.approval.tokenAddress}
                </div>
                <div className="break-all font-mono text-xs text-amber-700">
                  spender: {approvalData.approval.spenderAddress}
                </div>
                <div className="mt-1 font-mono text-xs text-amber-700">
                  amountWei: {approvalData.approval.amountWei}
                </div>
                {approvalTxHash ? (
                  <div className="mt-1 break-all font-mono text-xs text-amber-700">
                    tx: {approvalTxHash}
                  </div>
                ) : null}
                {approvalConfirmed ? (
                  <p className="mt-2 text-xs text-emerald-700">Approval подтверждён в сети.</p>
                ) : approvalTxHash ? (
                  <>
                    <Button
                      className="mt-2"
                      variant="secondary"
                      onClick={() => void runReady()}
                      disabled={executionBusy}
                    >
                      Проверить готовность
                    </Button>
                    <Button
                      className="mt-2 ml-2"
                      variant="ghost"
                      onClick={() => {
                        setApprovalData(null);
                        setApprovalTxHash(null);
                        setApprovalConfirmed(false);
                        void runApprovalBuild();
                      }}
                      disabled={executionBusy}
                    >
                      Пересобрать approval
                    </Button>
                  </>
                ) : (
                  <Button
                    className="mt-2"
                    onClick={() => void signApproval()}
                    disabled={
                      executionBusy ||
                      !wallet.connected ||
                      !data.enabled ||
                      !data.executionEnabled ||
                      deadlineExpired
                    }
                  >
                    {executionBusy ? 'Подписываю approval…' : 'Подписать approval в Tangem'}
                  </Button>
                )}
              </div>
            ) : null}

            {deadlineExpired ? (
              <p className="text-xs text-amber-700">
                Сборка истекла. Запросите новую котировку, чтобы подписать.
              </p>
            ) : executionReady ? (
              <p className="text-xs text-emerald-700">
                Сборка проверена. Можно подписывать swap-транзакцию в Tangem.
              </p>
            ) : null}

            {executionOrder ? (
              <div className="rounded-md border border-zinc-200 p-2 text-xs text-zinc-600">
                Ордер {executionOrder.id.slice(0, 8)} · {executionOrder.status}
                {executionOrder.txHash ? (
                  <>
                    {' '}
                    · tx{' '}
                    <a
                      className="break-all text-emerald-700 underline"
                      href={`https://bscscan.com/tx/${executionOrder.txHash}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {executionOrder.txHash}
                    </a>
                  </>
                ) : null}
                {executionOrder.confirmations > 0 ? (
                  <> · подтверждений: {executionOrder.confirmations}</>
                ) : null}
                {executionOrder.accountingTransactionId ? <> · учёт создан</> : null}
              </div>
            ) : null}
          </div>
        ) : (
          <p className="mt-3 text-sm text-zinc-600">
            Запросите котировку, затем проверьте сборку. Сервер декодирует calldata и проверит
            получателя, minOut, allowance и симуляцию.
          </p>
        )}
      </Card>

      <Card>
        <CardTitle>Последние свопы</CardTitle>
        <CardDescription>
          История ордеров и статус учёта. Обновляется автоматически.
        </CardDescription>
        {recentOrders.isPending ? <LoadingRows rows={3} /> : null}
        {recentOrders.isError ? (
          <p className="mt-3 text-sm text-red-700">Не удалось загрузить историю свопов.</p>
        ) : null}
        {recentOrders.data?.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-600">Свопов пока нет.</p>
        ) : null}
        {recentOrders.data?.length ? (
          <div className="mt-4 space-y-2">
            {recentOrders.data.map((order) => (
              <div
                key={order.id}
                className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-medium text-zinc-900">
                    {formatTokenAmount(order.amountIn, 6)} {order.tokenIn.symbol} →{' '}
                    {formatTokenAmount(order.amountOut, 6)} {order.tokenOut.symbol}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      tone={
                        order.status === 'CONFIRMED'
                          ? 'success'
                          : order.status === 'FAILED' ||
                              order.status === 'REPLACED' ||
                              order.status === 'DROPPED'
                            ? 'danger'
                            : 'neutral'
                      }
                    >
                      {order.status}
                    </Badge>
                    <Badge
                      tone={
                        order.accountingTransactionId
                          ? 'success'
                          : order.status === 'SUBMITTED' ||
                              order.status === 'PENDING' ||
                              order.status === 'CONFIRMED'
                            ? 'warning'
                            : 'neutral'
                      }
                    >
                      {order.accountingTransactionId
                        ? 'учёт создан'
                        : order.status === 'SUBMITTED' ||
                            order.status === 'PENDING' ||
                            order.status === 'CONFIRMED'
                          ? 'учёта нет'
                          : 'не отправлен'}
                    </Badge>
                  </div>
                </div>
                <div className="mt-1 flex flex-wrap gap-2 text-xs text-zinc-500">
                  <span>Ордер {order.id.slice(0, 8)}</span>
                  <span>{formatDateTime(order.createdAt)}</span>
                  {order.txHash ? (
                    <a
                      className="break-all text-emerald-700 underline"
                      href={`https://bscscan.com/tx/${order.txHash}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {order.txHash.slice(0, 18)}…
                    </a>
                  ) : null}
                  {order.confirmations > 0 ? <span>{order.confirmations} подтв.</span> : null}
                </div>
                {!order.accountingTransactionId && order.errors.length > 0 ? (
                  <div className="mt-1 break-all text-xs text-red-700">
                    Ошибки: {order.errors.join(', ')}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </Card>

      <Card>
        <CardTitle>Ограничения Phase 8</CardTitle>
        <CardDescription>
          BSC и подключение Tangem через WalletConnect уже доступны. Tracking и учёт подтверждённых
          свопов работают; подпись включается через `SWAP_EXECUTION_ENABLED` после финального
          review. Kill switch отключает новые котировки, чтение существующих ордеров остаётся
          доступным.
        </CardDescription>
      </Card>

      {stepUpOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/30 p-4">
          <Card className="w-full max-w-sm">
            <CardTitle>Подтвердите TOTP</CardTitle>
            <CardDescription>
              Для этой суммы нужен свежий код двухфакторной аутентификации.
            </CardDescription>
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
              <Button
                onClick={() => void confirmStepUp()}
                disabled={stepUpCode.length !== 6 || stepUpMutation.isPending}
              >
                {stepUpMutation.isPending ? 'Проверяю…' : 'Подтвердить'}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setStepUpOpen(false);
                  setPendingAction(null);
                }}
              >
                Отмена
              </Button>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
