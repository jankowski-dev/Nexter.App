/**
 * API responses default to `no-store`, except the token icon proxy which sets
 * its own long-lived public cache header. Keep the pathname match exact so a
 * future route such as `/watchlist/icon-history` is not accidentally cached.
 */
export function apiCacheControl(url: string): string | null {
  const path = url.split('?')[0] ?? '';
  if (!path.startsWith('/api/v1/')) return null;
  if (path === '/api/v1/watchlist/icon') return null;
  return 'no-store';
}
