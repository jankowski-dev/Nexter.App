import { formatDateTime, formatRelativeTime } from '@/lib/format';
import { useEffect, useState } from 'react';

const sourceLabels: Record<string, string> = {
  dexscreener: 'DexScreener',
  coingecko: 'CoinGecko',
  stablecoin: 'стейблкоин $1',
  manual: 'ручная цена',
};

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-3 w-3" fill="none">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M12 7.5V12l3 1.8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PriceFreshness({
  updatedAt,
  fetchedAt,
  source,
  className,
}: {
  updatedAt: string | null | undefined;
  fetchedAt: string | null | undefined;
  source?: string | null;
  className?: string;
}) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const value = fetchedAt ?? updatedAt;
  const title = [
    updatedAt ? `Цена изменилась: ${formatDateTime(updatedAt)}` : null,
    fetchedAt ? `Проверена: ${formatDateTime(fetchedAt)}` : null,
    source ? `Источник: ${sourceLabels[source] ?? source}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap text-[11px] text-zinc-400 ${className ?? ''}`}
      title={title || undefined}
    >
      <ClockIcon />
      {formatRelativeTime(value)}
    </span>
  );
}
