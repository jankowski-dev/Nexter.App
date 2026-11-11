import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { TokenIcon } from '@/components/token-icon';
import { fetchSwapConfig, fetchWatchlist, fetchWatchlistGroups } from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import { formatPct, formatPrice, formatTokenAmount, formatUsd, pnlTone } from '@/lib/format';
import { useQuery } from '@tanstack/react-query';
import type { Asset, Position, SwapConfigResponse } from '@nexter/contracts';

function isOnchainAllowed(asset: Asset, config: SwapConfigResponse | undefined): boolean {
  const chain = config?.chains.find((item) => item.code === asset.chainCode);
  if (!chain) return false;
  if (asset.contractAddress) {
    return chain.tokens.some(
      (token) =>
        !token.native && token.address.toLowerCase() === asset.contractAddress?.toLowerCase(),
    );
  }
  return chain.tokens.some((token) => token.native && token.symbol === asset.symbol);
}

export function TokenBuyList({
  positions,
  onBuy,
  onManual,
}: {
  positions: Position[];
  onBuy: (asset: Asset, marketPriceUsd: string | null) => void;
  onManual?: (asset: Asset, marketPriceUsd: string | null) => void;
}) {
  const groups = useQuery({ queryKey: ['watchlist-groups'], queryFn: fetchWatchlistGroups });
  const config = useQuery({ queryKey: ['swap-config'], queryFn: fetchSwapConfig });
  const defaultGroup = groups.data?.groups.find((group) => group.isDefault);
  const watchlist = useQuery({
    queryKey: ['buy-list', defaultGroup?.id],
    queryFn: () => fetchWatchlist(false, undefined, defaultGroup?.id, 100),
    enabled: Boolean(defaultGroup?.id),
    refetchInterval: 10_000,
  });

  if (groups.isPending || watchlist.isPending) {
    return <LoadingRows rows={8} />;
  }

  if (groups.isError || watchlist.isError) {
    return (
      <ErrorState
        message={toRussianError(
          groups.error ?? watchlist.error,
          'Не удалось загрузить основной список',
        )}
        onRetry={() => {
          void groups.refetch();
          void watchlist.refetch();
        }}
      />
    );
  }

  const entries = watchlist.data?.data ?? [];
  const positionByAsset = new Map(positions.map((position) => [position.asset.id, position]));

  return (
    <Card>
      <CardTitle>Основной список</CardTitle>
      <CardDescription>
        Токены из группы «Основная». Цены обновляются автоматически; кнопка «Купить» открывает
        on-chain покупку, для токенов вне allowlist доступна только ручная запись.
      </CardDescription>
      {config.isError ? (
        <p className="mt-2 text-xs text-amber-700">
          Не удалось проверить on-chain allowlist. Доступна только ручная запись.
        </p>
      ) : null}

      {entries.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-600">
          В группе «Основная» пока нет токенов. Добавьте их в базе токенов.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
                <th className="py-2 pr-3 font-medium">Токен</th>
                <th className="py-2 pr-3 text-right font-medium">Цена CoinGecko</th>
                <th className="py-2 pr-3 text-right font-medium">24ч</th>
                <th className="py-2 pr-3 text-right font-medium">В портфеле</th>
                <th className="py-2 pr-3 text-right font-medium">Стоимость</th>
                <th className="py-2 text-right font-medium">Действие</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const position = positionByAsset.get(entry.asset.id);
                return (
                  <tr
                    key={entry.id}
                    className="border-b border-zinc-100 last:border-0 odd:bg-zinc-50/60 hover:bg-zinc-100/70"
                  >
                    <td className="py-2 pr-3">
                      <div className="flex items-center gap-2">
                        <TokenIcon
                          logoUrl={entry.logoUrl ?? entry.asset.logoUrl}
                          symbol={entry.asset.symbol}
                        />
                        <div className="min-w-0">
                          <div className="font-medium text-zinc-800">{entry.asset.symbol}</div>
                          <div className="truncate text-xs text-zinc-500">
                            {entry.asset.name} · {entry.asset.chainCode}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums text-zinc-800">
                      {formatPrice(entry.priceUsd)}
                    </td>
                    <td
                      className={`py-2 pr-3 text-right font-mono tabular-nums ${pnlTone(
                        entry.change24hPct,
                      )}`}
                    >
                      {entry.change24hPct ? formatPct(entry.change24hPct) : '—'}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums text-zinc-600">
                      {position ? formatTokenAmount(position.amount, 8) : '—'}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums text-zinc-700">
                      {position ? formatUsd(position.valueUsd) : '—'}
                    </td>
                    <td className="py-2 text-right">
                      {config.isPending ? (
                        <Button className="h-8 px-3 text-xs" disabled>
                          Проверяю…
                        </Button>
                      ) : isOnchainAllowed(entry.asset, config.data) ? (
                        <Button
                          className="h-8 px-3 text-xs"
                          onClick={() => onBuy(entry.asset, entry.priceUsd)}
                        >
                          Купить
                        </Button>
                      ) : (
                        <Button
                          variant="secondary"
                          className="h-8 px-3 text-xs"
                          onClick={() => onManual?.(entry.asset, entry.priceUsd)}
                          disabled={!onManual}
                          title="Токен не входит в on-chain allowlist — доступна только ручная запись"
                        >
                          Только вручную
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
