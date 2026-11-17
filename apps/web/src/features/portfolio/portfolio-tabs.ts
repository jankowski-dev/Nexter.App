export type PortfolioTab = 'portfolio' | 'manual' | 'deals' | 'robots' | 'strategies';

export const portfolioTabs: ReadonlyArray<{ value: PortfolioTab; label: string }> = [
  { value: 'portfolio', label: 'Портфель' },
  { value: 'manual', label: 'Ручной' },
  { value: 'deals', label: 'Сделки' },
  { value: 'robots', label: 'Роботы' },
  { value: 'strategies', label: 'Стратегии' },
];

export function tabFromHash(hash: string | undefined): PortfolioTab {
  switch (hash) {
    case '#manual':
    case '#orders':
    case '#trades':
      return 'manual';
    case '#deals':
    case '#journal':
      return 'deals';
    case '#robots':
      return 'robots';
    case '#strategies':
      return 'strategies';
    default:
      return 'portfolio';
  }
}

export function hashForTab(tab: PortfolioTab): string {
  switch (tab) {
    case 'manual':
      return '#manual';
    case 'deals':
      return '#deals';
    case 'robots':
      return '#robots';
    case 'strategies':
      return '#strategies';
    default:
      return '#portfolio';
  }
}
