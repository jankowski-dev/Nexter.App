import { MiniLineChart } from '@/components/charts/mini-line-chart';
import { fetchWatchlistChart } from '@/lib/api';
import { sampleWeeklyPoints } from '@/lib/weekly-chart';
import { useQuery } from '@tanstack/react-query';
import type { WatchlistChartPoint } from '@nexter/contracts';

export function WeeklyPriceChart({ entryId, className }: { entryId: string; className?: string }) {
  const chart = useQuery({
    queryKey: ['token-chart', entryId, 90],
    queryFn: () => fetchWatchlistChart(entryId, 90),
    staleTime: (query) => {
      const points = query.state.data?.points;
      return points && points.length >= 2 ? 24 * 60 * 60 * 1000 : 5 * 60 * 1000;
    },
    gcTime: 7 * 24 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const weekly = sampleWeeklyPoints<WatchlistChartPoint>(chart.data?.points ?? []);
  const points = weekly.map((point) => ({
    label: point.date,
    value: Number(point.priceUsd),
  }));
  const positive = points.length > 1 && (points.at(-1)?.value ?? 0) >= (points[0]?.value ?? 0);

  if (chart.isPending) {
    return <div className="h-20 animate-pulse rounded-lg bg-zinc-100" />;
  }

  if (chart.isError || points.length < 2) {
    return (
      <div className="flex h-20 items-center justify-center rounded-lg border border-zinc-100 bg-zinc-50 text-[10px] text-zinc-400">
        Нет данных за 3 месяца
      </div>
    );
  }

  return (
    <div className={className}>
      <MiniLineChart points={points} color={positive ? '#059669' : '#dc2626'} />
      <div className="mt-0.5 flex items-center justify-between text-[9px] text-zinc-400">
        <span>3 мес</span>
        <span>{weekly.length >= 12 ? '12 недель' : `${weekly.length} нед.`}</span>
      </div>
    </div>
  );
}
