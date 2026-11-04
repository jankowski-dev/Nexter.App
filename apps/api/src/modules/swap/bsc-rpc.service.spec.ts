import { describe, expect, it, vi } from 'vitest';
import { BscRpcService } from './bsc-rpc.service';
import { env } from '../../shared/config/env';

env.BSC_RPC_URL = 'http://rpc.test';

function rpcResponse(result: unknown, status = 200): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('BscRpcService', () => {
  it('simulates on BSC after checking chain id and router code', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(rpcResponse('0x38'))
      .mockResolvedValueOnce(rpcResponse('0x6080'))
      .mockResolvedValueOnce(rpcResponse('0x'))
      .mockResolvedValueOnce(rpcResponse('0x1d4c0'));
    const service = new BscRpcService(fetchMock as unknown as typeof fetch);

    const result = await service.simulate({
      from: '0x1111111111111111111111111111111111111111',
      to: '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5',
      data: '0x12345678',
      value: '0',
    });

    expect(result).toEqual({
      success: true,
      revertReason: null,
      gasEstimate: '120000',
      chainId: 56,
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('rejects a non-BSC RPC chain', async () => {
    const service = new BscRpcService(
      vi.fn().mockResolvedValue(rpcResponse('0x1')) as unknown as typeof fetch,
    );

    const result = await service.simulate({
      from: '0x1111111111111111111111111111111111111111',
      to: '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5',
      data: '0x12345678',
      value: '0',
    });

    expect(result.success).toBe(false);
    expect(result.revertReason).toContain('expected 56');
  });

  it('reports a missing contract and a reverted call', async () => {
    const missing = new BscRpcService(
      vi
        .fn()
        .mockResolvedValueOnce(rpcResponse('0x38'))
        .mockResolvedValueOnce(rpcResponse('0x')) as unknown as typeof fetch,
    );
    const missingResult = await missing.simulate({
      from: '0x1111111111111111111111111111111111111111',
      to: '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5',
      data: '0x12345678',
      value: '0',
    });
    expect(missingResult.success).toBe(false);
    expect(missingResult.revertReason).toContain('no contract code');

    const reverted = new BscRpcService(
      vi
        .fn()
        .mockResolvedValueOnce(rpcResponse('0x38'))
        .mockResolvedValueOnce(rpcResponse('0x6080'))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: { message: 'execution reverted' } }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        ) as unknown as typeof fetch,
    );
    const revertedResult = await reverted.simulate({
      from: '0x1111111111111111111111111111111111111111',
      to: '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5',
      data: '0x12345678',
      value: '0',
    });
    expect(revertedResult.success).toBe(false);
    expect(revertedResult.revertReason).toContain('execution reverted');
  });
});
