import { Button } from '@/components/ui/button';
import { LiveValue } from '@/components/ui/live-value';
import { PriceFreshness } from '@/components/ui/price-freshness';
import { TokenIcon } from '@/components/token-icon';
import { formatPct, formatPrice, formatUsdCompact, pnlTone } from '@/lib/format';
import type { Asset, WatchlistEntry } from '@nexter/contracts';
import type { ReactNode } from 'react';
import { WeeklyPriceChart } from './weekly-price-chart';

function TokenMetric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="text-right">
      <div className="text-[10px] text-zinc-500">{label}</div>
      <div className={`mt-0.5 font-mono text-xs tabular-nums ${tone ?? 'text-zinc-700'}`}>
        {value}
      </div>
    </div>
  );
}

export function TokenBlock({
  entry,
  onOpen,
  onBuy,
  meta,
  testId,
}: {
  entry: WatchlistEntry;
  onOpen: () => void;
  onBuy?: (asset: Asset, marketPriceUsd: string | null) => void;
  meta?: ReactNode;
  testId?: string;
}) {
  const chainAddress =
    entry.asset.chainCode === 'bsc'
      ? entry.bscContractAddress
      : entry.asset.chainCode === 'ethereum'
        ? entry.ethereumContractAddress
        : null;
  const tradeAsset: Asset = {
    ...entry.asset,
    contractAddress: entry.asset.contractAddress ?? chainAddress,
  };
  const change24h = entry.change24hPct ? formatPct(entry.change24hPct) : '—';
  const change7d = entry.change7dPct ? formatPct(entry.change7dPct) : '—';
  const change30d = entry.change30dPct ? formatPct(entry.change30dPct) : '—';
  const change1y = entry.change1yPct ? formatPct(entry.change1yPct) : '—';

  return (
    <div
      data-testid={testId ?? `token-block-${entry.asset.symbol}`}
      role="group"
      tabIndex={0}
      aria-label={`Токен ${entry.asset.symbol}: открыть карточку`}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
      className="cursor-pointer rounded-xl border border-zinc-200 p-3.5 text-left transition-colors hover:border-emerald-300 hover:bg-emerald-50/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
    >
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 xl:flex-nowrap">
        <div className="flex min-w-[170px] max-w-[235px] items-center gap-2.5">
          <TokenIcon
            logoUrl={entry.logoUrl ?? entry.asset.logoUrl}
            symbol={entry.asset.symbol}
            className="h-9 w-9 text-[10px]"
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold text-zinc-900">
                {entry.asset.symbol}
              </span>
            </div>
            <div className="truncate text-[11px] text-zinc-500">
              {entry.asset.name} · {entry.asset.chainCode}
            </div>
            {meta ? <div className="mt-1">{meta}</div> : null}
            <div className="mt-1 flex items-baseline gap-2">
              <LiveValue value={formatPrice(entry.priceUsd)}>
                <span className="font-mono text-lg font-semibold tracking-tight text-zinc-900">
                  {formatPrice(entry.priceUsd)}
                </span>
              </LiveValue>
              <span className={`text-xs font-medium ${pnlTone(entry.change24hPct)}`}>
                {change24h}
              </span>
            </div>
          </div>
        </div>

        <div className="min-w-[190px] max-w-[280px] flex-1">
          <WeeklyPriceChart entryId={entry.id} />
        </div>

        <div className="ml-auto grid grid-cols-2 gap-x-5 gap-y-2 text-right sm:grid-cols-4">
          <TokenMetric label="7д" value={change7d} tone={pnlTone(entry.change7dPct)} />
          <TokenMetric label="30д" value={change30d} tone={pnlTone(entry.change30dPct)} />
          <TokenMetric label="1г" value={change1y} tone={pnlTone(entry.change1yPct)} />
          <TokenMetric
            label="Кап."
            value={entry.marketCapUsd ? formatUsdCompact(entry.marketCapUsd) : '—'}
          />
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {onBuy ? (
            <Button
              className="h-8 px-3 text-xs"
              onClick={(event) => {
                event.stopPropagation();
                onBuy(tradeAsset, entry.priceUsd);
              }}
            >
              Купить
            </Button>
          ) : null}
          <PriceFreshness
            updatedAt={entry.priceUpdatedAt}
            fetchedAt={entry.priceFetchedAt}
            source={entry.priceSource}
          />
        </div>
      </div>
    </div>
  );
}
