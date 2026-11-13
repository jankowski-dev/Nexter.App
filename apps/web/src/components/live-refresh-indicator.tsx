import { useIsFetching } from '@tanstack/react-query';
import { useRouterState } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

const LIVE_ROUTES: Array<{ path: string; keyPrefixes: string[] }> = [
  { path: '/dashboard', keyPrefixes: ['dashboard', 'habits'] },
  { path: '/portfolio', keyPrefixes: ['positions', 'trade-groups', 'buy-list'] },
  { path: '/statistics', keyPrefixes: ['reports'] },
  { path: '/watchlist', keyPrefixes: ['watchlist'] },
  { path: '/operations', keyPrefixes: ['operations'] },
  { path: '/testing', keyPrefixes: ['trading-bot'] },
];

function routeFor(pathname: string) {
  return LIVE_ROUTES.find((route) => route.path === pathname) ?? null;
}

function queryMatches(route: { keyPrefixes: string[] }, queryKey: readonly unknown[]): boolean {
  const first = queryKey[0];
  if (typeof first !== 'string') return false;
  return route.keyPrefixes.some((prefix) => first === prefix || first.startsWith(`${prefix}-`));
}

export function FanIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={`h-5 w-5 ${spinning ? 'animate-spin [animation-duration:1.1s]' : 'opacity-45'}`}
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
  const [mounted, setMounted] = useState(false);
  const [active, setActive] = useState(false);
  const startedAt = useRef(0);
  const activeRef = useRef(false);
  const hideTimer = useRef<number | null>(null);
  const unmountTimer = useRef<number | null>(null);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    const clearTimers = () => {
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
      if (unmountTimer.current !== null) window.clearTimeout(unmountTimer.current);
      hideTimer.current = null;
      unmountTimer.current = null;
    };

    if (!route) {
      clearTimers();
      setMounted(false);
      setActive(false);
      return;
    }

    if (fetching > 0) {
      clearTimers();
      if (!activeRef.current) startedAt.current = Date.now();
      setMounted(true);
      window.requestAnimationFrame(() => setActive(true));
      return;
    }

    if (!mounted) return;

    const remaining = Math.max(0, 3000 - (Date.now() - startedAt.current));
    hideTimer.current = window.setTimeout(() => {
      setActive(false);
      unmountTimer.current = window.setTimeout(() => setMounted(false), 550);
    }, remaining);

    return () => {
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    };
  }, [fetching, route, mounted]);

  if (!route || !mounted) return null;

  return (
    <div
      className={`flex h-9 items-center gap-2 whitespace-nowrap text-xs text-zinc-500 transition-opacity duration-500 ${
        active ? 'opacity-100' : 'opacity-0'
      }`}
      role="status"
      aria-live="polite"
      aria-label="Синхронизация данных"
      aria-hidden={!active}
    >
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
      <span>Синхронизация данных</span>
    </div>
  );
}
