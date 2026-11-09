import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { fetchPositions } from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import {
  formatCount,
  formatPct,
  formatSignedUsd,
  formatTokenAmount,
  formatUsd,
  pnlTone,
} from '@/lib/format';
import { useQuery } from '@tanstack/react-query';
import { Decimal } from 'decimal.js';
import { useState } from 'react';
import type { TradeGroupSummary } from '@nexter/contracts';
import { TradesPanel } from '../trades/trades-panel';
import { TradeDialog } from '../trade/trade-dialog';
import { AssetDrawer } from './asset-drawer';
import { CloseTradesDialog } from './close-trades-dialog';
import { MassCloseDrawer } from './mass-close-drawer';
import { TradeDrawer } from './trade-drawer';

type PortfolioTab = 'portfolio' | 'trades';

interface TradeInitial {
  side: 'entry' | 'exit';
  assetId: string;
}

export function PortfolioPage() {
  const [tab, setTab] = useState<PortfolioTab>(() =>
    typeof window !== 'undefined' && window.location.hash === '#trades' ? 'trades' : 'portfolio',
  );
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [selectedGroups, setSelectedGroups] = useState<TradeGroupSummary[]>([]);
  const [tradeDrawerId, setTradeDrawerId] = useState<string | null>(null);
  const [massDrawerOpen, setMassDrawerOpen] = useState(false);
  const [closeGroups, setCloseGroups] = useState<TradeGroupSummary[]>([]);
  const [closeOpen, setCloseOpen] = useState(false);
  const [tradeOpen, setTradeOpen] = useState(false);
  const [tradeInitial, setTradeInitial] = useState<TradeInitial>({
    side: 'entry',
    assetId: '',
  });
  const positions = useQuery({ queryKey: ['positions'], queryFn: fetchPositions });

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
          onRetry={() => void positions.refetch()}
        />
      </div>
    );
  }

  const data = positions.data;
  const sortedPositions = [...data.positions].sort((a, b) =>
    new Decimal(b.costBasisUsd).comparedTo(a.costBasisUsd),
  );

  function changeTab(next: PortfolioTab): void {
    setTab(next);
    setSelectedGroups([]);
    setTradeDrawerId(null);
    setMassDrawerOpen(false);
    window.history.replaceState(null, '', next === 'trades' ? '#trades' : '#portfolio');
  }

  function openNewTrade(): void {
    setTradeInitial({ side: 'entry', assetId: '' });
    setTradeOpen(true);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Портфель"
        subtitle="Активы, сделки и статистика по токенам."
        actions={
          <>
            {tab === 'trades' && selectedGroups.length > 0 ? (
              <Button variant="danger" onClick={() => setMassDrawerOpen(true)}>
                Закрыть сделки ({formatCount(selectedGroups.length)})
              </Button>
            ) : null}
            <Button onClick={openNewTrade}>Новая сделка</Button>
          </>
        }
      />

      <div className="flex gap-1 rounded-lg border border-zinc-200 bg-zinc-50 p-1">
        <button
          type="button"
          onClick={() => changeTab('portfolio')}
          className={`rounded-md px-4 py-2 text-sm ${
            tab === 'portfolio'
              ? 'bg-white text-zinc-900 shadow-sm'
              : 'text-zinc-500 hover:text-zinc-900'
          }`}
          aria-selected={tab === 'portfolio'}
          role="tab"
        >
          Портфель
        </button>
        <button
          type="button"
          onClick={() => changeTab('trades')}
          className={`rounded-md px-4 py-2 text-sm ${
            tab === 'trades'
              ? 'bg-white text-zinc-900 shadow-sm'
              : 'text-zinc-500 hover:text-zinc-900'
          }`}
          aria-selected={tab === 'trades'}
          role="tab"
        >
          Сделки
        </button>
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

          <Card>
            <CardTitle>Позиции по активам</CardTitle>
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
                      <th className="py-2 pr-3 text-right font-medium">P&L</th>
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
                              className="text-left font-medium text-zinc-800 hover:text-emerald-800"
                              aria-label={`Открыть статистику ${position.asset.symbol}`}
                            >
                              {position.asset.symbol}
                            </button>
                            <div className="text-xs text-zinc-500">
                              {position.asset.chainCode}
                              {!position.asset.isVerified ? ' · unverified' : ''}
                            </div>
                          </td>
                          <td className="py-2 pr-3 text-right font-mono tabular-nums text-zinc-700">
                            {formatTokenAmount(position.amount)}
                          </td>
                          <td className="py-2 pr-3 text-right font-mono tabular-nums text-zinc-600">
                            {formatUsd(position.priceUsd)}
                          </td>
                          <td className="py-2 pr-3 text-right font-mono tabular-nums text-zinc-600">
                            {formatUsd(position.avgCostUsd)}
                          </td>
                          <td className="py-2 pr-3 text-right font-mono tabular-nums text-zinc-800">
                            {formatUsd(position.valueUsd)}
                          </td>
                          <td className="py-2 pr-3 text-right font-mono tabular-nums text-zinc-600">
                            {formatUsd(position.costBasisUsd)}
                          </td>
                          <td
                            className={`py-2 pr-3 text-right font-mono tabular-nums ${pnlTone(position.unrealizedPnlUsd)}`}
                          >
                            {formatSignedUsd(position.unrealizedPnlUsd)}
                          </td>
                          <td className="py-2 pr-3 text-right font-mono tabular-nums text-zinc-600">
                            {share === null ? '—' : formatPct(String(share))}
                          </td>
                          <td className="py-2 text-right">
                            <Button
                              variant="ghost"
                              className="h-8 px-3 text-xs"
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
        </>
      ) : (
        <TradesPanel
          selectedIds={selectedGroups.map((group) => group.id)}
          onSelectionChange={setSelectedGroups}
          onOpenTrade={setTradeDrawerId}
        />
      )}

      <AssetDrawer
        assetId={selectedAssetId}
        onClose={() => setSelectedAssetId(null)}
        onTrade={(input) => {
          setTradeInitial({ side: input.side, assetId: input.assetId });
          setTradeOpen(true);
        }}
      />
      <TradeDrawer
        tradeId={tradeDrawerId}
        onClose={() => setTradeDrawerId(null)}
        onCloseTrade={(group) => {
          setCloseGroups([group]);
          setCloseOpen(true);
        }}
      />
      <MassCloseDrawer
        open={massDrawerOpen}
        onClose={() => setMassDrawerOpen(false)}
        groups={selectedGroups}
        onCloseTrades={(groups) => {
          setCloseGroups(groups);
          setCloseOpen(true);
        }}
      />
      <CloseTradesDialog
        open={closeOpen}
        onClose={() => {
          setCloseOpen(false);
          setCloseGroups([]);
        }}
        groups={closeGroups}
        onCompleted={() => setSelectedGroups([])}
      />
      <TradeDialog
        open={tradeOpen}
        onClose={() => setTradeOpen(false)}
        initialMode="trade"
        initialSide={tradeInitial.side}
        initialAssetId={tradeInitial.assetId}
      />
    </div>
  );
}
