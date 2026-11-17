import { ChainToggle } from '@/components/chain-toggle';
import { NavIcon } from '@/components/nav-icon';
import { NexterLogo } from '@/components/nexter-logo';
import { LiveRefreshIndicator } from '@/components/live-refresh-indicator';
import { Button } from '@/components/ui/button';
import { apiFetch, apiPost, fetchNotificationUnreadCount } from '@/lib/api';
import { UNAUTHORIZED_EVENT } from '@/lib/auth-events';
import { messages } from '@/lib/i18n';
import { useWallet, WalletProvider } from '@/lib/wallet-context';
import { LockProvider, useAppLock } from '@/lib/app-lock';
import { ConfirmProvider } from '@/lib/confirm';
import { readTheme, subscribeUiPreference, writeTheme } from '@/lib/ui-preferences';
import { authMeResponseSchema } from '@nexter/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

const cryptoPaths = ['/portfolio', '/operations', '/watchlist', '/statistics', '/trades'] as const;

const topNavigation = [
  { to: '/dashboard', label: messages.nav.dashboard, icon: 'dashboard' },
  { to: '/notifications', label: messages.nav.notifications, icon: 'notifications' },
  { to: '/tasks', label: messages.nav.tasks, icon: 'tasks' },
  { to: '/notes', label: messages.nav.notes, icon: 'notes' },
] as const;

const afterCryptoNavigation = [
  { to: '/finance', label: messages.nav.finance, icon: 'finance' },
  { to: '/vault', label: messages.nav.vault, icon: 'vault' },
  { to: '/settings', label: messages.nav.settings, icon: 'settings' },
] as const;

const activeLinkProps = {
  className: 'bg-emerald-500/15 font-medium text-emerald-200',
  'aria-current': 'page' as const,
};

const inactiveLinkProps = {
  className: 'text-zinc-300 hover:bg-white/5 hover:text-white',
};

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="none">
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="none">
      <rect
        x="4.5"
        y="10"
        width="15"
        height="10.5"
        rx="2.5"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M8 10V7.5a4 4 0 0 1 8 0V10"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="12" cy="15.2" r="1.3" fill="currentColor" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="none">
      <path
        d="M20 14.2A8.2 8.2 0 0 1 9.8 4a8.5 8.5 0 1 0 10.2 10.2Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function WalletIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="none">
      <path
        d="M4.5 7.8A2.3 2.3 0 0 1 6.8 5.5h9.9a2 2 0 0 1 2 2v1.1H6.8a2.3 2.3 0 0 0-2.3 2.3v7.8A2.3 2.3 0 0 1 2.2 16.4V7.8Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path
        d="M5.5 8.6h14.3a2 2 0 0 1 2 2v7.1a2.3 2.3 0 0 1-2.3 2.3H6.8a2.3 2.3 0 0 1-2.3-2.3V8.6Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <circle cx="17.3" cy="14.2" r="1.2" fill="currentColor" />
    </svg>
  );
}

function WalletControls() {
  const wallet = useWallet();

  return (
    <>
      {wallet.connected ? (
        <Button
          variant="secondary"
          className="h-8 gap-1.5 px-2.5 text-xs"
          title={wallet.address ?? undefined}
          onClick={() => void wallet.disconnect()}
        >
          <WalletIcon />
          Отключить
        </Button>
      ) : (
        <Button
          className="h-8 gap-1.5 px-2.5 text-xs"
          onClick={() => void wallet.connect()}
          disabled={wallet.connecting || wallet.restoring || !wallet.projectId}
          title={!wallet.projectId ? 'WalletConnect не настроен на сервере' : undefined}
        >
          <WalletIcon />
          {wallet.restoring ? 'Восстанавливаю…' : wallet.connecting ? 'Подключаю…' : 'Подключить'}
        </Button>
      )}

      <ChainToggle value={wallet.chain} onChange={wallet.selectChain} />
    </>
  );
}

function HeaderClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const date = new Intl.DateTimeFormat('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(now);
  const time = new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(now);

  return (
    <div className="hidden items-center gap-2.5 sm:flex">
      <span className="text-sm text-zinc-600">{date.charAt(0).toUpperCase() + date.slice(1)}</span>
      <span className="h-3.5 w-px bg-zinc-200" />
      <span className="font-mono text-xs tabular-nums text-zinc-500">{time}</span>
    </div>
  );
}

