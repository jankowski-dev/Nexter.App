import { Button } from '@/components/ui/button';
import { TradeDialog } from '@/features/trade/trade-dialog';
import { apiFetch, apiPost } from '@/lib/api';
import { messages } from '@/lib/i18n';
import { authMeResponseSchema } from '@nexter/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

const navigation = [
  { to: '/dashboard', label: messages.nav.dashboard },
  { to: '/portfolio', label: messages.nav.portfolio },
  { to: '/operations', label: messages.nav.operations },
  { to: '/watchlist', label: messages.nav.watchlist },
  { to: '/reports', label: messages.nav.reports },
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

export function RootLayout() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [manualOpen, setManualOpen] = useState(false);
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => apiFetch('/api/v1/auth/me', {}, authMeResponseSchema),
    retry: false,
  });

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

      <div className="mx-auto flex min-h-dvh w-full max-w-[1600px]">
        <aside className="hidden w-56 shrink-0 border-r border-zinc-200 bg-white p-4 md:flex md:flex-col">
          <Link to="/dashboard" className="mb-8 block px-2">
            <div className="text-lg font-semibold tracking-tight text-zinc-900">
              {messages.app.name}
            </div>
            <div className="text-xs text-zinc-500">{messages.app.tagline}</div>
          </Link>

          <nav aria-label="Основная навигация" className="flex flex-col gap-1">
            {navigation.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                activeProps={activeLinkProps}
                inactiveProps={inactiveLinkProps}
                className="rounded-md px-3 py-2 text-sm transition-colors"
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
            className="flex gap-1 overflow-x-auto border-b border-zinc-200 bg-white px-2 py-2 md:hidden"
          >
            {navigation.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                activeProps={activeLinkProps}
                inactiveProps={{ className: 'text-zinc-600' }}
                className="shrink-0 rounded-md px-3 py-1.5 text-xs"
              >
                {item.label}
              </Link>
            ))}
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
