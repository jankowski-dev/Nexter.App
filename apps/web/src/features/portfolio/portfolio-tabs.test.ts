import { describe, expect, it } from 'vitest';
import { hashForTab, portfolioTabs, tabFromHash } from './portfolio-tabs';

describe('portfolio tabs', () => {
  it('exposes five trading tabs', () => {
    expect(portfolioTabs.map((tab) => tab.label)).toEqual([
      'Портфель',
      'Ручной',
      'Сделки',
      'Роботы',
      'Стратегии',
    ]);
  });

  it('maps legacy order hashes to the manual tab', () => {
    expect(tabFromHash('#trades')).toBe('manual');
    expect(tabFromHash('#orders')).toBe('manual');
    expect(tabFromHash('#manual')).toBe('manual');
  });

  it('maps deals and journal hashes to the deals tab', () => {
    expect(tabFromHash('#deals')).toBe('deals');
    expect(tabFromHash('#journal')).toBe('deals');
  });

  it('round-trips the current hashes', () => {
    for (const tab of portfolioTabs) {
      expect(tabFromHash(hashForTab(tab.value))).toBe(tab.value);
    }
  });
});
