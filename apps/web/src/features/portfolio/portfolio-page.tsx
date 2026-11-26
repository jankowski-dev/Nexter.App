import { Card, CardTitle } from '@/components/ui/card';
import { NavIcon } from '@/components/nav-icon';
import { StatCard } from '@/components/ui/stat-card';
import { PageHeader } from '@/components/ui/page-header';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { TokenIcon } from '@/components/token-icon';
import { fetchDashboardSummary, fetchPortfolioTokenSummaries, fetchPositions } from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import {
  formatPct,
  formatPrice,
  formatSignedUsd,
  formatUsd,
  pluralizeRu,
  pnlTone,
} from '@/lib/format';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useCallback, useEffect, useState } from 'react';
import type { Asset, TradeGroupSummary } from '@nexter/contracts';
import { TradesPanel } from '../trades/trades-panel';
import { SwapRecoveryPanel } from '../trade/swap-recovery-panel';
import { TokenTradeDrawer } from '../trade/token-trade-drawer';
import { useWatchlistLogos } from '../watchlist/use-watchlist-logos';
import { AssetDrawer } from './asset-drawer';
import { PortfolioEquityCard } from './portfolio-equity-chart';
import { TokenBuyList } from './token-buy-list';
import { useRuntimeSettings } from '../settings/use-settings';
import { TestingPage } from '../testing/testing-page';
import { OperationsPage } from '../operations/operations-page';
import { WatchlistPage } from '../watchlist/watchlist-page';
import { ReportsPage } from '../reports/reports-page';
import { cryptoTabs, hashForTab, tabFromLocation, type CryptoTab } from './portfolio-tabs';

function PortfolioMetric({
  label,
  value,
  subvalue,
  subvalueTone,
  tone,
  hint,
  className,
}: {
  label: string;
  value: string;
  subvalue?: string;
  subvalueTone?: string;
  tone?: string;
  hint?: string;
  className?: string;
}) {
  return (
    <div title={hint} className={`text-right tabular-nums ${className ?? ''}`}>
      <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`mt-0.5 font-mono text-[13px] font-semibold ${tone ?? 'text-zinc-800'}`}>
        {value}
      </div>
      {subvalue ? (
        <div className={`mt-0.5 font-mono text-[11px] ${subvalueTone ?? 'text-zinc-500'}`}>
          {subvalue}
        </div>
      ) : null}
    </div>
  );
}