function RouteLoadingOverlay() {
  const active = useRouterState({
    select: (state) => state.status === 'pending' || state.isLoading,
  });
  const [visible, setVisible] = useState(false);
  const shownAt = useRef(0);

  useEffect(() => {
    if (active) {
      shownAt.current = Date.now();
      setVisible(true);
      return;
    }

    if (!visible) return;
    const remaining = Math.max(0, 1000 - (Date.now() - shownAt.current));
    const timer = window.setTimeout(() => setVisible(false), remaining);
    return () => window.clearTimeout(timer);
  }, [active, visible]);

  if (!visible) return null;

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center bg-white/55 backdrop-blur-[1px]"
      role="status"
      aria-label="Загрузка страницы"
    >
      <span className="h-10 w-10 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent" />
    </div>
  );
}

function RootLayoutContent() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const appLock = useAppLock();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const cryptoActive = cryptoPaths.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
  const [theme, setTheme] = useState<'light' | 'dark'>(() => readTheme());
  useEffect(() => {
    return subscribeUiPreference('nexter-theme', () => setTheme(readTheme()));
  }, []);
  const wallet = useWallet();
  const unreadNotifications = useQuery({
    queryKey: ['notifications-unread-count'],
    queryFn: fetchNotificationUnreadCount,
    refetchInterval: 30_000,
  });
  const unreadCount = unreadNotifications.data?.count ?? 0;
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => apiFetch('/api/v1/auth/me', {}, authMeResponseSchema),
    retry: false,
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#202329' : '#f6f7f9');
  }, [theme]);

  useEffect(() => {
    const onUnauthorized = (): void => {
      appLock.clearLocked();
      queryClient.clear();

      if (window.location.pathname !== '/login') {
        void navigate({ to: '/login', replace: true });
      }
    };

    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);

    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [appLock, navigate, queryClient]);

  async function logout() {
    try {
      await apiPost('/api/v1/auth/logout', {});
    } finally {
      appLock.clearLocked();
      queryClient.clear();
      await navigate({ to: '/login' });
    }
  }

  return (
    <div className="min-h-dvh bg-zinc-50 text-zinc-900">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-emerald-600 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
      >
        Перейти к содержимому
      </a>

      <div className="flex min-h-dvh w-full">
        <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 overflow-hidden border-r border-zinc-800 bg-[#202329] p-4 md:flex md:flex-col">
          <Link to="/dashboard" className="mb-6 flex shrink-0 items-center gap-3 px-2">
            <NexterLogo lit={8} className="h-9 w-8 shrink-0" />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold leading-tight text-white">
                Nexter System
              </div>
              <div className="whitespace-nowrap text-[7px] uppercase tracking-[0.08em] text-zinc-400">
                Analytics and Automation
              </div>
            </div>
          </Link>

          <nav
            aria-label="Основная навигация"
            className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-1"
          >
            {topNavigation.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                activeProps={activeLinkProps}
                inactiveProps={inactiveLinkProps}
                className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-colors"
              >
                <NavIcon name={item.icon} className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
                {item.to === '/notifications' && unreadCount > 0 ? (
                  <span className="ml-auto min-w-5 rounded-full bg-emerald-500 px-1.5 text-center text-[10px] font-semibold leading-5 text-zinc-950">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                ) : null}
              </Link>
            ))}
            <Link
              to="/portfolio"
              aria-current={cryptoActive ? 'page' : undefined}
              className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-colors ${
                cryptoActive
                  ? 'bg-emerald-500/15 font-medium text-emerald-200'
                  : 'text-zinc-300 hover:bg-white/5 hover:text-white'
              }`}
            >
              <NavIcon name="crypto" className="h-4 w-4 shrink-0" />
              <span>{messages.nav.crypto}</span>
            </Link>
            {afterCryptoNavigation.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                activeProps={activeLinkProps}
                inactiveProps={inactiveLinkProps}
                className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-colors"
              >
                <NavIcon name={item.icon} className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
              </Link>
            ))}
          </nav>

          <div className="mt-4 shrink-0 space-y-2">
            <Button
              className="w-full justify-center gap-2 text-zinc-300 hover:bg-white/5 hover:text-white"
              variant="ghost"
              onClick={appLock.lock}
            >
              <LockIcon />
              Заблокировать
            </Button>
            <Button
              className="w-full justify-center border-red-400/40 bg-red-500/10 text-red-200 hover:border-red-300/60 hover:bg-red-500/20"
              variant="danger"
              onClick={() => void logout()}
            >
              Выйти
            </Button>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-zinc-200 bg-white px-4 md:px-6">
            <HeaderClock />
            <div className="flex items-center gap-2 sm:gap-3">
              <LiveRefreshIndicator />
              <div
                className="flex items-center gap-0.5 rounded-full border border-zinc-200 bg-zinc-50 p-1"
                role="group"
                aria-label="Тема оформления"
              >
                <button
                  type="button"
                  aria-label="Светлая тема"
                  aria-pressed={theme === 'light'}
                  onClick={() => {
                    writeTheme('light');
                    setTheme('light');
                  }}
                  className={`flex h-6 w-6 items-center justify-center rounded-full transition ${
                    theme === 'light'
                      ? 'bg-white text-zinc-900 shadow-sm'
                      : 'text-zinc-500 hover:text-zinc-800'
                  }`}
                >
                  <SunIcon />
                </button>
                <button
                  type="button"
                  aria-label="Тёмная тема"
                  aria-pressed={theme === 'dark'}
                  onClick={() => {
                    writeTheme('dark');
                    setTheme('dark');
                  }}
                  className={`flex h-6 w-6 items-center justify-center rounded-full transition ${
                    theme === 'dark'
                      ? 'bg-zinc-800 text-white shadow-sm'
                      : 'text-zinc-500 hover:text-zinc-800'
                  }`}
                >
                  <MoonIcon />
                </button>
              </div>

              <div
                className="hidden max-w-64 truncate text-xs text-zinc-500 lg:block"
                title={me.data?.user.email}
              >
                {me.data?.user.email}
              </div>

              <WalletControls />

              <Button
                className="h-8 w-8 px-0 md:hidden"
                variant="ghost"
                aria-label="Заблокировать приложение"
                title="Заблокировать"
                onClick={appLock.lock}
              >
                <LockIcon />
              </Button>
              <Button className="px-2 md:hidden" variant="danger" onClick={() => void logout()}>
                Выйти
              </Button>
            </div>

            {wallet.error ? (
              <div
                role="alert"
                className="absolute right-4 top-full z-40 mt-2 flex max-w-sm items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 shadow-lg"
              >
                <span>{wallet.error}</span>
                <button
                  type="button"
                  aria-label="Закрыть сообщение"
                  className="shrink-0 rounded px-1 text-red-500 hover:bg-red-100"
                  onClick={wallet.clearError}
                >
                  ✕
                </button>
              </div>
            ) : null}
          </header>

          <nav
            aria-label="Мобильная навигация"
            className="flex flex-col gap-1 border-b border-zinc-800 bg-[#202329] px-2 py-2 md:hidden"
          >
            <div className="flex gap-1 overflow-x-auto">
              {topNavigation.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  activeProps={activeLinkProps}
                  inactiveProps={{ className: 'text-zinc-300' }}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs"
                >
                  <NavIcon name={item.icon} className="h-3.5 w-3.5 shrink-0" />
                  <span>{item.label}</span>
                  {item.to === '/notifications' && unreadCount > 0 ? (
                    <span className="ml-0.5 min-w-4 rounded-full bg-emerald-500 px-1 text-center text-[10px] font-semibold leading-4 text-zinc-950">
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  ) : null}
                </Link>
              ))}
              <Link
                to="/portfolio"
                aria-current={cryptoActive ? 'page' : undefined}
                className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs ${
                  cryptoActive ? 'bg-emerald-500/15 font-medium text-emerald-200' : 'text-zinc-300'
                }`}
              >
                <NavIcon name="crypto" className="h-3.5 w-3.5 shrink-0" />
                <span>{messages.nav.crypto}</span>
              </Link>
              {afterCryptoNavigation.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  activeProps={activeLinkProps}
                  inactiveProps={{ className: 'text-zinc-300' }}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs"
                >
                  <NavIcon name={item.icon} className="h-3.5 w-3.5 shrink-0" />
                  <span>{item.label}</span>
                </Link>
              ))}
            </div>
          </nav>

          <main id="main" className="relative min-w-0 flex-1 p-4 md:p-6">
            <div key={pathname} className="page-enter">
              <Outlet />
            </div>
            <RouteLoadingOverlay />
          </main>
        </div>
      </div>
    </div>
  );
}

export function RootLayout() {
  return (
    <WalletProvider>
      <ConfirmProvider>
        <LockProvider>
          <RootLayoutContent />
        </LockProvider>
      </ConfirmProvider>
    </WalletProvider>
  );
}
