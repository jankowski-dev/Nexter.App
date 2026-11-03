import { Card } from '@/components/ui/card';
import { messages } from '@/lib/i18n';
import { Outlet } from '@tanstack/react-router';

export function AuthLayout() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-zinc-950 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="text-2xl font-semibold tracking-tight text-zinc-50">
            {messages.app.name}
          </div>
          <div className="mt-1 text-sm text-zinc-500">{messages.app.tagline}</div>
        </div>

        <Card className="p-6">
          <Outlet />
        </Card>

        <p className="mt-5 text-center text-xs leading-relaxed text-zinc-600">
          Nexter никогда не попросит seed-фразу или приватный ключ. Вход только по паролю и TOTP.
        </p>
      </div>
    </div>
  );
}
