import { Badge } from '@/components/ui/badge';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { fetchAccounts, fetchPositions } from '@/lib/api';
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
import { Link } from '@tanstack/react-router';
import { useState } from 'react';

const accountTypeLabels: Record<string, string> = {
  wallet: 'Кошелёк',
  external: 'Внешний',
  income: 'Доход',
  expense: 'Расход',
  equity: 'Капитал',
};

export function PortfolioPage() {
  const [tab, setTab] = useState<'positions' | 'accounts'>('positions');
  const positions = useQuery({ queryKey: ['positions'], queryFn: fetchPositions });
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: fetchAccounts });

  const isLoading = positions.isPending || accounts.isPending;

  return (
    <div className="space-y-6">
      <PageHeader title="Портфель" subtitle="Текущие позиции, себестоимость и счета." />

      <div className="flex gap-1 rounded-lg border border-zinc-800 bg-zinc-900/40 p-1">
        <button
          type="button"
          onClick={() => setTab('positions')}
          className={`rounded-md px-4 py-2 text-sm ${tab === 'positions' ? 'bg-zinc-800 text-zinc-50' : 'text-zinc-400 hover:text-zinc-200'}`}
          aria-selected={tab === 'positions'}
          role="tab"
        >
          Позиции
        </button>
        <button
          type="button"
          onClick={() => setTab('accounts')}
          className={`rounded-md px-4 py-2 text-sm ${tab === 'accounts' ? 'bg-zinc-800 text-zinc-50' : 'text-zinc-400 hover:text-zinc-200'}`}
          aria-selected={tab === 'accounts'}
          role="tab"
        >
          Счета
        </button>
      </div>

      {isLoading ? <LoadingRows rows={8} /> : null}

      {positions.isError ? (
        <ErrorState
          message={toRussianError(positions.error, 'Не удалось загрузить позиции')}
          onRetry={() => void positions.refetch()}
        />
      ) : null}

      {!isLoading && tab === 'positions' && positions.data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Card>
              <CardTitle>Кэш</CardTitle>
              <div className="mt-1 font-mono text-2xl font-semibold text-zinc-50">
                {formatUsd(positions.data.cashUsd)}
              </div>
            </Card>
            <Card>
              <CardTitle>Стоимость позиций</CardTitle>
              <div className="mt-1 font-mono text-2xl font-semibold text-zinc-50">
                {formatUsd(positions.data.positionsValueUsd)}
              </div>
            </Card>
            <Card>
              <CardTitle>Капитал</CardTitle>
              <div className="mt-1 font-mono text-2xl font-semibold text-zinc-50">
                {formatUsd(positions.data.equityUsd)}
              </div>
            </Card>
            <Card>
              <CardTitle>Позиций</CardTitle>
              <div className="mt-1 font-mono text-2xl font-semibold text-zinc-50">
                {formatCount(positions.data.positions.length)}
              </div>
              <CardDescription>
                {positions.data.missingPrices.length > 0
                  ? `Без цен: ${positions.data.missingPrices.join(', ')}`
                  : 'Все позиции оценены'}
              </CardDescription>
            </Card>
          </div>

          <Card>
            <CardTitle>Позиции по активам</CardTitle>
            <CardDescription>
              Стоимость рассчитана по последней цене; себестоимость — по оставшимся лотам.
            </CardDescription>
            {positions.data.positions.length === 0 ? (
              <p className="mt-4 text-sm text-zinc-400">Позиций нет.</p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800 text-left text-xs text-zinc-500">
                      <th className="py-2 pr-3 font-medium">Актив</th>
                      <th className="py-2 pr-3 text-right font-medium">Количество</th>
                      <th className="py-2 pr-3 text-right font-medium">Цена</th>
                      <th className="py-2 pr-3 text-right font-medium">Средняя цена</th>
                      <th className="py-2 pr-3 text-right font-medium">Стоимость</th>
                      <th className="py-2 pr-3 text-right font-medium">Себестоимость</th>
                      <th className="py-2 pr-3 text-right font-medium">P&L</th>
                      <th className="py-2 text-right font-medium">Доля</th>
                    </tr>
                  </thead>
                  <tbody>
                    {positions.data.positions.map((position) => {
                      const share =
                        Number(positions.data.equityUsd) > 0 && position.valueUsd
                          ? (Number(position.valueUsd) / Number(positions.data.equityUsd)) * 100
                          : null;

                      return (
                        <tr
                          key={position.asset.id}
                          className="border-b border-zinc-800/60 last:border-0"
                        >
                          <td className="py-2 pr-3">
                            <Link
                              to="/portfolio/assets/$assetId"
                              params={{ assetId: position.asset.id }}
                              className="font-medium text-zinc-200 hover:text-emerald-300"
                            >
                              {position.asset.symbol}
                            </Link>
                            <div className="text-xs text-zinc-500">
                              {position.asset.chainCode}
                              {!position.asset.isVerified ? ' · unverified' : ''}
                            </div>
                          </td>
                          <td className="py-2 pr-3 text-right font-mono tabular-nums text-zinc-300">
                            {formatTokenAmount(position.amount)}
                          </td>
                          <td className="py-2 pr-3 text-right font-mono tabular-nums text-zinc-400">
                            {formatUsd(position.priceUsd)}
                          </td>
                          <td className="py-2 pr-3 text-right font-mono tabular-nums text-zinc-400">
                            {formatUsd(position.avgCostUsd)}
                          </td>
                          <td className="py-2 pr-3 text-right font-mono tabular-nums text-zinc-200">
                            {formatUsd(position.valueUsd)}
                          </td>
                          <td className="py-2 pr-3 text-right font-mono tabular-nums text-zinc-400">
                            {formatUsd(position.costBasisUsd)}
                          </td>
                          <td
                            className={`py-2 pr-3 text-right font-mono tabular-nums ${pnlTone(position.unrealizedPnlUsd)}`}
                          >
                            {formatSignedUsd(position.unrealizedPnlUsd)}
                          </td>
                          <td className="py-2 text-right font-mono tabular-nums text-zinc-400">
                            {share === null ? '—' : formatPct(String(share))}
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
      ) : null}

      {!isLoading && tab === 'accounts' && accounts.data ? (
        <Card>
          <CardTitle>Счета</CardTitle>
          <CardDescription>Системные и кошельковые счета учёта.</CardDescription>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-left text-xs text-zinc-500">
                  <th className="py-2 pr-3 font-medium">Название</th>
                  <th className="py-2 pr-3 font-medium">Тип</th>
                  <th className="py-2 pr-3 font-medium">Сеть</th>
                  <th className="py-2 text-right font-medium">Системный</th>
                </tr>
              </thead>
              <tbody>
                {accounts.data.accounts.map((account) => (
                  <tr key={account.id} className="border-b border-zinc-800/60 last:border-0">
                    <td className="py-2 pr-3 text-zinc-200">{account.name}</td>
                    <td className="py-2 pr-3 text-zinc-400">
                      {accountTypeLabels[account.type] ?? account.type}
                    </td>
                    <td className="py-2 pr-3 text-zinc-400">{account.chainCode ?? '—'}</td>
                    <td className="py-2 text-right">
                      <Badge tone={account.isSystem ? 'info' : 'neutral'}>
                        {account.isSystem ? 'да' : 'нет'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
