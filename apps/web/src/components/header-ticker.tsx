import { useQuery } from '@tanstack/react-query';
import { fetchMarketTicker } from '@/lib/api';
import { formatPct, formatPrice, pnlTone } from '@/lib/format';
import type { MarketTickerItem } from '@nexter/contracts';

export function tickerLabel(item: MarketTickerItem): string {
  return `${item.symbol} ${formatPrice(item.priceUsd)} [${formatPct(item.change24hPct)}]`;
}

export function HeaderTicker() {
  const query = useQuery({
    queryKey: ['market-ticker'],
    queryFn: fetchMarketTicker,
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: 1,
  });

  const items = query.data?.items ?? [];
  if (items.length === 0) return null;

  return (
    <div
      aria-label="Курсы криптовалют"
      className="hidden min-w-0 flex-1 items-center overflow-hidden lg:flex"
    >
      <div className="ticker-track flex w-max items-center gap-6">
        {[0, 1].map((copy) => (
          <div
            key={copy}
            aria-hidden={copy === 1}
            className="flex shrink-0 items-center gap-6 text-xs"
          >
            {items.map((item) => (
              <span key={`${copy}-${item.id}`} className="flex items-center gap-1.5">
                <span className="font-semibold text-zinc-800">{item.symbol}</span>
                <span className="font-mono tabular-nums text-zinc-600">
                  {formatPrice(item.priceUsd)}
                </span>
                <span className={`font-mono tabular-nums ${pnlTone(item.change24hPct)}`}>
                  [{formatPct(item.change24hPct)}]
                </span>
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
