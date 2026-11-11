import { cn } from '@/lib/utils';
import { useState } from 'react';

export function tokenIconSrc(logoUrl: string | null): string | null {
  if (!logoUrl) return null;
  if (logoUrl.startsWith('data:image/')) return logoUrl;
  return `/api/v1/watchlist/icon?url=${encodeURIComponent(logoUrl)}`;
}

export function TokenIcon({
  logoUrl,
  symbol,
  className,
}: {
  logoUrl: string | null;
  symbol: string;
  className?: string;
}) {
  const src = tokenIconSrc(logoUrl);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = Boolean(src && failedSrc === src);

  if (!src || failed) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          'flex shrink-0 items-center justify-center rounded-full bg-zinc-200 font-semibold uppercase text-zinc-600',
          className ?? 'h-7 w-7 text-[10px]',
        )}
      >
        {symbol.slice(0, 2)}
      </span>
    );
  }

  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      className={cn('shrink-0 rounded-full object-cover', className ?? 'h-7 w-7')}
      onError={() => setFailedSrc(src)}
    />
  );
}
