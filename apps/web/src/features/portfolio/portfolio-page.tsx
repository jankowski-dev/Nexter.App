import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { TokenIcon } from '@/components/token-icon';
import { fetchPositions } from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import {
  formatCount,
  formatPct,
  formatPrice,
  formatSignedUsd,
  formatTokenAmount,
  formatUsd,
  pnlTone,
} from '@/lib/format';
import { useQuery } from '@tanstack/react-query';
import { Decimal } from 'decimal.js';
import { useCallback, useState } from 'react';
import { useLiveFlash } from '@/lib/use-live-flash';
import type { Asset, TradeGroupSummary } from '@nexter/contracts';
import { TradesPanel } from '../trades/trades-panel';
import { ManualTradeDialog } from '../trade/manual-trade-dialog';
import { TokenTradeDrawer } from '../trade/token-trade-drawer';
import { useWatchlistLogos } from '../watchlist/use-watchlist-logos';
import { AssetDrawer } from './asset-drawer';
import { TokenBuyList } from './token-buy-list';

type PortfolioTab = 'portfolio' | 'trades';
type PortfolioView = 'positions' | 'main';

function tabFromHash(): PortfolioTab {
  if (typeof window === 'undefined') return 'portfolio';
  return window.location.hash === '#trades' ? 'trades' : 'portfolio';
}

function viewFromHash(): PortfolioView {
  if (typeof window === 'undefined') return 'positions';
  return window.location.hash === '#list' || window.location.hash === '#buy' ? 'main' : 'positions';
}

