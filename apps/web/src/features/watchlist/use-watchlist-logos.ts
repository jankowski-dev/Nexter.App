import { fetchWatchlist } from '@/lib/api';
import { useQuery } from '@tanstack/react-query';

const EMPTY_LOGOS = new Map<string, string | null>();

async function loadWatchlistLogos(): Promise<Map<string, string | null>> {
  const logos = new Map<string, string | null>();
  let cursor: string | undefined;

  for (let page = 0; page < 20; page += 1) {
    const response = await fetchWatchlist(true, cursor, undefined, 100);
    for (const entry of response.data) {
      logos.set(entry.asset.id, entry.logoUrl);
    }
    if (!response.page.hasMore) break;
    cursor = response.page.nextCursor ?? undefined;
    if (!cursor) break;
  }

  return logos;
}

export function useWatchlistLogos(): Map<string, string | null> {
  const query = useQuery({
    queryKey: ['watchlist', 'icons'],
    queryFn: loadWatchlistLogos,
    staleTime: 60_000,
  });

  return query.data ?? EMPTY_LOGOS;
}