export function PortfolioPage() {
  const navigate = useNavigate();
  const runtime = useRuntimeSettings();
  const portfolioPoll = runtime.portfolioPollSeconds * 1000;
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [tab, setTab] = useState<CryptoTab>(() =>
    tabFromLocation(
      typeof window === 'undefined' ? '/portfolio' : window.location.pathname,
      typeof window === 'undefined' ? undefined : window.location.hash,
    ),
  );

  useEffect(() => {
    setTab(
      tabFromLocation(pathname, typeof window === 'undefined' ? undefined : window.location.hash),
    );
  }, [pathname]);

  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [buyTarget, setBuyTarget] = useState<{
    asset: Asset;
    marketPriceUsd: string | null;
  } | null>(null);
  const [sellGroup, setSellGroup] = useState<TradeGroupSummary | null>(null);
  const positions = useQuery({
    queryKey: ['positions'],
    queryFn: fetchPositions,
    refetchInterval: portfolioPoll,
  });
  const refetchPositions = useCallback(() => {
    void positions.refetch();
  }, [positions.refetch]);

  function openTradeGroup(group: TradeGroupSummary): void {
    if (group.status === 'closed') {
      void navigate({ to: '/trades/$tradeId', params: { tradeId: group.id } });
      return;
    }
    setSellGroup(group);
  }
  const watchlistLogos = useWatchlistLogos();
  const tokenSummaries = useQuery({
    queryKey: ['portfolio-token-summaries'],
    queryFn: fetchPortfolioTokenSummaries,
    enabled: tab === 'overview',
    refetchInterval: portfolioPoll,
  });
  const dashboardSummary = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: fetchDashboardSummary,
    enabled: tab === 'overview',
    refetchInterval: portfolioPoll * 2,
  });
  const activeTokenRows = (tokenSummaries.data?.data ?? []).filter(
    (item) => item.openOrdersCount > 0,
  );
  const totalActiveInvested = activeTokenRows.reduce(
    (sum, item) => sum + Number(item.investedUsd),
    0,
  );

  if (tab === 'overview' && positions.isPending) {
    return (
      <div className="space-y-6">
        <PageHeader title="Обзор" />
        <LoadingRows rows={8} />
      </div>
    );
  }

  if (tab === 'overview' && (positions.isError || !positions.data)) {
    return (
      <div className="space-y-6">
        <PageHeader title="Обзор" />
        <ErrorState
          message={toRussianError(positions.error, 'Не удалось загрузить позиции')}
          onRetry={refetchPositions}
        />
      </div>
    );
  }

  const data = positions.data;
  const activeTabLabel = cryptoTabs.find((item) => item.value === tab)?.label ?? 'Обзор';
  const positionByAsset = new Map(
    (data?.positions ?? []).map((position) => [position.asset.id, position]),
  );

  function changeTab(next: CryptoTab): void {
    setTab(next);
    setSelectedAssetId(null);
    setBuyTarget(null);
    setSellGroup(null);
    window.history.replaceState(null, '', `/portfolio${hashForTab(next)}`);
  }

  return (
    <div className="space-y-6">
      <PageHeader title={activeTabLabel} />

      <div
        role="tablist"
        aria-label="Раздел крипты"
        className="flex flex-wrap gap-1 rounded-lg border border-zinc-200 bg-zinc-50 p-1"
      >
        {cryptoTabs.map(({ value, label, icon }) => (
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
            <span className="inline-flex items-center gap-1.5">
              <NavIcon name={icon} className="h-4 w-4" />
              {label}
            </span>
          </button>
        ))}
      </div>

      {tab === 'overview' && data ? (
        <>
          <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
            <PortfolioEquityCard />
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-2">
              <StatCard
                title="Стоимость позиций"
                value={formatUsd(data.positionsValueUsd)}
                description="По последним ценам"
                icon="portfolio"
                tone="emerald"
                size="compact"
              />
              <StatCard
                title="Капитал"
                value={formatUsd(data.equityUsd)}
                description="Позиции + свободный капитал"
                icon="statistics"
                tone="sky"
                size="compact"
              />
              <StatCard
                title="Свободный капитал"
                value={formatUsd(data.cashUsd)}
                description="USDT / USDC вне позиций"
                icon="finance"
                tone="amber"
                size="compact"
              />
              <StatCard
                title="Мои инвестиции"
                value={
                  dashboardSummary.data ? formatUsd(dashboardSummary.data.netDepositsUsd) : '—'
                }
                description="Пополнения минус выводы"
                icon="operations"
                tone="violet"
                size="compact"
              />
            </div>
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
              {activeTokenRows.length === 0 ? (
                <p className="mt-4 text-sm text-zinc-600">Открытых ордеров нет.</p>
              ) : (
                <div className="mt-4 space-y-2">
                  {activeTokenRows.map((item) => {
                    const invested = Number(item.investedUsd);
                    const share =
                      totalActiveInvested > 0
                        ? Math.min(100, (invested / totalActiveInvested) * 100)
                        : 0;
                    const average = Number(item.breakEvenPriceUsd);
                    const market = Number(item.priceUsd);
                    const averageDeltaPct =
                      item.breakEvenPriceUsd &&
                      item.priceUsd &&
                      Number.isFinite(average) &&
                      Number.isFinite(market) &&
                      average > 0
                        ? ((market - average) / average) * 100
                        : null;

                    return (
                      <button
                        key={item.asset.id}
                        type="button"
                        aria-label={`Открыть статистику ${item.asset.symbol}`}
                        onClick={() => setSelectedAssetId(item.asset.id)}
                        className="block w-full cursor-pointer rounded-xl border border-zinc-200 p-3.5 text-left transition-colors hover:border-emerald-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
                      >
                        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 xl:flex-nowrap">
                          <div className="flex min-w-[150px] max-w-[210px] items-center gap-2.5">
                            <TokenIcon
                              logoUrl={watchlistLogos.get(item.asset.id) ?? item.asset.logoUrl}
                              symbol={item.asset.symbol}
                              className="h-9 w-9 text-[10px]"
                            />
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold text-zinc-900">
                                {item.asset.symbol}
                              </div>
                              <div className="truncate text-[11px] text-zinc-500">
                                {item.asset.name} · {item.asset.chainCode}
                              </div>
                            </div>
                          </div>
                          <div
                            className="min-w-[120px]"
                            title="Реализованный + нереализованный по активным ордерам"
                          >
                            <div className="text-[10px] text-zinc-500">P&L</div>
                            <div
                              className={`mt-0.5 font-mono text-xl font-semibold tracking-tight ${pnlTone(
                                item.totalPnlUsd,
                              )}`}
                            >
                              {formatSignedUsd(item.totalPnlUsd)}
                            </div>
                          </div>
                          <div
                            className="min-w-[145px]"
                            title="Текущий курс и изменение за 24 часа"
                          >
                            <div className="text-[10px] text-zinc-500">Курс</div>
                            <div className="mt-0.5 flex items-baseline gap-2">
                              <span
                                className={`font-mono text-lg font-semibold tracking-tight ${pnlTone(
                                  item.change24hPct,
                                )}`}
                              >
                                {formatPrice(item.priceUsd)}
                              </span>
                              <span className={`text-xs font-medium ${pnlTone(item.change24hPct)}`}>
                                {item.change24hPct ? formatPct(item.change24hPct) : '—'}
                              </span>
                            </div>
                          </div>
                          <div className="whitespace-nowrap text-[11px] text-zinc-500">
                            {item.openOrdersCount}{' '}
                            {pluralizeRu(item.openOrdersCount, 'ордер', 'ордера', 'ордеров')}
                          </div>
                          <div className="ml-auto grid min-w-0 grid-cols-2 gap-x-4 gap-y-2 text-right sm:grid-cols-3 xl:grid-cols-[110px_105px_85px_85px_125px] xl:justify-end">
                            <div
                              className="text-right"
                              title={`${formatUsd(item.investedUsd)} — ${share.toFixed(1)}% от всех активных инвестиций`}
                            >
                              <div className="text-[10px] text-zinc-500">Инвестировано</div>
                              <div className="mt-0.5 font-mono text-[13px] font-semibold tabular-nums text-zinc-800">
                                {formatUsd(item.investedUsd)}
                              </div>
                              <div className="mt-1 flex items-center justify-end gap-1.5">
                                <div className="h-1.5 w-16 overflow-hidden rounded-full bg-zinc-200">
                                  <div
                                    className="h-full rounded-full bg-emerald-500"
                                    style={{ width: `${Math.max(2, share)}%` }}
                                  />
                                </div>
                                <span className="text-[10px] text-zinc-500">
                                  {share.toFixed(0)}%
                                </span>
                              </div>
                            </div>
                            <PortfolioMetric
                              className="text-right"
                              label="Капитал"
                              value={formatUsd(item.currentValueUsd)}
                              hint="Текущая стоимость активных токенов по рынку"
                            />
                            <PortfolioMetric
                              className="text-right"
                              label="Плюс"
                              value={formatUsd(item.positiveUnrealizedUsd)}
                              tone="text-emerald-700"
                              hint="Нереализованная прибыль прибыльных активных ордеров"
                            />
                            <PortfolioMetric
                              className="text-right"
                              label="Минус"
                              value={formatUsd(item.negativeUnrealizedUsd)}
                              tone="text-red-700"
                              hint="Нереализованный убыток убыточных активных ордеров"
                            />
                            <PortfolioMetric
                              className="text-right"
                              label="Средний курс"
                              value={
                                item.breakEvenPriceUsd ? formatPrice(item.breakEvenPriceUsd) : '—'
                              }
                              subvalue={
                                averageDeltaPct === null
                                  ? undefined
                                  : `${averageDeltaPct >= 0 ? '+' : '−'}${Math.abs(
                                      averageDeltaPct,
                                    ).toFixed(1)}% к рынку`
                              }
                              subvalueTone={pnlTone(
                                averageDeltaPct === null ? null : String(averageDeltaPct),
                              )}
                              hint="Курс выхода в ноль при закрытии всех сделок. Ниже — разница между текущим рынком и средним курсом."
                            />
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </Card>
          ) : null}

          <TokenBuyList
            onBuy={(asset, marketPriceUsd) => setBuyTarget({ asset, marketPriceUsd })}
          />
        </>
      ) : null}

      {tab === 'tokens' ? <WatchlistPage embedded /> : null}
      {tab === 'orders' ? (
        <>
          <SwapRecoveryPanel />
          <TradesPanel mode="journal" onOpenGroup={openTradeGroup} logos={watchlistLogos} />
        </>
      ) : null}
      {tab === 'operations' ? <OperationsPage embedded /> : null}
      {tab === 'robots' ? <TestingPage /> : null}
      {tab === 'statistics' ? <ReportsPage embedded /> : null}

      <AssetDrawer
        assetId={selectedAssetId}
        logoFallback={selectedAssetId ? (watchlistLogos.get(selectedAssetId) ?? null) : null}
        onClose={() => setSelectedAssetId(null)}
        onOpenOrder={(group) => setSellGroup(group)}
      />

      {buyTarget ? (
        <TokenTradeDrawer
          token={buyTarget.asset}
          initialMode="buy"
          marketPriceUsd={buyTarget.marketPriceUsd}
          onClose={() => setBuyTarget(null)}
          onCompleted={refetchPositions}
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
        />
      ) : null}
    </div>
  );
}
