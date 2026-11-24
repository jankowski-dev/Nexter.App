import { describe, expect, it } from 'vitest';
import {
  parseSandboxTokenKey,
  sandboxCoverageQuerySchema,
  sandboxCoverageResponseSchema,
  sandboxCoverageSchema,
  sandboxTokenCreateRequestSchema,
  sandboxTokenKeySchema,
  sandboxTokenRefreshResponseSchema,
  sandboxTokenSchema,
  sandboxTokenUpdateRequestSchema,
} from './sandbox';

const bscKey = 'bsc:0x1111111111111111111111111111111111111111';

describe('sandbox token keys', () => {
  it('parses EVM and Binance provider keys', () => {
    expect(parseSandboxTokenKey(bscKey)).toEqual({
      chain: 'bsc',
      identifier: '0x1111111111111111111111111111111111111111',
      contractAddress: '0x1111111111111111111111111111111111111111',
      baseSymbol: null,
    });

    expect(parseSandboxTokenKey('ethereum:0xAbCdEf1111111111111111111111111111111111')).toEqual({
      chain: 'ethereum',
      identifier: '0xabcdef1111111111111111111111111111111111',
      contractAddress: '0xabcdef1111111111111111111111111111111111',
      baseSymbol: null,
    });

    expect(parseSandboxTokenKey('binance:BTCUSDT')).toEqual({
      chain: 'binance',
      identifier: 'BTCUSDT',
      contractAddress: null,
      baseSymbol: 'BTC',
    });
  });

  it.each([
    'solana:0x1111111111111111111111111111111111111111',
    'bsc:0x123',
    'binance:btcusdt',
    'binance:BTC',
    '',
    'bsc:',
  ])('rejects invalid key %s', (key) => {
    expect(parseSandboxTokenKey(key)).toBeNull();
    expect(sandboxTokenKeySchema.safeParse(key).success).toBe(false);
  });
});

describe('sandbox token contracts', () => {
  it('parses a token row', () => {
    const parsed = sandboxTokenSchema.parse({
      id: '11111111-1111-4111-8111-111111111111',
      tokenKey: bscKey,
      symbol: 'CAKE',
      name: 'PancakeSwap',
      chain: 'bsc',
      contractAddress: '0x1111111111111111111111111111111111111111',
      coingeckoId: 'pancakeswap-token',
      enabled: true,
      createdAt: '2026-11-24T00:00:00.000Z',
      updatedAt: '2026-11-24T00:00:00.000Z',
    });

    expect(parsed.tokenKey).toBe(bscKey);
    expect(parsed.contractAddress).not.toBeNull();
  });

  it('trims create fields and accepts an EVM key without a repeated contract address', () => {
    const parsed = sandboxTokenCreateRequestSchema.parse({
      tokenKey: `  ${bscKey}  `,
      symbol: '  cake ',
      name: ' PancakeSwap ',
      coingeckoId: 'pancakeswap-token',
    });

    expect(parsed).toEqual({
      tokenKey: bscKey,
      symbol: 'cake',
      name: 'PancakeSwap',
      coingeckoId: 'pancakeswap-token',
    });
  });

  it('rejects an EVM contract address that does not match the key', () => {
    expect(
      sandboxTokenCreateRequestSchema.safeParse({
        tokenKey: bscKey,
        symbol: 'CAKE',
        name: 'PancakeSwap',
        contractAddress: '0x2222222222222222222222222222222222222222',
      }).success,
    ).toBe(false);
  });

  it('rejects a contract address on a Binance pair', () => {
    expect(
      sandboxTokenCreateRequestSchema.safeParse({
        tokenKey: 'binance:BTCUSDT',
        symbol: 'BTC',
        name: 'Bitcoin',
        contractAddress: bscKey.slice(4),
      }).success,
    ).toBe(false);
  });

  it.each([{ symbol: '' }, { name: 'x'.repeat(81) }, { coingeckoId: 'Not A Slug' }])(
    'rejects invalid create payload %j',
    (patch) => {
      expect(
        sandboxTokenCreateRequestSchema.safeParse({
          tokenKey: bscKey,
          symbol: 'CAKE',
          name: 'PancakeSwap',
          ...patch,
        }).success,
      ).toBe(false);
    },
  );

  it('requires at least one patch field and rejects an immutable tokenKey', () => {
    expect(sandboxTokenUpdateRequestSchema.safeParse({}).success).toBe(false);

    expect(
      sandboxTokenUpdateRequestSchema.safeParse({
        enabled: false,
        tokenKey: 'ethereum:0x2222222222222222222222222222222222222222',
      }).success,
    ).toBe(false);
    expect(sandboxTokenUpdateRequestSchema.safeParse({ chain: 'ethereum' }).success).toBe(false);
    expect(sandboxTokenUpdateRequestSchema.parse({ enabled: false })).toEqual({ enabled: false });
    expect(sandboxTokenUpdateRequestSchema.parse({ coingeckoId: null })).toEqual({
      coingeckoId: null,
    });
  });
});

describe('sandbox coverage contracts', () => {
  const coverage = {
    tokenKey: bscKey,
    timeframe: '1h',
    available: 4320,
    required: 4320,
    firstOpenTime: '2026-05-28T00:00:00.000Z',
    lastOpenTime: '2026-11-24T00:00:00.000Z',
    gaps: 0,
    synthetic: false,
    stale: false,
    status: 'ok',
    warning: null,
  };

  it('parses a full coverage row', () => {
    expect(sandboxCoverageSchema.parse(coverage)).toEqual(coverage);
  });

  it('rejects negative counts and unknown statuses', () => {
    expect(sandboxCoverageSchema.safeParse({ ...coverage, available: -1 }).success).toBe(false);
    expect(sandboxCoverageSchema.safeParse({ ...coverage, status: 'ready' }).success).toBe(false);
    expect(sandboxCoverageSchema.safeParse({ ...coverage, timeframe: '4h' }).success).toBe(false);
  });

  it('parses coverage responses and the optional token filter', () => {
    expect(sandboxCoverageResponseSchema.parse({ tokens: [coverage] }).tokens).toHaveLength(1);
    expect(sandboxCoverageQuerySchema.parse({})).toEqual({});
    expect(sandboxCoverageQuerySchema.parse({ tokenKey: bscKey })).toEqual({ tokenKey: bscKey });
    expect(sandboxCoverageQuerySchema.safeParse({ tokenKey: 'BTC' }).success).toBe(false);
  });

  it('parses a refresh response', () => {
    expect(
      sandboxTokenRefreshResponseSchema.parse({
        token: {
          id: '11111111-1111-4111-8111-111111111111',
          tokenKey: bscKey,
          symbol: 'CAKE',
          name: 'PancakeSwap',
          chain: 'bsc',
          contractAddress: '0x1111111111111111111111111111111111111111',
          coingeckoId: null,
          enabled: true,
          createdAt: '2026-11-24T00:00:00.000Z',
          updatedAt: '2026-11-24T00:00:00.000Z',
        },
        coverage,
        fetched: 4320,
      }).fetched,
    ).toBe(4320);
  });
});
