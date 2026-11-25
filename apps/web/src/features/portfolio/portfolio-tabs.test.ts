import { describe, expect, it } from 'vitest';
import { cryptoTabs, hashForTab, tabFromLocation } from './portfolio-tabs';

describe('crypto tabs', () => {
  it('exposes six crypto sections without the AI and strategy modules', () => {
    expect(cryptoTabs.map((tab) => tab.label)).toEqual([
      'Обзор',
      'Токены',
      'Ордера',
      'Операции',
      'Роботы',
      'Статистика',
    ]);
    expect(cryptoTabs.some((tab) => tab.value === ('strategies' as never))).toBe(false);
    expect(cryptoTabs.some((tab) => tab.value === ('ai' as never))).toBe(false);
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
    expect(tabFromLocation('/portfolio', '#strategies')).toBe('overview');
    expect(tabFromLocation('/portfolio', '#ai')).toBe('overview');
  });

  it('round-trips the current hashes', () => {
    for (const tab of cryptoTabs) {
      expect(tabFromLocation('/portfolio', hashForTab(tab.value))).toBe(tab.value);
    }
  });
});
