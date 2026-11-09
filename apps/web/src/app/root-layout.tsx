import { Button } from '@/components/ui/button';
import { TradeDialog } from '@/features/trade/trade-dialog';
import { apiFetch, apiPost } from '@/lib/api';
import { messages } from '@/lib/i18n';
import { authMeResponseSchema } from '@nexter/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

const cryptoNavigation = [
  { to: '/dashboard', label: messages.nav.dashboard },
  { to: '/portfolio', label: messages.nav.portfolio },
  { to: '/operations', label: messages.nav.operations },
  { to: '/watchlist', label: messages.nav.watchlist },
  { to: '/reports', label: messages.nav.reports },
  { to: '/vault', label: messages.nav.vault },
] as const;

const primaryNavigation = [
  { to: '/tasks', label: messages.nav.tasks },
  { to: '/notes', label: messages.nav.notes },
  { to: '/settings', label: messages.nav.settings },
] as const;

const activeLinkProps = {
  className: 'bg-emerald-50 font-medium text-emerald-700',
  'aria-current': 'page' as const,
};

const inactiveLinkProps = {
  className: 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900',
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

export function RootLayout() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const cryptoActive = cryptoNavigation.some(
    (item) => pathname === item.to || pathname.startsWith(`${item.to}/`),
  );
  const [manualOpen, setManualOpen] = useState(false);
  const [cryptoOpen, setCryptoOpen] = useState(cryptoActive);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (document.documentElement.dataset.theme === 'dark') return 'dark';
    try {
      return localStorage.getItem('nexter-theme') === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => apiFetch('/api/v1/auth/me', {}, authMeResponseSchema),
    retry: false,
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('nexter-theme', theme);
    } catch {
      // Storage may be unavailable; the current session still uses the theme.
    }
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#202329' : '#f6f7f9');
  }, [theme]);

  async function logout() {
    try {
      await apiPost('/api/v1/auth/logout', {});
    } finally {
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
        <aside className="hidden w-56 shrink-0 border-r border-zinc-200 bg-white p-4 md:flex md:flex-col">
          <Link to="/dashboard" className="mb-8 block px-2">
            <div className="text-lg font-semibold tracking-tight text-zinc-900">
              {messages.app.name}
            </div>
            <div className="text-xs text-zinc-500">{messages.app.tagline}</div>
          </Link>

          <nav aria-label="Основная навигация" className="flex flex-col gap-1">
            <button
              type="button"
              onClick={() => setCryptoOpen((value) => !value)}
              aria-expanded={cryptoOpen}
              className={`flex items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors ${
                cryptoActive
                  ? 'bg-emerald-50 font-medium text-emerald-700'
                  : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900'
              }`}
            >
              <span>Crypto</span>
              <span aria-hidden="true">{cryptoOpen ? '▾' : '▸'}</span>
            </button>
            {cryptoOpen ? (
              <div className="ml-2 flex flex-col gap-1 border-l border-zinc-200 pl-2">
                {cryptoNavigation.map((item) => (
                  <Link
                    key={item.to}
                    to={item.to}
                    activeProps={activeLinkProps}
                    inactiveProps={inactiveLinkProps}
                    className="rounded-xl px-3 py-2 text-sm transition-colors"
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            ) : null}
            {primaryNavigation.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                activeProps={activeLinkProps}
                inactiveProps={inactiveLinkProps}
                className="rounded-xl px-3 py-2 text-sm transition-colors"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="mt-auto space-y-2">
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-500">
              {messages.app.phase}
            </div>
            <div className="truncate px-2 text-xs text-zinc-500">{me.data?.user.email}</div>
            <Button className="w-full" variant="ghost" onClick={() => void logout()}>
              Выйти
            </Button>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 items-center justify-between border-b border-zinc-200 bg-white px-4 md:px-6">
            <div className="text-sm text-zinc-500">{messages.app.header}</div>
            <div className="flex items-center gap-3">
              <div className="hidden items-center gap-2 text-xs text-zinc-500 sm:flex">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                {messages.app.status}
              </div>
              <div
                className="flex items-center gap-0.5 rounded-full border border-zinc-200 bg-zinc-50 p-1"
                role="group"
                aria-label="Тема оформления"
              >
                <button
                  type="button"
                  aria-label="Светлая тема"
                  aria-pressed={theme === 'light'}
                  onClick={() => setTheme('light')}
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
                  onClick={() => setTheme('dark')}
                  className={`flex h-6 w-6 items-center justify-center rounded-full transition ${
                    theme === 'dark'
                      ? 'bg-zinc-800 text-white shadow-sm'
                      : 'text-zinc-500 hover:text-zinc-800'
                  }`}
                >
                  <MoonIcon />
                </button>
              </div>
              <Button className="h-8 px-3 text-xs" onClick={() => setManualOpen(true)}>
                + Операция
              </Button>
              <Button className="md:hidden" variant="ghost" onClick={() => void logout()}>
                Выйти
              </Button>
            </div>
          </header>

          <nav
            aria-label="Мобильная навигация"
            className="flex flex-col gap-1 border-b border-zinc-200 bg-white px-2 py-2 md:hidden"
          >
            <div className="flex gap-1 overflow-x-auto">
              <button
                type="button"
                onClick={() => setCryptoOpen((value) => !value)}
                aria-expanded={cryptoOpen}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-xs ${
                  cryptoActive ? 'bg-emerald-50 font-medium text-emerald-700' : 'text-zinc-600'
                }`}
              >
                Crypto {cryptoOpen ? '▾' : '▸'}
              </button>
              {primaryNavigation.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  activeProps={activeLinkProps}
                  inactiveProps={{ className: 'text-zinc-600' }}
                  className="shrink-0 rounded-lg px-3 py-1.5 text-xs"
                >
                  {item.label}
                </Link>
              ))}
            </div>
            {cryptoOpen ? (
              <div className="flex gap-1 overflow-x-auto border-t border-zinc-100 pt-1">
                {cryptoNavigation.map((item) => (
                  <Link
                    key={item.to}
                    to={item.to}
                    activeProps={activeLinkProps}
                    inactiveProps={{ className: 'text-zinc-600' }}
                    className="shrink-0 rounded-lg px-3 py-1.5 text-xs"
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            ) : null}
          </nav>

          <main id="main" className="min-w-0 flex-1 p-4 md:p-6">
            <Outlet />
          </main>
        </div>
      </div>
      <TradeDialog
        open={manualOpen}
        onClose={() => setManualOpen(false)}
        initialMode="trade"
        titleOverride="Новая операция"
      />
    </div>
  );
}
