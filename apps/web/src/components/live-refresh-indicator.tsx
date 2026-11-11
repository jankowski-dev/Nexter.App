import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { useRouterState } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

interface LiveRoute {
  path: string;
  seconds: number;
  keyPrefixes: string[];
}

const LIVE_ROUTES: LiveRoute[] = [
  { path: '/dashboard', seconds: 10, keyPrefixes: ['dashboard', 'habits'] },
  { path: '/portfolio', seconds: 15, keyPrefixes: ['positions', 'trade-groups', 'buy-list'] },
  { path: '/statistics', seconds: 30, keyPrefixes: ['reports'] },
  { path: '/watchlist', seconds: 30, keyPrefixes: ['watchlist'] },
  { path: '/operations', seconds: 30, keyPrefixes: ['operations'] },
];

function routeFor(pathname: string): LiveRoute | null {
  return LIVE_ROUTES.find((route) => route.path === pathname) ?? null;
}

function queryMatches(route: LiveRoute, queryKey: readonly unknown[]): boolean {
  const first = queryKey[0];
  if (typeof first !== 'string') return false;
  return route.keyPrefixes.some((prefix) => first === prefix || first.startsWith(`${prefix}-`));
}

export function LiveRefreshIndicator() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const route = routeFor(pathname);
  const queryClient = useQueryClient();
  const fetching = useIsFetching({
    predicate: (query) => (route ? queryMatches(route, query.queryKey) : false),
  });
  const [secondsLeft, setSecondsLeft] = useState(route?.seconds ?? 0);
  const [updatedAt, setUpdatedAt] = useState(0);

  useEffect(() => {
    setSecondsLeft(route?.seconds ?? 0);
    setUpdatedAt(0);
  }, [route]);

  useEffect(() => {
    if (!route) return;
    const timer = window.setInterval(() => {
      setSecondsLeft((value) => (value > 1 ? value - 1 : route.seconds));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [route]);

  useEffect(() => {
    if (!route) return;
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== 'updated' || event.action.type !== 'success') return;
      if (!queryMatches(route, event.query.queryKey)) return;
      setSecondsLeft(route.seconds);
      setUpdatedAt(Date.now());
    });
    return unsubscribe;
  }, [queryClient, route]);

  useEffect(() => {
    if (!updatedAt) return;
    const timer = window.setTimeout(() => setUpdatedAt(0), 1400);
    return () => window.clearTimeout(timer);
  }, [updatedAt]);

  if (!route) return null;

  const isUpdating = fetching > 0;
  const justUpdated = updatedAt > 0;
  const label = isUpdating
    ? 'Обновляю…'
    : justUpdated
      ? 'Обновлено'
      : `Обновление через ${secondsLeft} с`;
  const status = isUpdating ? 'Обновление данных' : justUpdated ? 'Данные обновлены' : '';

  return (
    <div
      className="hidden items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-[11px] font-medium text-zinc-500 sm:flex"
      title={`Данные обновляются автоматически каждые ${route.seconds} секунд`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          isUpdating
            ? 'animate-pulse bg-amber-500'
            : justUpdated
              ? 'bg-emerald-500'
              : 'bg-emerald-400'
        }`}
      />
      {label}
      <span className="sr-only" role="status">
        {status}
      </span>
    </div>
  );
}