export function PortfolioPage() {
  const [tab, setTab] = useState<PortfolioTab>(tabFromHash);
  const [portfolioView, setPortfolioView] = useState<PortfolioView>(viewFromHash);
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
  const positionsFlash = useLiveFlash(positions.dataUpdatedAt);
  const refetchPositions = useCallback(() => {
    void positions.refetch();
  }, [positions.refetch]);
  const watchlistLogos = useWatchlistLogos();

  if (positions.isPending) {
    return (
      <div className="space-y-6">
        <PageHeader title="Портфель" subtitle="Загружаю позиции и сделки…" />
        <LoadingRows rows={8} />
      </div>
    );
  }

  if (positions.isError || !positions.data) {
    return (
      <div className="space-y-6">
        <PageHeader title="Портфель" />
        <ErrorState
          message={toRussianError(positions.error, 'Не удалось загрузить позиции')}
          onRetry={refetchPositions}
        />
      </div>
    );
  }

  const data = positions.data;
  const sortedPositions = [...data.positions].sort((a, b) =>
    new Decimal(b.costBasisUsd).comparedTo(a.costBasisUsd),
  );
  const positionByAsset = new Map(data.positions.map((position) => [position.asset.id, position]));

  function changeTab(next: PortfolioTab): void {
    setTab(next);
    setSelectedAssetId(null);
    setBuyTarget(null);
    setSellGroup(null);
    window.history.replaceState(
      null,
      '',
      next === 'trades' ? '#trades' : portfolioView === 'main' ? '#list' : '#portfolio',
    );
  }

  function changePortfolioView(next: PortfolioView): void {
    setPortfolioView(next);
    window.history.replaceState(null, '', next === 'main' ? '#list' : '#portfolio');
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Портфель"
        subtitle="Позиции, покупка токенов и сделки."
        actions={
          <Button variant="secondary" onClick={() => setManual({})}>
            Ручная сделка
          </Button>
        }
      />

      <div
        role="tablist"
        aria-label="Раздел портфеля"
        className="flex flex-wrap gap-1 rounded-lg border border-zinc-200 bg-zinc-50 p-1"
      >
        {(
          [
            ['portfolio', 'Портфель'],
            ['trades', 'Сделки'],
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

      {tab === 'portfolio' ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Card>
              <CardTitle>Кэш</CardTitle>
              <div className="mt-1 font-mono text-2xl font-semibold text-zinc-900">
                {formatUsd(data.cashUsd)}
              </div>
              <CardDescription>Свободные USDT / USDC вне позиций</CardDescription>
            </Card>
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
              <CardDescription>Кэш + стоимость позиций</CardDescription>
            </Card>
            <Card>
              <CardTitle>Позиций</CardTitle>
              <div className="mt-1 font-mono text-2xl font-semibold text-zinc-900">
                {formatCount(data.positions.length)}
              </div>
              <CardDescription>
                {data.missingPrices.length > 0
                  ? `Без цен: ${data.missingPrices.join(', ')}`
                  : 'Все позиции оценены'}
              </CardDescription>
            </Card>
          </div>

          <div
            role="tablist"
            aria-label="Вид портфеля"
            className="flex w-fit flex-wrap gap-1 rounded-lg border border-zinc-200 bg-zinc-50 p-1"
          >
            {(
              [
                ['positions', 'Позиции по активам'],
                ['main', 'Основной список'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => changePortfolioView(value)}
                className={`rounded-md px-3 py-1.5 text-sm ${
                  portfolioView === value
                    ? 'bg-white text-zinc-900 shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-900'
                }`}
                aria-selected={portfolioView === value}
                role="tab"
              >
                {label}
              </button>
            ))}
          </div>

          {portfolioView === 'positions' ? (
            <Card className={positionsFlash ? 'live-flash' : ''}>
              <CardDescription>
                Нажми на токен, чтобы открыть статистику, лоты и сделки в боковой панели.
              </CardDescription>
              {sortedPositions.length === 0 ? (
                <p className="mt-4 text-sm text-zinc-600">Позиций нет.</p>
              ) : (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
                        <th className="py-2 pr-3 font-medium">Актив</th>
                        <th className="py-2 pr-3 text-right font-medium">Количество</th>
                        <th className="py-2 pr-3 text-right font-medium">Цена</th>
                        <th className="py-2 pr-3 text-right font-medium">Средняя цена</th>
                        <th className="py-2 pr-3 text-right font-medium">Стоимость</th>
                        <th className="py-2 pr-3 text-right font-medium">Себестоимость</th>
                        <th className="py-2 pr-3 text-right font-medium">Результат</th>
                        <th className="py-2 pr-3 text-right font-medium">Доля</th>
                        <th className="py-2 text-right font-medium">Действие</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedPositions.map((position) => {
                        const share =
                          Number(data.equityUsd) > 0 && position.valueUsd
                            ? (Number(position.valueUsd) / Number(data.equityUsd)) * 100
                            : null;

                        return (
                          <tr
                            key={position.asset.id}
                            className="border-b border-zinc-100 last:border-0 odd:bg-zinc-50/60 hover:bg-zinc-100/70"
                          >
                            <td className="py-2 pr-3">
                              <button
                                type="button"
                                onClick={() => setSelectedAssetId(position.asset.id)}
                                className="flex items-center gap-2 text-left"
                                aria-label={`Открыть статистику ${position.asset.symbol}`}
                              >
                                <TokenIcon
                                  logoUrl={
                                    position.asset.logoUrl ??
                                    watchlistLogos.get(position.asset.id) ??
                                    null
                                  }
                                  symbol={position.asset.symbol}
                                />
                                <span className="min-w-0">
                                  <span className="block font-medium text-zinc-800 hover:text-emerald-800">
                                    {position.asset.symbol}
                                  </span>
                                  <span className="block text-xs text-zinc-500">
                                    {position.asset.chainCode}
                                    {!position.asset.isVerified ? ' · не проверен' : ''}
                                  </span>
                                </span>
                              </button>
                            </td>
                            <td className="py-2 pr-3 text-right font-mono tabular-nums text-zinc-700">
                              {formatTokenAmount(position.amount, 8)}
                            </td>
                            <td className="py-2 pr-3 text-right font-mono tabular-nums text-zinc-700">
                              {formatPrice(position.priceUsd)}
                            </td>
                            <td className="py-2 pr-3 text-right font-mono tabular-nums text-zinc-600">
                              {formatPrice(position.avgCostUsd)}
                            </td>
                            <td className="py-2 pr-3 text-right font-mono tabular-nums text-zinc-800">
                              {formatUsd(position.valueUsd)}
                            </td>
                            <td className="py-2 pr-3 text-right font-mono tabular-nums text-zinc-600">
                              {formatUsd(position.costBasisUsd)}
                            </td>
                            <td
                              className={`py-2 pr-3 text-right font-mono tabular-nums ${pnlTone(
                                position.unrealizedPnlUsd,
                              )}`}
                            >
                              {formatSignedUsd(position.unrealizedPnlUsd)}
                            </td>
                            <td className="py-2 pr-3 text-right font-mono tabular-nums text-zinc-600">
                              {share === null ? '—' : `${formatPct(share.toFixed(2))}`}
                            </td>
                            <td className="py-2 text-right">
                              <Button
                                variant="ghost"
                                className="h-8 px-2 text-xs"
                                onClick={() => setSelectedAssetId(position.asset.id)}
                              >
                                Статистика
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          ) : (
            <TokenBuyList
              positions={data.positions}
              showHeading={false}
              onBuy={(asset, marketPriceUsd) => setBuyTarget({ asset, marketPriceUsd })}
              onManual={(asset) => {
                setManual({ assetId: asset.id, side: 'entry' });
              }}
            />
          )}
        </>
      ) : null}

      {tab === 'trades' ? <TradesPanel onOpenTrade={setSellGroup} logos={watchlistLogos} /> : null}

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
