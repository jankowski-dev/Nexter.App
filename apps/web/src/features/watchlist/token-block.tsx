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
    <div className="w-full text-right">
      <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">{label}</div>
      <div
        className={`mt-0.5 font-mono text-[14px] font-semibold tabular-nums ${tone ?? 'text-zinc-700'}`}
      >
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
      className="cursor-pointer rounded-xl border border-zinc-200 px-2.5 py-2 text-left transition-colors hover:border-emerald-300 hover:bg-emerald-50/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 xl:flex-nowrap">
        <div className="flex min-w-[230px] max-w-[360px] flex-1 items-center gap-2.5">
          <TokenIcon
            logoUrl={entry.logoUrl ?? entry.asset.logoUrl}
            symbol={entry.asset.symbol}
            className="h-8 w-8 shrink-0 text-[9px]"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-[13px] font-semibold text-zinc-900">
                {entry.asset.symbol}
              </span>
              {meta}
            </div>
            <div className="mt-0.5 flex items-baseline gap-2">
              <LiveValue value={formatPrice(entry.priceUsd)}>
                <span className="font-mono text-[16px] font-semibold tracking-tight text-zinc-900">
                  {formatPrice(entry.priceUsd)}
                </span>
              </LiveValue>
              <span className={`text-[12px] font-medium ${pnlTone(entry.change24hPct)}`}>
                {change24h}
              </span>
              <span className="truncate text-[10px] text-zinc-500">
                {entry.asset.name} · {entry.asset.chainCode}
              </span>
            </div>
          </div>
        </div>

        <div className="w-[140px] shrink-0">
          <WeeklyPriceChart entryId={entry.id} compact />
        </div>

        {onBuy ? (
          <Button
            className="h-8 shrink-0 px-3 text-xs"
            onClick={(event) => {
              event.stopPropagation();
              onBuy(tradeAsset, entry.priceUsd);
            }}
          >
            Купить
          </Button>
        ) : null}

        <div className="ml-auto grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-[72px_72px_78px_100px] sm:justify-end">
          <TokenMetric label="7д" value={change7d} tone={pnlTone(entry.change7dPct)} />
          <TokenMetric label="30д" value={change30d} tone={pnlTone(entry.change30dPct)} />
          <TokenMetric label="1г" value={change1y} tone={pnlTone(entry.change1yPct)} />
          <TokenMetric
            label="Кап."
            value={entry.marketCapUsd ? formatUsdCompact(entry.marketCapUsd) : '—'}
          />
        </div>

        <PriceFreshness
          updatedAt={entry.priceUpdatedAt}
          fetchedAt={entry.priceFetchedAt}
          source={entry.priceSource}
          className="shrink-0"
        />
      </div>
    </div>
  );
}
