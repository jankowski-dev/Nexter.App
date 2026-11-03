import { DashboardPage } from '@/features/dashboard/dashboard-page';
import { ImportPage } from '@/features/import/import-page';
import { LoginPage } from '@/features/auth/login-page';
import { RecoveryPage } from '@/features/auth/recovery-page';
import { ResetPasswordPage } from '@/features/auth/reset-password-page';
import { Setup2faPage } from '@/features/auth/setup-2fa-page';
import { SetupPage } from '@/features/auth/setup-page';
import { TwoFactorPage } from '@/features/auth/two-factor-page';
import { SecuritySettingsPage } from '@/features/settings/security-settings-page';
import { SettingsPage } from '@/features/settings/settings-page';
import { ApiError, apiFetch } from '@/lib/api';
import { authMeResponseSchema } from '@nexter/contracts';
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import { AuthLayout } from './auth-layout';
import { PlaceholderPage } from './placeholder-page';
import { RootLayout } from './root-layout';

function RootOutlet() {
  return <Outlet />;
}

const rootRoute = createRootRoute({
  component: RootOutlet,
});

const authLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'auth',
  component: AuthLayout,
});

const loginRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: '/login',
  component: LoginPage,
});

const setupRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: '/setup',
  component: SetupPage,
});

const setup2faRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: '/setup-2fa',
  component: Setup2faPage,
});

const twoFactorRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: '/2fa',
  component: TwoFactorPage,
});

const recoveryRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: '/recovery',
  component: RecoveryPage,
});

const resetPasswordRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: '/reset-password',
  component: ResetPasswordPage,
});

const appLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  beforeLoad: async () => {
    try {
      const me = await apiFetch('/api/v1/auth/me', {}, authMeResponseSchema);

      if (me.requires2faSetup) {
        throw redirect({ to: '/setup-2fa' });
      }

      if (me.requires2fa) {
        throw redirect({ to: '/2fa' });
      }

      return { me };
    } catch (error) {
      if (error instanceof ApiError && error.code === 'AUTH_REQUIRED') {
        throw redirect({ to: '/login' });
      }
      throw error;
    }
  },
  component: RootLayout,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/dashboard' });
  },
});

const dashboardRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/dashboard',
  component: DashboardPage,
});

const portfolioRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/portfolio',
  component: () => <PlaceholderPage title="Портфель" />,
});

const tradesRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/trades',
  component: () => <PlaceholderPage title="Сделки" />,
});

const importRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/import',
  component: ImportPage,
});

const watchlistRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/watchlist',
  component: () => <PlaceholderPage title="Наблюдение" />,
});

const settingsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/settings',
  component: SettingsPage,
});

const securitySettingsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/settings/security',
  component: SecuritySettingsPage,
});

const routeTree = rootRoute.addChildren([
  authLayoutRoute.addChildren([
    loginRoute,
    setupRoute,
    setup2faRoute,
    twoFactorRoute,
    recoveryRoute,
    resetPasswordRoute,
  ]),
  indexRoute,
  appLayoutRoute.addChildren([
    dashboardRoute,
    portfolioRoute,
    tradesRoute,
    importRoute,
    watchlistRoute,
    settingsRoute,
    securitySettingsRoute,
  ]),
]);

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
