import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  buildSandboxCoverage,
  SandboxTokensService,
  type SandboxAuditMeta,
} from './sandbox-tokens.service';
import type {
  SandboxCandleStats,
  SandboxTokenInsert,
  SandboxTokenRecord,
  SandboxTokenUpdate,
} from './sandbox.repository';

const userId = '22222222-2222-4222-8222-222222222222';
const now = new Date('2026-11-24T12:30:00.000Z');
const meta: SandboxAuditMeta = { ip: '127.0.0.1', userAgent: 'vitest' };

function row(overrides: Partial<SandboxTokenRecord> = {}): SandboxTokenRecord {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    userId,
    tokenKey: 'bsc:0x1111111111111111111111111111111111111111',
    symbol: 'CAKE',
    name: 'PancakeSwap',
    chain: 'bsc',
    contractAddress: '0x1111111111111111111111111111111111111111',
    coingeckoId: null,
    enabled: true,
    createdAt: new Date('2026-11-01T00:00:00.000Z'),
    updatedAt: new Date('2026-11-01T00:00:00.000Z'),
    ...overrides,
  };
}

function fullStats(overrides: Partial<SandboxCandleStats> = {}): SandboxCandleStats {
  const lastOpenTime = new Date(now.getTime() - 3_600_000);
  return {
    available: 4320,
    firstOpenTime: new Date(lastOpenTime.getTime() - 4319 * 3_600_000),
    lastOpenTime,
    syntheticCandles: 0,
    ...overrides,
  };
}

function harness(tokens: SandboxTokenRecord[] = [row()]) {
  const repo = {
    listTokens: vi.fn(async (ownerId: string) =>
      tokens.filter((token) => token.userId === ownerId),
    ),
    findTokenById: vi.fn(
      async (ownerId: string, id: string) =>
        tokens.find((token) => token.userId === ownerId && token.id === id) ?? null,
    ),
    insertToken: vi.fn(async (input: SandboxTokenInsert) => {
      const created = row({ ...input });
      tokens.push(created);
      return created;
    }),
    updateToken: vi.fn(async (ownerId: string, id: string, patch: SandboxTokenUpdate) => {
      const found = tokens.find((token) => token.userId === ownerId && token.id === id);
      if (!found) return null;
      Object.assign(found, patch, { updatedAt: now });
      return found;
    }),
    candleStatsMany: vi.fn(async (tokenKeys: string[]) => {
      const map = new Map<string, SandboxCandleStats>();
      for (const tokenKey of tokenKeys) map.set(tokenKey, fullStats());
      return map;
    }),
  };
  const audit = { log: vi.fn(async () => undefined) };
  const data = {
    refreshToken: vi.fn(async () => ({
      fetched: 12,
      upserted: 12,
      source: 'geckoterminal',
      synthetic: false,
    })),
  };
  const service = new SandboxTokensService(repo as never, audit as never, data as never);

  return { service, repo, audit, data, tokens };
}

