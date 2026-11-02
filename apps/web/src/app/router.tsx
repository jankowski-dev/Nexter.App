import { DashboardPage } from '@/features/dashboard/dashboard-page';
import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { PlaceholderPage } from './placeholder-page';
import { RootLayout } from './root-layout';

const rootRoute = createRootRoute({
  component: RootLayout,
});

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: DashboardPage,
});

const portfolioRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/portfolio',
  component: () => <PlaceholderPage title="Портфель" />,
});

const tradesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/trades',
  component: () => <PlaceholderPage title="Сделки" />,
});

const importRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/import',
  component: () => <PlaceholderPage title="Импорт" />,
});

const watchlistRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/watchlist',
  component: () => <PlaceholderPage title="Watchlist" />,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: () => <PlaceholderPage title="Настройки" />,
});

const routeTree = rootRoute.addChildren([
  dashboardRoute,
  portfolioRoute,
  tradesRoute,
  importRoute,
  watchlistRoute,
  settingsRoute,
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
