import { apiCacheControl } from './cache-control';

describe('apiCacheControl', () => {
  it('defaults API responses to no-store', () => {
    expect(apiCacheControl('/api/v1/portfolio')).toBe('no-store');
    expect(apiCacheControl('/api/v1/dashboard?period=month')).toBe('no-store');
  });

  it('lets the token icon proxy keep its public cache header', () => {
    expect(apiCacheControl('/api/v1/watchlist/icon?url=https%3A%2F%2Fexample.com%2Ficon.png')).toBe(
      null,
    );
  });

  it('does not exempt lookalike routes', () => {
    expect(apiCacheControl('/api/v1/watchlist/icon-history')).toBe('no-store');
    expect(apiCacheControl('/api/v1/watchlist/icons')).toBe('no-store');
  });

  it('leaves non-API routes alone', () => {
    expect(apiCacheControl('/dashboard')).toBeNull();
    expect(apiCacheControl('/')).toBeNull();
  });
});