describe('SandboxTokensService create', () => {
  it('normalizes an EVM key and audits the creation', async () => {
    const { service, repo, audit } = harness([]);

    const created = await service.create(
      userId,
      {
        tokenKey: 'BSC:0xABCDEF1111111111111111111111111111111111',
        symbol: ' CAKE ',
        name: 'PancakeSwap',
      },
      meta,
    );

    expect(repo.insertToken).toHaveBeenCalledWith(
      expect.objectContaining({
        userId,
        tokenKey: 'bsc:0xabcdef1111111111111111111111111111111111',
        symbol: 'CAKE',
        name: 'PancakeSwap',
        chain: 'bsc',
        contractAddress: '0xabcdef1111111111111111111111111111111111',
        coingeckoId: null,
        enabled: true,
      }),
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        userId,
        action: 'sandbox.token_created',
        entityType: 'sandbox_token',
        entityId: created.id,
        after: expect.objectContaining({ tokenKey: created.tokenKey }),
        ip: meta.ip,
        userAgent: meta.userAgent,
      }),
    );
    expect(created.tokenKey).toBe('bsc:0xabcdef1111111111111111111111111111111111');
  });

  it('normalizes a Binance pair and omits the contract address', async () => {
    const { service, repo } = harness([]);

    const created = await service.create(
      userId,
      { tokenKey: 'binance:btcusdt', symbol: 'BTC', name: 'Bitcoin' },
      meta,
    );

    expect(repo.insertToken).toHaveBeenCalledWith(
      expect.objectContaining({
        tokenKey: 'binance:BTCUSDT',
        chain: 'binance',
        contractAddress: null,
      }),
    );
    expect(created.enabled).toBe(true);
  });

  it('keeps an explicit disabled create and coingecko id', async () => {
    const { service } = harness([]);

    const created = await service.create(
      userId,
      {
        tokenKey: 'bsc:0x1111111111111111111111111111111111111111',
        symbol: 'CAKE',
        name: 'PancakeSwap',
        coingeckoId: 'pancakeswap-token',
        enabled: false,
      },
      meta,
    );

    expect(created.enabled).toBe(false);
    expect(created.coingeckoId).toBe('pancakeswap-token');
  });

  it('rejects an invalid key', async () => {
    const { service } = harness([]);

    await expect(
      service.create(userId, { tokenKey: 'solana:abc', symbol: 'X', name: 'X' }, meta),
    ).rejects.toMatchObject({ response: { code: 'SANDBOX_TOKEN_KEY_INVALID' } });
  });

  it('rejects a contract address that does not match the key', async () => {
    const { service, repo } = harness([]);

    await expect(
      service.create(
        userId,
        {
          tokenKey: 'bsc:0x1111111111111111111111111111111111111111',
          symbol: 'CAKE',
          name: 'PancakeSwap',
          contractAddress: '0x2222222222222222222222222222222222222222',
        },
        meta,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.insertToken).not.toHaveBeenCalled();
  });

  it('maps a duplicate token to a conflict', async () => {
    const { service, repo, audit } = harness([]);
    repo.insertToken.mockRejectedValueOnce(
      Object.assign(new Error('duplicate key'), { code: '23505' }),
    );

    await expect(
      service.create(
        userId,
        {
          tokenKey: 'bsc:0x1111111111111111111111111111111111111111',
          symbol: 'CAKE',
          name: 'PancakeSwap',
        },
        meta,
      ),
    ).rejects.toMatchObject({ response: { code: 'SANDBOX_TOKEN_EXISTS' } });
    expect(audit.log).not.toHaveBeenCalled();
  });
});

