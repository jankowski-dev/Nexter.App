import { NexterLogo } from '@/components/nexter-logo';
import { messages } from '@/lib/i18n';
import { Outlet } from '@tanstack/react-router';
import { AuthVisualProvider, useAuthVisual } from '@/features/auth/auth-visual';

function AuthFrame() {
  const visual = useAuthVisual();

  return (
    <div className="auth-shell">
      <main className="auth-stage">
        <NexterLogo lit={visual.lit} state={visual.state} className="auth-logo" />

        <div className="auth-content">
          <div className="mb-4 text-center">
            <div className="text-sm font-medium uppercase tracking-[0.24em] text-[#c2e32f]">
              {messages.app.name}
            </div>
            <div className="mt-1 text-xs text-[#a8a8a8]">{messages.app.tagline}</div>
          </div>
          <Outlet />
          <p className="mt-6 text-center text-[11px] leading-relaxed text-[#9a9a9a]">
            Nexter никогда не попросит seed-фразу или приватный ключ.
          </p>
        </div>
      </main>
    </div>
  );
}

export function AuthLayout() {
  return (
    <AuthVisualProvider>
      <AuthFrame />
    </AuthVisualProvider>
  );
}
