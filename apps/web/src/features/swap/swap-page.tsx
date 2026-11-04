import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { fetchSwapConfig, quoteSwap } from '@/lib/api';
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Своп"
        subtitle="Phase 8: котировки KyberSwap на BSC и подключение Tangem. Подпись и отправка включатся после allowlist/full calldata review."
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
        <CardTitle>Ограничения Phase 8</CardTitle>
        <CardDescription>
          BSC и подключение Tangem через WalletConnect уже доступны. Подпись, approvals и отправка
          транзакций включатся после full calldata review и tracking; учётные записи свопов пока не
          создаются. Kill switch отключает новые котировки, чтение существующих ордеров остаётся
          доступным.
        </CardDescription>
      </Card>
    </div>
  );
}
