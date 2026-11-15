import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { NavIcon, type NavIconName } from '@/components/nav-icon';
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
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useState } from 'react';
import type { Asset, TradeGroupSummary } from '@nexter/contracts';
import { TradesPanel } from '../trades/trades-panel';
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
  className,
}: {
  label: string;
  value: string;
  tone?: string;
  hint?: string;
  className?: string;
}) {
  return (
    <div title={hint} className={className}>
      <div className="text-[10px] text-zinc-500">{label}</div>
      <div className={`mt-0.5 font-mono text-xs ${tone ?? 'text-zinc-800'}`}>{value}</div>
    </div>
  );
}

const statTones = {
  emerald: {
    card: 'tone-surface tone-surface-emerald',
    title: 'text-emerald-800',
    icon: 'bg-emerald-100 text-emerald-700',
    value: 'text-emerald-950',
    description: 'text-emerald-800/60',
  },
  sky: {
    card: 'tone-surface tone-surface-sky',
    title: 'text-sky-800',
    icon: 'bg-sky-100 text-sky-700',
    value: 'text-sky-950',
    description: 'text-sky-800/60',
  },
  amber: {
    card: 'tone-surface tone-surface-amber',
    title: 'text-amber-800',
    icon: 'bg-amber-100 text-amber-700',
    value: 'text-amber-950',
    description: 'text-amber-800/60',
  },
  violet: {
    card: 'tone-surface tone-surface-violet',
    title: 'text-violet-800',
    icon: 'bg-violet-100 text-violet-700',
    value: 'text-violet-950',
    description: 'text-violet-800/60',
  },
} as const;

function PortfolioStatCard({
  title,
  value,
  description,
  icon,
  tone,
}: {
  title: string;
  value: string;
  description: string;
  icon: NavIconName;
  tone: keyof typeof statTones;
}) {
  const styles = statTones[tone];
  return (
    <Card className={`relative overflow-hidden ${styles.card}`}>
      <div className="flex items-start justify-between gap-3">
        <CardTitle className={styles.title}>{title}</CardTitle>
        <span
          className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${styles.icon}`}
        >
          <NavIcon name={icon} className="h-4 w-4" />
        </span>
      </div>
      <div className={`mt-1 font-mono text-3xl font-semibold tracking-tight ${styles.value}`}>
        {value}
      </div>
      <CardDescription className={styles.description}>{description}</CardDescription>
    </Card>
  );
}

export function PortfolioPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<PortfolioTab>(tabFromHash);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [buyTarget, setBuyTarget] = useState<{
    asset: Asset;
    marketPriceUsd: string | null;
  } | null>(null);
  const [sellGroup, setSellGroup] = useState<TradeGroupSummary | null>(null);
  const positions = useQuery({
    queryKey: ['positions'],
    queryFn: fetchPositions,
    refetchInterval: 15_000,
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
    enabled: tab === 'portfolio',
    refetchInterval: 15_000,
  });
  const dashboardSummary = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: fetchDashboardSummary,
    enabled: tab === 'portfolio',
    refetchInterval: 30_000,
  });
  const activeTokenRows = (tokenSummaries.data?.data ?? []).filter(
    (item) => item.openOrdersCount > 0,
  );
  const totalActiveInvested = activeTokenRows.reduce(
    (sum, item) => sum + Number(item.investedUsd),
    0,
  );

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
            <PortfolioStatCard
              title="Стоимость позиций"
              value={formatUsd(data.positionsValueUsd)}
              description="По последним ценам"
              icon="portfolio"
              tone="emerald"
            />
            <PortfolioStatCard
              title="Капитал"
              value={formatUsd(data.equityUsd)}
              description="Стоимость позиций + свободный капитал"
              icon="statistics"
              tone="sky"
            />
            <PortfolioStatCard
              title="Свободный капитал"
              value={formatUsd(data.cashUsd)}
              description="USDT / USDC вне позиций"
              icon="finance"
              tone="amber"
            />
            <PortfolioStatCard
              title="Мои инвестиции"
              value={dashboardSummary.data ? formatUsd(dashboardSummary.data.netDepositsUsd) : '—'}
              description="Пополнения минус выводы"
              icon="operations"
              tone="violet"
            />
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
                          <div className="ml-auto grid min-w-0 flex-1 grid-cols-2 gap-x-5 gap-y-2 text-right sm:grid-cols-3 xl:grid-cols-5">
                            <div
                              className="text-right"
                              title={`${formatUsd(item.investedUsd)} — ${share.toFixed(1)}% от всех активных инвестиций`}
                            >
                              <div className="text-[10px] text-zinc-500">Инвестировано</div>
                              <div className="mt-0.5 font-mono text-xs text-zinc-800">
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
                              hint="Курс выхода в ноль при закрытии всех сделок"
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

      {tab === 'trades' ? (
        <TradesPanel onOpenTrade={openTradeGroup} logos={watchlistLogos} />
      ) : null}
      {tab === 'robots' ? <TestingPage mode="bots" /> : null}
      {tab === 'strategies' ? <TestingPage mode="strategies" /> : null}

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
