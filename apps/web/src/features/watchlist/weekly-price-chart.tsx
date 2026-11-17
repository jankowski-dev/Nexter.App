import { MiniLineChart } from '@/components/charts/mini-line-chart';
import { fetchWatchlistChart } from '@/lib/api';
import { sampleWeeklyPoints } from '@/lib/weekly-chart';
import { useQuery } from '@tanstack/react-query';
import type { WatchlistChartPoint } from '@nexter/contracts';
import { useEffect, useRef, useState } from 'react';

export function WeeklyPriceChart({
  entryId,
  className,
  compact = false,
}: {
  entryId: string;
  className?: string;
  compact?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const chart = useQuery({
    queryKey: ['token-chart', entryId, 90],
    queryFn: () => fetchWatchlistChart(entryId, 90),
    enabled: visible,
    staleTime: (query) => {
      const points = query.state.data?.points;
      return points && points.length >= 2 ? 24 * 60 * 60 * 1000 : 5 * 60 * 1000;
    },
    gcTime: 7 * 24 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  useEffect(() => {
    if (visible) return;
    const node = containerRef.current;
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '240px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible]);

  const weekly = sampleWeeklyPoints<WatchlistChartPoint>(chart.data?.points ?? []);
  const points = weekly.map((point) => ({
    label: point.date,
    value: Number(point.priceUsd),
  }));
  const positive = points.length > 1 && (points.at(-1)?.value ?? 0) >= (points[0]?.value ?? 0);
  const placeholderHeight = compact ? 'h-11' : 'h-20';

  let content: React.ReactNode;
  if (!visible || chart.isPending) {
    content = <div className={`${placeholderHeight} animate-pulse rounded-lg bg-zinc-100`} />;
  } else if (chart.isError || points.length < 2) {
    content = (
      <div
        className={`flex ${placeholderHeight} items-center justify-center rounded-lg border border-zinc-100 bg-zinc-50 px-1 text-center text-[9px] leading-tight text-zinc-400`}
      >
        Нет данных
      </div>
    );
  } else {
    content = (
      <>
        <MiniLineChart
          points={points}
          height={compact ? 44 : 80}
          color={positive ? '#059669' : '#dc2626'}
        />
        {compact ? null : (
          <div className="mt-0.5 flex items-center justify-between text-[9px] text-zinc-400">
            <span>3 мес</span>
            <span>{weekly.length >= 12 ? '12 недель' : `${weekly.length} нед.`}</span>
          </div>
        )}
      </>
    );
  }

  return (
    <div ref={containerRef} className={className}>
      {content}
    </div>
  );
}
