import { DashboardPage } from '@/features/dashboard/dashboard-page';
import { FinancePage } from '@/features/finance/finance-page';
import { ImportPage } from '@/features/import/import-page';
import { LoginPage } from '@/features/auth/login-page';
import { AssetDetailPage } from '@/features/portfolio/asset-detail-page';
import { PortfolioPage } from '@/features/portfolio/portfolio-page';
import { RecoveryPage } from '@/features/auth/recovery-page';
import { ResetPasswordPage } from '@/features/auth/reset-password-page';
import { Setup2faPage } from '@/features/auth/setup-2fa-page';
import { SetupPage } from '@/features/auth/setup-page';
import { TwoFactorPage } from '@/features/auth/two-factor-page';
import { TradeDetailPage } from '@/features/trades/trade-detail-page';
import { WatchlistPage } from '@/features/watchlist/watchlist-page';
import { OperationsPage } from '@/features/operations/operations-page';
import { ReportsPage } from '@/features/reports/reports-page';
import { NotesPage } from '@/features/notes/notes-page';
import { NotificationsPage } from '@/features/notifications/notifications-page';
import { TasksPage } from '@/features/tasks/tasks-page';
import { TestingPage } from '@/features/testing/testing-page';
import { VaultPage } from '@/features/vault/vault-page';
import { AccountsSettingsPage } from '@/features/settings/accounts-settings-page';
import { AuditSettingsPage } from '@/features/settings/audit-settings-page';
import { DataQualityPage } from '@/features/settings/data-quality-page';
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
  component: PortfolioPage,
});

const assetDetailRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/portfolio/assets/$assetId',
  component: AssetDetailPage,
});

const tradesRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/trades',
  beforeLoad: () => {
    throw redirect({ to: '/portfolio' });
  },
});

const tradeDetailRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/trades/$tradeId',
  component: TradeDetailPage,
});

const operationsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/operations',
  component: OperationsPage,
});

const statisticsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/statistics',
  component: ReportsPage,
});

const reportsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/reports',
  beforeLoad: () => {
    throw redirect({ to: '/statistics' });
  },
});

const vaultRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/vault',
  component: VaultPage,
});

const tasksRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/tasks',
  component: TasksPage,
});

const testingRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/testing',
  component: TestingPage,
});

const notesRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/notes',
  component: NotesPage,
});

const notificationsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/notifications',
  component: NotificationsPage,
});

const importRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/import',
  component: ImportPage,
});

const financeRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/finance',
  component: FinancePage,
});

const watchlistRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/watchlist',
  component: WatchlistPage,
});

const swapRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/swap',
  beforeLoad: () => {
    throw redirect({ to: '/portfolio' });
  },
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

const accountsSettingsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/settings/accounts',
  component: AccountsSettingsPage,
});

const auditSettingsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/settings/audit',
  component: AuditSettingsPage,
});

const dataQualityRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/settings/data-quality',
  component: DataQualityPage,
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
    assetDetailRoute,
    tradesRoute,
    tradeDetailRoute,
    operationsRoute,
    statisticsRoute,
    reportsRoute,
    vaultRoute,
    tasksRoute,
    testingRoute,
    notesRoute,
    notificationsRoute,
    importRoute,
    financeRoute,
    watchlistRoute,
    swapRoute,
    settingsRoute,
    securitySettingsRoute,
    accountsSettingsRoute,
    auditSettingsRoute,
    dataQualityRoute,
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
