import { Link, Outlet } from '@tanstack/react-router';

const navigation = [
  { to: '/', label: 'Дашборд' },
  { to: '/portfolio', label: 'Портфель' },
  { to: '/trades', label: 'Сделки' },
  { to: '/import', label: 'Импорт' },
  { to: '/watchlist', label: 'Watchlist' },
  { to: '/settings', label: 'Настройки' },
] as const;

export function RootLayout() {
  return (
    <div className="min-h-dvh bg-zinc-950 text-zinc-100">
      <div className="mx-auto flex min-h-dvh w-full max-w-[1600px]">
        <aside className="hidden w-56 shrink-0 border-r border-zinc-800 bg-zinc-950/80 p-4 md:flex md:flex-col">
          <Link to="/" className="mb-8 block px-2">
            <div className="text-lg font-semibold tracking-tight text-zinc-50">Nexter</div>
            <div className="text-xs text-zinc-500">private finance</div>
          </Link>

          <nav className="flex flex-col gap-1">
            {navigation.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                activeProps={{ className: 'bg-zinc-800 text-zinc-50' }}
                inactiveProps={{ className: 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200' }}
                className="rounded-md px-3 py-2 text-sm transition-colors"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="mt-auto rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 text-xs text-zinc-500">
            Phase 1 · Foundation
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 items-center justify-between border-b border-zinc-800 px-4 md:px-6">
            <div className="text-sm text-zinc-400">Личный финансовый учёт</div>
            <div className="hidden items-center gap-2 text-xs text-zinc-500 sm:flex">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              MVP-1 foundation
            </div>
          </header>

          <nav className="flex gap-1 overflow-x-auto border-b border-zinc-800 px-2 py-2 md:hidden">
            {navigation.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                activeProps={{ className: 'bg-zinc-800 text-zinc-50' }}
                inactiveProps={{ className: 'text-zinc-400' }}
                className="shrink-0 rounded-md px-3 py-1.5 text-xs"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <main className="min-w-0 flex-1 p-4 md:p-6">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
