import { LineChart } from '@/components/charts/line-chart';
import { Button } from '@/components/ui/button';
import { fetchWatchlistChart } from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import { formatPrice } from '@/lib/format';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

const RANGES = [30, 90, 180, 365] as const;

export function TokenPriceChart({ entryId }: { entryId: string }) {
  const [days, setDays] = useState<(typeof RANGES)[number]>(90);
  const chart = useQuery({
    queryKey: ['watchlist-chart', entryId, days],
    queryFn: () => fetchWatchlistChart(entryId, days),
    staleTime: 5 * 60 * 1000,
  });

  const points =
    chart.data?.points.map((point) => ({
      label: point.date,
      value: Number(point.priceUsd),
    })) ?? [];
  const positive = points.length > 1 && (points.at(-1)?.value ?? 0) >= (points[0]?.value ?? 0);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            График стоимости
          </div>
          {chart.data ? (
            <div className="text-xs text-zinc-500">
              {chart.data.points.length > 0
                ? `${chart.data.points.length} дн. · ${chart.data.source === 'geckoterminal' ? 'GeckoTerminal' : chart.data.source === 'coingecko' ? 'CoinGecko' : 'нет данных'}`
                : 'Нет исторических данных'}
            </div>
          ) : null}
        </div>
        <div className="flex gap-1">
          {RANGES.map((range) => (
            <Button
              key={range}
              type="button"
              variant={days === range ? 'primary' : 'secondary'}
              className="h-7 px-2 text-xs"
              onClick={() => setDays(range)}
            >
              {range === 365 ? '1г' : `${range}д`}
            </Button>
          ))}
        </div>
      </div>

      {chart.isPending ? (
        <div className="mt-3 h-40 animate-pulse rounded-lg bg-zinc-100" />
      ) : chart.isError ? (
        <p className="mt-3 text-sm text-red-700">
          {toRussianError(chart.error, 'Не удалось загрузить график')}
        </p>
      ) : points.length < 2 ? (
        <p className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-500">
          Недостаточно исторических данных: источник пока не отдал дневные цены.
        </p>
      ) : (
        <div className="mt-2">
          <LineChart
            points={points}
            height={220}
            color={positive ? '#059669' : '#dc2626'}
            formatValue={(value) => formatPrice(String(value))}
            formatTick={(value) => formatPrice(String(value))}
          />
        </div>
      )}
    </div>
  );
}
