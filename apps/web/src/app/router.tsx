import { DashboardPage } from '@/features/dashboard/dashboard-page';
import { FinancePage } from '@/features/finance/finance-page';
import { ImportPage } from '@/features/import/import-page';
import { LoginPage } from '@/features/auth/login-page';
import { PortfolioPage } from '@/features/portfolio/portfolio-page';
import { SandboxPage } from '@/features/sandbox/sandbox-page';
import { RecoveryPage } from '@/features/auth/recovery-page';
import { ResetPasswordPage } from '@/features/auth/reset-password-page';
import { Setup2faPage } from '@/features/auth/setup-2fa-page';
import { SetupPage } from '@/features/auth/setup-page';
import { TwoFactorPage } from '@/features/auth/two-factor-page';
import { TradeDetailPage } from '@/features/trades/trade-detail-page';
import { NotesPage } from '@/features/notes/notes-page';
import { NotificationsPage } from '@/features/notifications/notifications-page';
import { TasksPage } from '@/features/tasks/tasks-page';
import { VaultPage } from '@/features/vault/vault-page';
import { AccountingSettingsPage } from '@/features/settings/accounting-settings-page';
import { AccountsSettingsPage } from '@/features/settings/accounts-settings-page';
import { BotsSettingsPage } from '@/features/settings/bots-settings-page';
import { DataSettingsPage } from '@/features/settings/data-settings-page';
import { DiagnosticsSettingsPage } from '@/features/settings/diagnostics-settings-page';
import { MarketSettingsPage } from '@/features/settings/market-settings-page';
import { NotificationsSettingsPage } from '@/features/settings/notifications-settings-page';
import { TasksSettingsPage } from '@/features/settings/tasks-settings-page';
import { TradingSettingsPage } from '@/features/settings/trading-settings-page';
import { AiSettingsPage } from '@/features/settings/ai-settings-page';
import { AuditSettingsPage } from '@/features/settings/audit-settings-page';
import { DataQualityPage } from '@/features/settings/data-quality-page';
import { InterfaceSettingsPage } from '@/features/settings/interface-settings-page';
import { SecuritySettingsPage } from '@/features/settings/security-settings-page';
import { SettingsPage } from '@/features/settings/settings-page';
import { SystemStatusPage } from '@/features/settings/system-status-page';
import { Button } from '@/components/ui/button';
import { ApiError, apiFetch } from '@/lib/api';
import { authMeResponseSchema } from '@nexter/contracts';
import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  redirect,
  type ErrorComponentProps,
} from '@tanstack/react-router';
import { AuthLayout } from './auth-layout';
import { RootLayout } from './root-layout';

function RouteError({ error, reset }: ErrorComponentProps) {
  const message =
    error instanceof Error && error.message
      ? error.message
      : 'Произошла ошибка. Повторите попытку.';

  return (
    <div className="flex min-h-dvh items-center justify-center bg-zinc-50 px-6">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 text-center shadow-sm">
        <h1 className="text-lg font-semibold text-zinc-900">Не удалось загрузить страницу</h1>
        <p className="mt-2 text-sm text-zinc-600">{message}</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Button onClick={() => reset()}>Повторить</Button>
          <Button variant="secondary" asChild>
            <Link to="/dashboard">На дашборд</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

function RouteNotFound() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-zinc-50 px-6">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 text-center shadow-sm">
        <h1 className="text-lg font-semibold text-zinc-900">Страница не найдена</h1>
        <p className="mt-2 text-sm text-zinc-600">Такой страницы нет или она была перемещена.</p>
        <div className="mt-5 flex justify-center">
          <Button asChild>
            <Link to="/dashboard">На дашборд</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

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

const sandboxRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/sandbox',
  component: SandboxPage,
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
  component: PortfolioPage,
});

const statisticsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/statistics',
  component: PortfolioPage,
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
  component: PortfolioPage,
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

const interfaceSettingsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/settings/interface',
  component: InterfaceSettingsPage,
});

const aiSettingsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/settings/ai',
  component: AiSettingsPage,
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

const systemSettingsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/settings/system',
  component: SystemStatusPage,
});

const dataQualityRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/settings/data-quality',
  component: DataQualityPage,
});

const accountingSettingsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/settings/accounting',
  component: AccountingSettingsPage,
});

const marketSettingsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/settings/market',
  component: MarketSettingsPage,
});

const tradingSettingsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/settings/trading',
  component: TradingSettingsPage,
});

const botsSettingsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/settings/bots',
  component: BotsSettingsPage,
});

const tasksSettingsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/settings/tasks',
  component: TasksSettingsPage,
});

const notificationsSettingsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/settings/notifications',
  component: NotificationsSettingsPage,
});

const dataSettingsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/settings/data',
  component: DataSettingsPage,
});

const diagnosticsSettingsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/settings/diagnostics',
  component: DiagnosticsSettingsPage,
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
    sandboxRoute,
    tradesRoute,
    tradeDetailRoute,
    operationsRoute,
    statisticsRoute,
    reportsRoute,
    vaultRoute,
    tasksRoute,
    notesRoute,
    notificationsRoute,
    importRoute,
    financeRoute,
    watchlistRoute,
    swapRoute,
    settingsRoute,
    securitySettingsRoute,
    interfaceSettingsRoute,
    aiSettingsRoute,
    accountsSettingsRoute,
    auditSettingsRoute,
    systemSettingsRoute,
    dataQualityRoute,
    accountingSettingsRoute,
    marketSettingsRoute,
    tradingSettingsRoute,
    botsSettingsRoute,
    tasksSettingsRoute,
    notificationsSettingsRoute,
    dataSettingsRoute,
    diagnosticsSettingsRoute,
  ]),
]);

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  defaultErrorComponent: RouteError,
  defaultNotFoundComponent: RouteNotFound,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
