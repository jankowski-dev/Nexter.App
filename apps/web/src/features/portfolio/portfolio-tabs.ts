export type CryptoTab =
  'overview' | 'tokens' | 'orders' | 'operations' | 'robots' | 'strategies' | 'statistics';

export const cryptoTabs: ReadonlyArray<{ value: CryptoTab; label: string }> = [
  { value: 'overview', label: 'Обзор' },
  { value: 'tokens', label: 'Токены' },
  { value: 'orders', label: 'Ордера' },
  { value: 'operations', label: 'Операции' },
  { value: 'robots', label: 'Роботы' },
  { value: 'strategies', label: 'Стратегии' },
  { value: 'statistics', label: 'Статистика' },
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
    case 'strategies':
      return '#strategies';
    case 'statistics':
      return '#statistics';
    default:
      return '#overview';
  }
}
