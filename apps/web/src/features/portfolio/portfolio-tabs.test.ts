import { describe, expect, it } from 'vitest';
import { cryptoTabs, hashForTab, tabFromLocation } from './portfolio-tabs';

describe('crypto tabs', () => {
  it('exposes seven crypto sections', () => {
    expect(cryptoTabs.map((tab) => tab.label)).toEqual([
      'Обзор',
      'Токены',
      'Ордера',
      'Операции',
      'Роботы',
      'Стратегии',
      'Статистика',
    ]);
  });

  it('maps the legacy crypto routes to their tabs', () => {
    expect(tabFromLocation('/operations', '')).toBe('operations');
    expect(tabFromLocation('/watchlist', '')).toBe('tokens');
    expect(tabFromLocation('/statistics', '')).toBe('statistics');
    expect(tabFromLocation('/reports', '')).toBe('statistics');
  });

  it('maps legacy hashes to the new tabs', () => {
    expect(tabFromLocation('/portfolio', '#manual')).toBe('overview');
    expect(tabFromLocation('/portfolio', '#deals')).toBe('orders');
    expect(tabFromLocation('/portfolio', '#journal')).toBe('orders');
    expect(tabFromLocation('/portfolio', '#watchlist')).toBe('tokens');
    expect(tabFromLocation('/portfolio', '#reports')).toBe('statistics');
  });

  it('round-trips the current hashes', () => {
    for (const tab of cryptoTabs) {
      expect(tabFromLocation('/portfolio', hashForTab(tab.value))).toBe(tab.value);
    }
  });
});