describe('SandboxTokensService update', () => {
  it('updates and audits with a before/after snapshot', async () => {
    const { service, repo, audit } = harness();

    const updated = await service.update(userId, row().id, { enabled: false }, meta);

    expect(repo.updateToken).toHaveBeenCalledWith(userId, row().id, { enabled: false });
    expect(updated.enabled).toBe(false);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'sandbox.token_updated',
        entityId: row().id,
        before: expect.objectContaining({ enabled: true }),
        after: expect.objectContaining({ enabled: false }),
      }),
    );
  });

  it('returns 404 for an unknown or foreign token', async () => {
    const { service } = harness();

    await expect(
      service.update(userId, '33333333-3333-4333-8333-333333333333', { enabled: false }, meta),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('SandboxTokensService refresh', () => {
  it('refreshes candles, returns coverage and audits the fetch', async () => {
    const { service, repo, audit, data } = harness();

    const result = await service.refresh(userId, row().id, meta, now);

    expect(data.refreshToken).toHaveBeenCalledWith(row(), { now });
    expect(result.fetched).toBe(12);
    expect(result.token.id).toBe(row().id);
    expect(result.coverage.status).toBe('ok');
    expect(repo.candleStatsMany).toHaveBeenCalledWith([row().tokenKey]);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'sandbox.token_refreshed',
        entityType: 'sandbox_token',
        entityId: row().id,
        after: expect.objectContaining({
          tokenKey: row().tokenKey,
          fetched: 12,
          source: 'geckoterminal',
          synthetic: false,
        }),
      }),
    );
  });

  it('does not fetch when the token is unknown', async () => {
    const { service, data } = harness();

    await expect(
      service.refresh(userId, '33333333-3333-4333-8333-333333333333', meta, now),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(data.refreshToken).not.toHaveBeenCalled();
  });
});

describe('SandboxTokensService coverage', () => {
  it('lists every owner token with coverage and required hours', async () => {
    const { service } = harness();
    const response = await service.coverage(userId, undefined, now);

    expect(response.tokens).toHaveLength(1);
    expect(response.tokens[0]).toMatchObject({
      tokenKey: row().tokenKey,
      timeframe: '1h',
      available: 4320,
      required: 4320,
      gaps: 0,
      synthetic: false,
      stale: false,
      status: 'ok',
      warning: null,
    });
  });

  it('filters by token key and scopes statistics to the owner', async () => {
    const { service, repo } = harness();
    const response = await service.coverage(userId, row().tokenKey, now);

    expect(repo.listTokens).toHaveBeenCalledWith(userId);
    expect(response.tokens.map((token) => token.tokenKey)).toEqual([row().tokenKey]);
  });

  it('returns 404 for a token key the owner does not own', async () => {
    const { service, repo } = harness();

    await expect(
      service.coverage(userId, 'ethereum:0x2222222222222222222222222222222222222222', now),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.candleStatsMany).not.toHaveBeenCalled();
  });

  it('reports gaps, synthetic data and staleness', async () => {
    const { service, repo } = harness();
    repo.candleStatsMany.mockResolvedValueOnce(
      new Map([
        [
          row().tokenKey,
          fullStats({
            available: 4300,
            lastOpenTime: new Date(now.getTime() - 5 * 3_600_000),
            firstOpenTime: new Date(now.getTime() - 5 * 3_600_000 - 4320 * 3_600_000),
            syntheticCandles: 4300,
          }),
        ],
      ]),
    );

    const response = await service.coverage(userId, undefined, now);
    const coverage = response.tokens[0];

    expect(coverage).toMatchObject({
      available: 4300,
      required: 4320,
      status: 'partial',
      synthetic: true,
      stale: true,
    });
    expect(coverage.gaps).toBe(21);
    expect(coverage.warning).toContain('4300');
    expect(coverage.warning).toContain('synthetic');
    expect(coverage.warning).toContain('старше');
  });

  it('treats a complete but stale window as partial, never ok', async () => {
    const { service, repo } = harness();
    repo.candleStatsMany.mockResolvedValueOnce(
      new Map([
        [
          row().tokenKey,
          fullStats({
            lastOpenTime: new Date(now.getTime() - 3 * 3_600_000),
            firstOpenTime: new Date(now.getTime() - 3 * 3_600_000 - 4319 * 3_600_000),
          }),
        ],
      ]),
    );

    const response = await service.coverage(userId, undefined, now);
    const coverage = response.tokens[0];

    expect(coverage).toMatchObject({
      available: 4320,
      required: 4320,
      gaps: 0,
      stale: true,
      status: 'partial',
    });
    expect(coverage.warning).toContain('старше');
    expect(coverage.warning).not.toContain('Доступно');
  });

  it('treats a token without candles as missing with a warning', async () => {
    const { service, repo } = harness();
    repo.candleStatsMany.mockResolvedValueOnce(new Map());

    const response = await service.coverage(userId, undefined, now);

    expect(response.tokens[0]).toMatchObject({
      status: 'missing',
      available: 0,
      gaps: 0,
      firstOpenTime: null,
      lastOpenTime: null,
      stale: true,
    });
    expect(response.tokens[0]?.warning).toBeTruthy();
  });
});

describe('SandboxTokensService preflight', () => {
  it('returns ok when every requested token has full coverage', async () => {
    const { service } = harness();
    const preflight = await service.preflight(userId, [row().tokenKey], now);

    expect(preflight.status).toBe('ok');
    expect(preflight.warnings).toEqual([]);
    expect(preflight.coverage).toHaveLength(1);
  });

  it('returns partial for a short window and missing for absent data', async () => {
    const partialToken = row({
      id: '44444444-4444-4444-8444-444444444444',
      tokenKey: 'ethereum:0x2222222222222222222222222222222222222222',
      symbol: 'ETH',
      name: 'Ether',
      chain: 'ethereum',
      contractAddress: '0x2222222222222222222222222222222222222222',
    });
    const missingToken = row({
      id: '55555555-5555-4555-8555-555555555555',
      tokenKey: 'binance:BTCUSDT',
      symbol: 'BTC',
      name: 'Bitcoin',
      chain: 'binance',
      contractAddress: null,
    });
    const { service, repo } = harness([row(), partialToken, missingToken]);
    repo.candleStatsMany.mockResolvedValueOnce(
      new Map([
        [row().tokenKey, fullStats()],
        [partialToken.tokenKey, fullStats({ available: 1200 })],
      ]),
    );

    const preflight = await service.preflight(
      userId,
      [row().tokenKey, partialToken.tokenKey, missingToken.tokenKey],
      now,
    );

    expect(preflight.status).toBe('missing');
    expect(preflight.warnings.length).toBeGreaterThanOrEqual(2);
    expect(preflight.coverage.map((coverage) => [coverage.tokenKey, coverage.status])).toEqual([
      [row().tokenKey, 'ok'],
      [partialToken.tokenKey, 'partial'],
      [missingToken.tokenKey, 'missing'],
    ]);
  });

  it('never reports ok for stale coverage', async () => {
    const { service, repo } = harness();
    repo.candleStatsMany.mockResolvedValueOnce(
      new Map([
        [
          row().tokenKey,
          fullStats({
            lastOpenTime: new Date(now.getTime() - 3 * 3_600_000),
            firstOpenTime: new Date(now.getTime() - 3 * 3_600_000 - 4319 * 3_600_000),
          }),
        ],
      ]),
    );

    const preflight = await service.preflight(userId, [row().tokenKey], now);

    expect(preflight.status).toBe('partial');
    expect(preflight.warnings[0]).toContain('старше');
  });

  it('rejects an empty universe with a warning', async () => {
    const { service } = harness();

    const preflight = await service.preflight(userId, [], now);

    expect(preflight.status).toBe('missing');
    expect(preflight.coverage).toEqual([]);
    expect(preflight.warnings[0]).toContain('Не выбрано');
  });

  it('warns about requested tokens outside the owner universe', async () => {
    const { service } = harness();
    const preflight = await service.preflight(
      userId,
      ['ethereum:0x2222222222222222222222222222222222222222'],
      now,
    );

    expect(preflight.status).toBe('missing');
    expect(preflight.coverage).toEqual([]);
    expect(preflight.warnings[0]).toContain('не найден');
  });
});

describe('buildSandboxCoverage', () => {
  it('keeps status ok only for a complete gapless window', () => {
    const stats = fullStats();
    expect(buildSandboxCoverage(row().tokenKey, stats, now)).toMatchObject({
      available: 4320,
      required: 4320,
      gaps: 0,
      status: 'ok',
      warning: null,
    });

    expect(buildSandboxCoverage(row().tokenKey, { ...stats, available: 4319 }, now).status).toBe(
      'partial',
    );
  });

  it('labels synthetic CoinGecko fallback without inventing gaps', () => {
    const stats = fullStats({ syntheticCandles: 4320 });
    const coverage = buildSandboxCoverage(row().tokenKey, stats, now);

    expect(coverage.synthetic).toBe(true);
    expect(coverage.gaps).toBe(0);
    expect(coverage.status).toBe('ok');
    expect(coverage.warning).toContain('synthetic');
  });
});

describe('SandboxTokensService list', () => {
  it('maps stored rows to ISO contract timestamps', async () => {
    const { service, repo } = harness();

    const response = await service.list(userId);

    expect(repo.listTokens).toHaveBeenCalledWith(userId);
    expect(response.tokens[0]?.createdAt).toBe('2026-11-01T00:00:00.000Z');
    expect(response.tokens[0]?.updatedAt).toBe('2026-11-01T00:00:00.000Z');
  });
});
