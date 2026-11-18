import type { NavIconName } from '@/components/nav-icon';
export type CryptoTab =
  'overview' | 'tokens' | 'orders' | 'operations' | 'robots' | 'ai' | 'strategies' | 'statistics';

export const cryptoTabs: ReadonlyArray<{
  value: CryptoTab;
  label: string;
  icon: NavIconName;
}> = [
  { value: 'overview', label: 'Обзор', icon: 'dashboard' },
  { value: 'tokens', label: 'Токены', icon: 'watchlist' },
  { value: 'orders', label: 'Ордера', icon: 'portfolio' },
  { value: 'operations', label: 'Операции', icon: 'operations' },
  { value: 'robots', label: 'Роботы', icon: 'testing' },
  { value: 'ai', label: 'ИИ-торговля', icon: 'ai' },
  { value: 'strategies', label: 'Стратегии', icon: 'sliders' },
  { value: 'statistics', label: 'Статистика', icon: 'statistics' },
];

export function tabFromLocation(pathname: string, hash: string | undefined): CryptoTab {
  if (pathname === '/operations') return 'operations';
  if (pathname === '/watchlist') return 'tokens';
  if (pathname === '/statistics' || pathname === '/reports') return 'statistics';

  switch (hash) {
    case '#tokens':
    case '#watchlist':
      return 'tokens';
    case '#orders':
    case '#deals':
    case '#trades':
    case '#journal':
      return 'orders';
    case '#operations':
      return 'operations';
    case '#robots':
      return 'robots';
    case '#ai':
      return 'ai';
    case '#strategies':
      return 'strategies';
    case '#statistics':
    case '#reports':
      return 'statistics';
    default:
      return 'overview';
  }
}

export function hashForTab(tab: CryptoTab): string {
  switch (tab) {
    case 'tokens':
      return '#tokens';
    case 'orders':
      return '#orders';
    case 'operations':
      return '#operations';
    case 'robots':
      return '#robots';
    case 'ai':
      return '#ai';
    case 'strategies':
      return '#strategies';
    case 'statistics':
      return '#statistics';
    default:
      return '#overview';
  }
}
