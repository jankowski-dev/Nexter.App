import { describe, expect, it } from 'vitest';
import {
  watchlistCreateRequestSchema,
  watchlistFromContractRequestSchema,
  watchlistUpdateRequestSchema,
} from './watchlist';

const assetId = '11111111-1111-4111-8111-111111111111';
const chain = 'bsc';
const address = '0x1111111111111111111111111111111111111111';

describe('watchlist metadata validation', () => {
  it('accepts http and https URLs and trims whitespace', () => {
    const parsed = watchlistCreateRequestSchema.parse({
      assetId,
      twitterUrl: '  https://x.com/token  ',
      websiteUrl: 'http://example.com',
    });

    expect(parsed.twitterUrl).toBe('https://x.com/token');
    expect(parsed.websiteUrl).toBe('http://example.com');
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,hello',
    '//example.com',
    'https://',
    '\u0000https://example.com',
    `https://example.com/${'a'.repeat(500)}`,
  ])('rejects unsafe or malformed URL %s', (url) => {
    expect(watchlistCreateRequestSchema.safeParse({ assetId, twitterUrl: url }).success).toBe(
      false,
    );
  });

  it('accepts null to clear a URL', () => {
    const parsed = watchlistUpdateRequestSchema.parse({ twitterUrl: null, websiteUrl: null });

    expect(parsed.twitterUrl).toBeNull();
    expect(parsed.websiteUrl).toBeNull();
  });

  it('keeps omitted fields absent so the service preserves them', () => {
    const parsed = watchlistUpdateRequestSchema.parse({ thesis: 'Only the description' });

    expect(parsed).not.toHaveProperty('twitterUrl');
    expect(parsed).not.toHaveProperty('websiteUrl');
    expect(parsed).not.toHaveProperty('investors');
  });

  it('trims investor names', () => {
    const parsed = watchlistCreateRequestSchema.parse({
      assetId,
      investors: [' Alpha Capital ', 'Beta Ventures'],
    });

    expect(parsed.investors).toEqual(['Alpha Capital', 'Beta Ventures']);
  });

  it('rejects more than 30 investors and investors longer than 80 characters', () => {
    const tooMany = Array.from({ length: 31 }, (_, index) => `Fund ${index}`);
    const tooLong = ['a'.repeat(81)];

    expect(watchlistCreateRequestSchema.safeParse({ assetId, investors: tooMany }).success).toBe(
      false,
    );
    expect(watchlistCreateRequestSchema.safeParse({ assetId, investors: tooLong }).success).toBe(
      false,
    );
    expect(watchlistCreateRequestSchema.safeParse({ assetId, investors: ['   '] }).success).toBe(
      false,
    );
  });

  it('accepts 30 investors and 80-character names', () => {
    const investors = Array.from({ length: 30 }, (_, index) => `Fund ${index}`);
    investors[0] = 'a'.repeat(80);

    expect(watchlistCreateRequestSchema.safeParse({ assetId, investors }).success).toBe(true);
  });

  it('applies the same metadata validation to from-contract requests', () => {
    expect(
      watchlistFromContractRequestSchema.safeParse({
        chain,
        address,
        twitterUrl: 'https://x.com/token',
        websiteUrl: 'https://example.com',
        investors: ['Alpha Capital'],
      }).success,
    ).toBe(true);

    expect(
      watchlistFromContractRequestSchema.safeParse({
        chain,
        address,
        websiteUrl: 'javascript:alert(1)',
      }).success,
    ).toBe(false);
  });
});
