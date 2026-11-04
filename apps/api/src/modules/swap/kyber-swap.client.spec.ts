import { describe, expect, it, vi } from 'vitest';
import type { ExternalApiCallService } from './external-api-call.service';
import { KyberApiError, KyberSwapClient } from './kyber-swap.client';

const routeSummary = {
  tokenIn: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d',
  tokenOut: '0x1d28d989f9e3ccb8b15d0cec601734514f958e4d',
  amountIn: '1000000000000000000',
  amountOut: '2000000000000000000',
  amountInUsd: '1.00',
  amountOutUsd: '1.99',
  gas: '120000',
  gasUsd: '0.05',
  priceImpact: '0.10',
  routeID: 'route-1',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function fakeCalls() {
  return { record: vi.fn().mockResolvedValue(undefined) } as unknown as ExternalApiCallService;
}

describe('KyberSwapClient', () => {
  it('requests a route and preserves the route summary', async () => {
    const calls = fakeCalls();
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        code: 0,
        data: {
          routeSummary,
          routerAddress: '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5',
        },
      }),
    );
    const client = new KyberSwapClient(calls, fetchMock as unknown as typeof fetch);

    const result = await client.getRoutes({
      chain: 'bsc',
      tokenIn: routeSummary.tokenIn,
      tokenOut: routeSummary.tokenOut,
      amountInBase: routeSummary.amountIn,
      walletAddress: '0x1111111111111111111111111111111111111111',
      slippageBps: 50,
    });

    expect(result.routeSummary).toEqual(routeSummary);
    expect(result.amountOut).toBe('2000000000000000000');
    expect(result.priceImpact).toBe('0.10');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/bsc/api/v1/routes?');
    expect(url).toContain('amountIn=1000000000000000000');
    expect(url).toContain('slippageTolerance=50');
    expect((init.headers as Record<string, string>)['X-Client-Id']).toBe('nexter');
    expect(calls.record).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'kyberswap', status: 200 }),
    );
  });

  it('builds calldata with the exact route summary', async () => {
    const calls = fakeCalls();
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        code: 0,
        data: {
          data: '0x12345678',
          routerAddress: '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5',
          amountIn: routeSummary.amountIn,
          amountOut: routeSummary.amountOut,
          transactionValue: '0',
          gas: '120000',
          gasUsd: '0.05',
        },
      }),
    );
    const client = new KyberSwapClient(calls, fetchMock as unknown as typeof fetch);

    const result = await client.buildRoute({
      chain: 'bsc',
      routeSummary,
      sender: '0x1111111111111111111111111111111111111111',
      recipient: '0x1111111111111111111111111111111111111111',
      slippageBps: 50,
      deadline: 1_800_000_000,
    });

    expect(result.data).toBe('0x12345678');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.routeSummary).toEqual(routeSummary);
    expect(body.sender).toBe('0x1111111111111111111111111111111111111111');
    expect(body.slippageTolerance).toBe(50);
    expect(body.source).toBe('nexter');
  });

  it('retries a 429 and surfaces provider errors without raw bodies', async () => {
    const calls = fakeCalls();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ message: 'rate limited' }, 429))
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          data: {
            routeSummary,
            routerAddress: '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5',
          },
        }),
      );
    const client = new KyberSwapClient(calls, fetchMock as unknown as typeof fetch);

    const result = await client.getRoutes({
      chain: 'bsc',
      tokenIn: routeSummary.tokenIn,
      tokenOut: routeSummary.tokenOut,
      amountInBase: routeSummary.amountIn,
      slippageBps: 50,
    });

    expect(result.routeSummary).toEqual(routeSummary);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const failing = new KyberSwapClient(
      calls,
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ code: 4001, message: 'bad route' }, 200),
        ) as unknown as typeof fetch,
    );
    await expect(
      failing.getRoutes({
        chain: 'bsc',
        tokenIn: routeSummary.tokenIn,
        tokenOut: routeSummary.tokenOut,
        amountInBase: routeSummary.amountIn,
        slippageBps: 50,
      }),
    ).rejects.toMatchObject({ code: 'SWAP_PROVIDER_ERROR', message: 'bad route' });
  });

  it('rejects oversized provider responses', async () => {
    const client = new KyberSwapClient(
      fakeCalls(),
      vi.fn().mockResolvedValue(
        new Response('x'.repeat(2_000_001), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ) as unknown as typeof fetch,
    );

    await expect(
      client.getRoutes({
        chain: 'bsc',
        tokenIn: routeSummary.tokenIn,
        tokenOut: routeSummary.tokenOut,
        amountInBase: routeSummary.amountIn,
        slippageBps: 50,
      }),
    ).rejects.toMatchObject({ code: 'SWAP_PROVIDER_ERROR', status: 502 });
  });

  it('rejects incomplete provider responses', async () => {
    const client = new KyberSwapClient(
      fakeCalls(),
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ code: 0, data: { routeSummary } }),
        ) as unknown as typeof fetch,
    );

    await expect(
      client.getRoutes({
        chain: 'bsc',
        tokenIn: routeSummary.tokenIn,
        tokenOut: routeSummary.tokenOut,
        amountInBase: routeSummary.amountIn,
        slippageBps: 50,
      }),
    ).rejects.toBeInstanceOf(KyberApiError);
  });
});
