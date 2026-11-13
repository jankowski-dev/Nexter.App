import { describe, expect, it } from 'vitest';
import { filterBySearch, matchesSearch, normalizeSearchText } from './search';

describe('search helpers', () => {
  it('normalizes case, diacritics and ё', () => {
    expect(normalizeSearchText('  Ёлка Café  ')).toBe('елка cafe');
  });

  it('matches every word against any field', () => {
    expect(matchesSearch('btw bsc', ['BTW', 'Bitwarden', 'BSC'])).toBe(true);
    expect(matchesSearch('btw eth', ['BTW', 'Bitwarden', 'BSC'])).toBe(false);
  });

  it('returns all items for an empty query', () => {
    expect(matchesSearch('', ['anything'])).toBe(true);
    expect(filterBySearch([1, 2], '  ', () => [])).toEqual([1, 2]);
  });

  it('filters a list by mapped values', () => {
    const items = [
      { symbol: 'BTW', name: 'Bitwarden' },
      { symbol: 'XNY', name: 'New York' },
    ];
    expect(filterBySearch(items, 'york', (item) => [item.symbol, item.name])).toEqual([items[1]]);
  });
});
