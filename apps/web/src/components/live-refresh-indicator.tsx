import { useIsFetching } from '@tanstack/react-query';
import { useRouterState } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

const LIVE_ROUTES: Array<{ path: string; keyPrefixes: string[] }> = [
  { path: '/dashboard', keyPrefixes: ['dashboard', 'habits'] },
  { path: '/portfolio', keyPrefixes: ['positions', 'trade-groups', 'buy-list'] },
  { path: '/statistics', keyPrefixes: ['reports'] },
  { path: '/watchlist', keyPrefixes: ['watchlist'] },
  { path: '/operations', keyPrefixes: ['operations'] },
];

function routeFor(pathname: string) {
  return LIVE_ROUTES.find((route) => route.path === pathname) ?? null;
}

function queryMatches(route: { keyPrefixes: string[] }, queryKey: readonly unknown[]): boolean {
  const first = queryKey[0];
  if (typeof first !== 'string') return false;
  return route.keyPrefixes.some((prefix) => first === prefix || first.startsWith(`${prefix}-`));
}

function FanIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={`h-4 w-4 ${spinning ? 'animate-spin [animation-duration:1.1s]' : 'opacity-45'}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none" />
      <path d="M12 10.2c-2.9-.2-5.4-1.5-5.2-3.3.2-1.8 3-2.1 4.6-.4.8.9 1.4 2.1 1.6 3.7Z" />
      <path d="M13.8 12c.2-2.9 1.5-5.4 3.3-5.2 1.8.2 2.1 3 .4 4.6-.9.8-2.1 1.4-3.7 1.6Z" />
      <path d="M12 13.8c2.9.2 5.4 1.5 5.2 3.3-.2 1.8-3 2.1-4.6.4-.8-.9-1.4-2.1-1.6-3.7Z" />
      <path d="M10.2 12c-.2 2.9-1.5 5.4-3.3 5.2-1.8-.2-2.1-3-.4-4.6.9-.8 2.1-1.4 3.7-1.6Z" />
    </svg>
  );
}

export function LiveRefreshIndicator() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const route = routeFor(pathname);
  const fetching = useIsFetching({
    predicate: (query) => (route ? queryMatches(route, query.queryKey) : false),
  });
  const [spinning, setSpinning] = useState(false);
  const startedAt = useRef(0);

  useEffect(() => {
    if (!route) {
      setSpinning(false);
      return;
    }

    if (fetching > 0) {
      startedAt.current = Date.now();
      setSpinning(true);
      return;
    }

    if (!spinning) return;

    const remaining = Math.max(0, 700 - (Date.now() - startedAt.current));
    const timer = window.setTimeout(() => setSpinning(false), remaining);
    return () => window.clearTimeout(timer);
  }, [fetching, route, spinning]);

  if (!route) return null;

  return (
    <div
      className="flex h-8 w-8 items-center justify-center rounded-full border border-zinc-200 bg-zinc-50 text-zinc-500"
      title="Обновление данных"
      aria-label={spinning ? 'Данные обновляются' : 'Данные не обновляются'}
      aria-busy={spinning}
    >
      <FanIcon spinning={spinning} />
      <span className="sr-only" role="status">
        {spinning ? 'Данные обновляются' : ''}
      </span>
    </div>
  );
}
