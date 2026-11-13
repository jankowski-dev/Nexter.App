import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { TokenIcon } from '@/components/token-icon';
import { fetchDashboardSummary, fetchPortfolioTokenSummaries, fetchPositions } from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import { formatPrice, formatSignedUsd, formatUsd, pnlTone } from '@/lib/format';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import type { Asset, TradeGroupSummary } from '@nexter/contracts';
import { TradesPanel } from '../trades/trades-panel';
import { ManualTradeDialog } from '../trade/manual-trade-dialog';
import { TokenTradeDrawer } from '../trade/token-trade-drawer';
import { useWatchlistLogos } from '../watchlist/use-watchlist-logos';
import { AssetDrawer } from './asset-drawer';
import { TokenBuyList } from './token-buy-list';
import { TestingPage } from '../testing/testing-page';

type PortfolioTab = 'portfolio' | 'trades' | 'robots' | 'strategies';
function tabFromHash(): PortfolioTab {
  if (typeof window === 'undefined') return 'portfolio';
  if (window.location.hash === '#trades') return 'trades';
  if (window.location.hash === '#robots') return 'robots';
  if (window.location.hash === '#strategies') return 'strategies';
  return 'portfolio';
}

function PortfolioMetric({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: string;
  hint?: string;
}) {
  return (
    <div title={hint}>
      <div className="text-[10px] text-zinc-500">{label}</div>
      <div className={`mt-0.5 font-mono text-xs ${tone ?? 'text-zinc-800'}`}>{value}</div>
    </div>
  );
}

