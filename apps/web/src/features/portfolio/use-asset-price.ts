import { fetchPortfolioAsset } from '@/lib/api';
import { useQuery } from '@tanstack/react-query';

export function useAssetUsdPrice(assetId: string | null | undefined): string | null {
  const query = useQuery({
    queryKey: ['asset-usd-price', assetId],
    queryFn: () => fetchPortfolioAsset(assetId as string),
    enabled: Boolean(assetId),
    refetchInterval: 15_000,
  });

  return (
    query.data?.position?.priceUsd ??
    query.data?.quote?.priceUsd ??
    query.data?.prices[0]?.priceUsd ??
    null
  );
}
