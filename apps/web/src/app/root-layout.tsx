import { Button } from '@/components/ui/button';
import { apiFetch, apiPost } from '@/lib/api';
import { messages } from '@/lib/i18n';
import { useWallet, WalletProvider, type WalletChain } from '@/lib/wallet-context';
import { authMeResponseSchema } from '@nexter/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { useEffect, useState, type ReactNode } from 'react';

const cryptoNavigation = [
  { to: '/dashboard', label: messages.nav.dashboard },
  { to: '/portfolio', label: messages.nav.portfolio },
  { to: '/operations', label: messages.nav.operations },
  { to: '/watchlist', label: messages.nav.watchlist },
  { to: '/reports', label: messages.nav.reports },
] as const;

const primaryNavigation = [
  { to: '/finance', label: messages.nav.finance },
  { to: '/vault', label: messages.nav.vault },
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

function BnbIcon() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className="h-4 w-4">
      <path d="m16 4 4.4 4.4L16 12.8l-4.4-4.4Z" fill="#F3BA2F" />
      <path d="m7.2 12.8 4.4 4.4-4.4 4.4L2.8 17.2Z" fill="#F3BA2F" />
      <path d="m24.8 12.8 4.4 4.4-4.4 4.4-4.4-4.4Z" fill="#F3BA2F" />
      <path d="m16 15.6 4.4 4.4-4.4 4.4-4.4-4.4Z" fill="#F3BA2F" />
      <path d="m16 27.2 4.4-4.4L16 25l-4.4-2.2Z" fill="#F3BA2F" opacity=".65" />
    </svg>
  );
}

function EthIcon() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className="h-4 w-4">
      <path d="M16 3.5 24 16l-8 4.7L8 16Z" fill="#627EEA" />
      <path d="M16 21.9 24 17.2 16 29l-8-11.8Z" fill="#8A9DF1" />
    </svg>
  );
}

function ChainButton({
  chain,
  active,
  onClick,
  label,
  children,
}: {
  chain: WalletChain;
  active: boolean;
  onClick: (chain: WalletChain) => void;
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={chain === 'bsc' ? 'BNB Smart Chain' : 'Ethereum'}
      onClick={() => onClick(chain)}
      className={`flex h-8 w-8 items-center justify-center rounded-lg border transition ${
        active
          ? 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-500/15'
          : 'border-zinc-200 bg-white hover:bg-zinc-50'
      }`}
    >
      {children}
    </button>
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
          disabled={wallet.connecting || !wallet.projectId}
          title={!wallet.projectId ? 'WalletConnect не настроен на сервере' : undefined}
        >
          <WalletIcon />
          {wallet.connecting ? 'Подключаю…' : 'Подключить'}
        </Button>
      )}

      <div role="group" aria-label="Блокчейн" className="flex items-center gap-1">
        <ChainButton
          chain="bsc"
          active={wallet.chain === 'bsc'}
          onClick={wallet.selectChain}
          label="BNB"
        >
          <BnbIcon />
        </ChainButton>
        <ChainButton
          chain="ethereum"
          active={wallet.chain === 'ethereum'}
          onClick={wallet.selectChain}
          label="Ethereum"
        >
          <EthIcon />
        </ChainButton>
      </div>
    </>
  );
}

function RootLayoutContent() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const cryptoActive = cryptoNavigation.some(
    (item) => pathname === item.to || pathname.startsWith(`${item.to}/`),
  );
  const [cryptoOpen, setCryptoOpen] = useState(cryptoActive);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (document.documentElement.dataset.theme === 'dark') return 'dark';
    try {
      return localStorage.getItem('nexter-theme') === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });
  const wallet = useWallet();
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
              <span>Крипта</span>
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

          <div className="mt-auto">
            <Button className="w-full" variant="ghost" onClick={() => void logout()}>
              Выйти
            </Button>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="relative flex h-14 items-center justify-between border-b border-zinc-200 bg-white px-4 md:px-6">
            <div className="hidden text-sm text-zinc-500 sm:block">{messages.app.header}</div>
            <div className="flex items-center gap-2 sm:gap-3">
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

              <div
                className="hidden max-w-64 truncate text-xs text-zinc-500 lg:block"
                title={me.data?.user.email}
              >
                {me.data?.user.email}
              </div>

              <WalletControls />

              <Button className="px-2 md:hidden" variant="ghost" onClick={() => void logout()}>
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
                Крипта {cryptoOpen ? '▾' : '▸'}
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
    </div>
  );
}

export function RootLayout() {
  return (
    <WalletProvider>
      <RootLayoutContent />
    </WalletProvider>
  );
}