export function PortfolioPage() {
  const [tab, setTab] = useState<PortfolioTab>(tabFromHash);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [buyTarget, setBuyTarget] = useState<{
    asset: Asset;
    marketPriceUsd: string | null;
  } | null>(null);
  const [sellGroup, setSellGroup] = useState<TradeGroupSummary | null>(null);
  const [manual, setManual] = useState<{
    assetId?: string;
    side?: 'entry' | 'exit';
    tradeGroupId?: string;
  } | null>(null);
  const positions = useQuery({
    queryKey: ['positions'],
    queryFn: fetchPositions,
    refetchInterval: 15_000,
  });
  const refetchPositions = useCallback(() => {
    void positions.refetch();
  }, [positions.refetch]);
  const watchlistLogos = useWatchlistLogos();
  const tokenSummaries = useQuery({
    queryKey: ['portfolio-token-summaries'],
    queryFn: fetchPortfolioTokenSummaries,
    enabled: tab === 'portfolio',
    refetchInterval: 15_000,
  });
  const dashboardSummary = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: fetchDashboardSummary,
    enabled: tab === 'portfolio',
    refetchInterval: 30_000,
  });

  if ((tab === 'portfolio' || tab === 'trades') && positions.isPending) {
    return (
      <div className="space-y-6">
        <PageHeader title="Торговля" subtitle="Загружаю позиции и сделки…" />
        <LoadingRows rows={8} />
      </div>
    );
  }

  if ((tab === 'portfolio' || tab === 'trades') && (positions.isError || !positions.data)) {
    return (
      <div className="space-y-6">
        <PageHeader title="Торговля" />
        <ErrorState
          message={toRussianError(positions.error, 'Не удалось загрузить позиции')}
          onRetry={refetchPositions}
        />
      </div>
    );
  }

  const data = positions.data;
  const positionByAsset = new Map(
    (data?.positions ?? []).map((position) => [position.asset.id, position]),
  );

  function changeTab(next: PortfolioTab): void {
    setTab(next);
    setSelectedAssetId(null);
    setBuyTarget(null);
    setSellGroup(null);
    window.history.replaceState(
      null,
      '',
      next === 'trades'
        ? '#trades'
        : next === 'robots'
          ? '#robots'
          : next === 'strategies'
            ? '#strategies'
            : '#portfolio',
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Торговля"
        subtitle={
          tab === 'robots'
            ? 'Бумажные роботы. Реальные деньги и подписи не используются.'
            : tab === 'strategies'
              ? 'Встроенные стратегии и подробные описания.'
              : 'Позиции, ордера и покупка токенов.'
        }
        actions={
          tab === 'portfolio' || tab === 'trades' ? (
            <Button variant="secondary" onClick={() => setManual({})}>
              Ручная сделка
            </Button>
          ) : undefined
        }
      />

      <div
        role="tablist"
        aria-label="Раздел торговли"
        className="flex flex-wrap gap-1 rounded-lg border border-zinc-200 bg-zinc-50 p-1"
      >
        {(
          [
            ['portfolio', 'Портфель'],
            ['trades', 'Ордера'],
            ['robots', 'Роботы'],
            ['strategies', 'Стратегии'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => changeTab(value)}
            className={`rounded-md px-4 py-2 text-sm ${
              tab === value
                ? 'bg-white text-zinc-900 shadow-sm'
                : 'text-zinc-500 hover:text-zinc-900'
            }`}
            aria-selected={tab === value}
            role="tab"
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'portfolio' && data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Card>
              <CardTitle>Стоимость позиций</CardTitle>
              <div className="mt-1 font-mono text-2xl font-semibold text-zinc-900">
                {formatUsd(data.positionsValueUsd)}
              </div>
              <CardDescription>По последним ценам</CardDescription>
            </Card>
            <Card>
              <CardTitle>Капитал</CardTitle>
              <div className="mt-1 font-mono text-2xl font-semibold text-zinc-900">
                {formatUsd(data.equityUsd)}
              </div>
              <CardDescription>Стоимость позиций + кэш</CardDescription>
            </Card>
            <Card>
              <CardTitle>Кэш</CardTitle>
              <div className="mt-1 font-mono text-2xl font-semibold text-zinc-900">
                {formatUsd(data.cashUsd)}
              </div>
              <CardDescription>Свободные USDT / USDC вне позиций</CardDescription>
            </Card>
            <Card>
              <CardTitle>Вложено из фиата</CardTitle>
              <div className="mt-1 font-mono text-2xl font-semibold text-zinc-900">
                {dashboardSummary.data ? formatUsd(dashboardSummary.data.netDepositsUsd) : '—'}
              </div>
              <CardDescription>Пополнения минус выводы</CardDescription>
            </Card>
          </div>

          {tokenSummaries.isPending ? <LoadingRows rows={4} /> : null}
          {tokenSummaries.isError ? (
            <ErrorState
              message={toRussianError(tokenSummaries.error, 'Не удалось загрузить сводку')}
              onRetry={() => void tokenSummaries.refetch()}
            />
          ) : null}
          {!tokenSummaries.isPending && !tokenSummaries.isError ? (
            <Card>
              <CardTitle>Портфель по токенам</CardTitle>
              <CardDescription>
                Консолидированные данные по токену: P&L, инвестиции в открытые ордера, текущий плюс
                и минус, оборот, средневзвешенный курс и количество ордеров.
              </CardDescription>
              {(tokenSummaries.data?.data ?? []).filter((item) => item.openOrdersCount > 0)
                .length === 0 ? (
                <p className="mt-4 text-sm text-zinc-600">Открытых ордеров нет.</p>
              ) : (
                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {(tokenSummaries.data?.data ?? [])
                    .filter((item) => item.openOrdersCount > 0)
                    .map((item) => (
                      <button
                        key={item.asset.id}
                        type="button"
                        onClick={() => setSelectedAssetId(item.asset.id)}
                        className="rounded-xl border border-zinc-200 p-3 text-left transition-colors hover:border-emerald-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
                      >
                        <div className="flex items-center gap-2">
                          <TokenIcon
                            logoUrl={item.asset.logoUrl}
                            symbol={item.asset.symbol}
                            className="h-8 w-8 text-[10px]"
                          />
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-zinc-900">
                              {item.asset.symbol}
                            </div>
                            <div className="truncate text-[11px] text-zinc-500">
                              {item.asset.name} · {item.asset.chainCode}
                            </div>
                          </div>
                          <span
                            className="ml-auto text-xs text-zinc-500"
                            title="Открытых / всего ордеров"
                          >
                            {item.openOrdersCount} / {item.ordersCount}
                          </span>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs sm:grid-cols-3">
                          <PortfolioMetric
                            label="P&L"
                            value={formatSignedUsd(item.totalPnlUsd)}
                            tone={pnlTone(item.totalPnlUsd)}
                            hint="Реализованный + нереализованный"
                          />
                          <PortfolioMetric
                            label="Инвестировано"
                            value={formatUsd(item.investedUsd)}
                            hint="Себестоимость открытых ордеров"
                          />
                          <PortfolioMetric
                            label="Плюс"
                            value={formatUsd(item.positiveUnrealizedUsd)}
                            tone="text-emerald-700"
                            hint="Нереализованная прибыль прибыльных ордеров"
                          />
                          <PortfolioMetric
                            label="Минус"
                            value={formatUsd(item.negativeUnrealizedUsd)}
                            tone="text-red-700"
                            hint="Нереализованный убыток убыточных ордеров"
                          />
                          <PortfolioMetric
                            label="Оборот"
                            value={formatUsd(item.turnoverUsd)}
                            hint="Все покупки и продажи"
                          />
                          <PortfolioMetric
                            label="Средний курс"
                            value={
                              item.breakEvenPriceUsd ? formatPrice(item.breakEvenPriceUsd) : '—'
                            }
                            hint="Курс выхода в ноль при закрытии всех сделок"
                          />
                        </div>
                      </button>
                    ))}
                </div>
              )}
            </Card>
          ) : null}

          <TokenBuyList
            positions={data.positions}
            onBuy={(asset, marketPriceUsd) => setBuyTarget({ asset, marketPriceUsd })}
            onManual={(asset) => {
              setManual({ assetId: asset.id, side: 'entry' });
            }}
          />
        </>
      ) : null}

      {tab === 'trades' ? <TradesPanel onOpenTrade={setSellGroup} logos={watchlistLogos} /> : null}
      {tab === 'robots' ? <TestingPage mode="bots" /> : null}
      {tab === 'strategies' ? <TestingPage mode="strategies" /> : null}

      <AssetDrawer
        assetId={selectedAssetId}
        logoFallback={selectedAssetId ? (watchlistLogos.get(selectedAssetId) ?? null) : null}
        onClose={() => setSelectedAssetId(null)}
        onBuy={(asset) => {
          setSelectedAssetId(null);
          setBuyTarget({
            asset,
            marketPriceUsd: positionByAsset.get(asset.id)?.priceUsd ?? null,
          });
        }}
      />

      {buyTarget ? (
        <TokenTradeDrawer
          token={buyTarget.asset}
          initialMode="buy"
          marketPriceUsd={buyTarget.marketPriceUsd}
          onClose={() => setBuyTarget(null)}
          onCompleted={refetchPositions}
          onManual={(input) => {
            setBuyTarget(null);
            setManual({
              assetId: input.asset.id,
              side: input.side === 'buy' ? 'entry' : 'exit',
              tradeGroupId: input.tradeGroupId ?? undefined,
            });
          }}
        />
      ) : null}

      {sellGroup ? (
        <TokenTradeDrawer
          token={sellGroup.asset}
          initialMode="sell"
          tradeGroupId={sellGroup.id}
          marketPriceUsd={positionByAsset.get(sellGroup.asset.id)?.priceUsd ?? null}
          onClose={() => setSellGroup(null)}
          onCompleted={refetchPositions}
          onManual={(input) => {
            setSellGroup(null);
            setManual({
              assetId: input.asset.id,
              side: 'exit',
              tradeGroupId: input.tradeGroupId ?? undefined,
            });
          }}
        />
      ) : null}

      <ManualTradeDialog
        key={`${manual?.assetId ?? 'none'}-${manual?.side ?? 'entry'}-${manual?.tradeGroupId ?? 'none'}`}
        open={Boolean(manual)}
        initialAssetId={manual?.assetId}
        initialSide={manual?.side}
        initialTradeGroupId={manual?.tradeGroupId}
        onClose={() => setManual(null)}
        onSaved={refetchPositions}
      />
    </div>
  );
}
