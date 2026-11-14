import { NexterLogo } from '@/components/nexter-logo';
import { Outlet } from '@tanstack/react-router';
import { AuthVisualProvider, useAuthVisual } from '@/features/auth/auth-visual';

function AuthFrame() {
  const visual = useAuthVisual();

  return (
    <div className="auth-shell">
      <main className="auth-stage">
        <NexterLogo lit={visual.lit} state={visual.state} className="auth-logo" />

        <div className="auth-content">
          <Outlet />
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
