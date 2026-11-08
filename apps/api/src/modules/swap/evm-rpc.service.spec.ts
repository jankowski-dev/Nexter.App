import { describe, expect, it, vi } from 'vitest';
import { encodeAbiParameters } from 'viem';
import { EvmRpcService } from './evm-rpc.service';
import { env } from '../../shared/config/env';

env.BSC_RPC_URL = 'http://rpc.test';

function rpcResponse(result: unknown, status = 200): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('EvmRpcService', () => {
  it('simulates on BSC after checking chain id and router code', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(rpcResponse('0x38'))
      .mockResolvedValueOnce(rpcResponse('0x6080'))
      .mockResolvedValueOnce(rpcResponse('0x'))
      .mockResolvedValueOnce(rpcResponse('0x1d4c0'));
    const service = new EvmRpcService(fetchMock as unknown as typeof fetch);

    const result = await service.simulate({
      chain: 'bsc',
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

  it('reads ERC-20 name, symbol and decimals', async () => {
    const name = encodeAbiParameters([{ type: 'string' }], ['Test Token']);
    const symbol = encodeAbiParameters([{ type: 'string' }], ['TST']);
    const decimals = encodeAbiParameters([{ type: 'uint8' }], [18]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(rpcResponse('0x38'))
      .mockResolvedValueOnce(rpcResponse(name))
      .mockResolvedValueOnce(rpcResponse(symbol))
      .mockResolvedValueOnce(rpcResponse(decimals));
    const service = new EvmRpcService(fetchMock as unknown as typeof fetch);

    await expect(
      service.getErc20Metadata('bsc', '0x1111111111111111111111111111111111111111'),
    ).resolves.toEqual({
      name: 'Test Token',
      symbol: 'TST',
      decimals: 18,
    });
  });

  it('rejects a non-BSC RPC chain', async () => {
    const service = new EvmRpcService(
      vi.fn().mockResolvedValue(rpcResponse('0x1')) as unknown as typeof fetch,
    );

    const result = await service.simulate({
      chain: 'bsc',
      from: '0x1111111111111111111111111111111111111111',
      to: '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5',
      data: '0x12345678',
      value: '0',
    });

    expect(result.success).toBe(false);
    expect(result.revertReason).toContain('expected 56');
  });

  it('reads gas price and finds a same-nonce replacement in recent blocks', async () => {
    const tx = {
      hash: `0x${'a'.repeat(64)}`,
      from: '0x1111111111111111111111111111111111111111',
      to: '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5',
      input: '0x12345678',
      value: '0x0',
      nonce: '0x7',
      blockNumber: '0x64',
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(rpcResponse('0x38'))
      .mockResolvedValueOnce(rpcResponse('0x3b9aca00'))
      .mockResolvedValueOnce(rpcResponse('0x64'))
      .mockResolvedValueOnce(rpcResponse({ number: '0x64', transactions: [tx] }));
    const service = new EvmRpcService(fetchMock as unknown as typeof fetch);

    await expect(service.getGasPrice('bsc')).resolves.toBe('1000000000');
    await expect(
      service.findTransactionByNonce('bsc', '0x1111111111111111111111111111111111111111', 7, 10),
    ).resolves.toMatchObject({ hash: tx.hash, nonce: 7 });
  });

  it('finds matching transactions by sender, router, calldata and value', async () => {
    const match = {
      hash: `0x${'b'.repeat(64)}`,
      from: '0x1111111111111111111111111111111111111111',
      to: '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5',
      input: '0x12345678',
      value: '0x0',
      nonce: '0x8',
      blockNumber: '0x64',
    };
    const wrongValue = {
      ...match,
      hash: `0x${'c'.repeat(64)}`,
      value: '0x1',
      nonce: '0x9',
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(rpcResponse('0x38'))
      .mockResolvedValueOnce(rpcResponse('0x64'))
      .mockResolvedValueOnce(rpcResponse({ number: '0x64', transactions: [wrongValue, match] }));
    const service = new EvmRpcService(fetchMock as unknown as typeof fetch);

    const matches = await service.findMatchingTransactions({
      chain: 'bsc',
      owner: '0x1111111111111111111111111111111111111111',
      router: '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5',
      calldata: '0x12345678',
      value: '0',
      lookbackBlocks: 0,
    });

    expect(matches.map((item) => item.hash)).toEqual([match.hash]);
  });

  it('does not adopt content matches older than the submission bound', async () => {
    const tx = {
      hash: `0x${'d'.repeat(64)}`,
      from: '0x1111111111111111111111111111111111111111',
      to: '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5',
      input: '0x12345678',
      value: '0x0',
      nonce: '0x8',
      blockNumber: '0x64',
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(rpcResponse('0x38'))
      .mockResolvedValueOnce(rpcResponse('0x64'))
      .mockResolvedValueOnce(
        rpcResponse({ number: '0x64', timestamp: '0x64', transactions: [tx] }),
      );
    const service = new EvmRpcService(fetchMock as unknown as typeof fetch);

    const matches = await service.findMatchingTransactions({
      chain: 'bsc',
      owner: '0x1111111111111111111111111111111111111111',
      router: '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5',
      calldata: '0x12345678',
      value: '0',
      lookbackBlocks: 0,
      sinceTimestamp: 200,
    });

    expect(matches).toEqual([]);
  });

  it('uses the Ethereum RPC and rejects a chain id mismatch', async () => {
    env.ETHEREUM_RPC_URL = 'http://eth.test';

    try {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(rpcResponse('0x1'))
        .mockResolvedValueOnce(rpcResponse('0x0'));
      const service = new EvmRpcService(fetchMock as unknown as typeof fetch);

      expect(service.configuredFor('ethereum')).toBe(true);
      await expect(
        service.getNativeBalance('ethereum', '0x1111111111111111111111111111111111111111'),
      ).resolves.toBe('0');
      expect(fetchMock).toHaveBeenCalledTimes(2);

      const wrongChain = new EvmRpcService(
        vi.fn().mockResolvedValue(rpcResponse('0x38')) as unknown as typeof fetch,
      );
      await expect(wrongChain.getBlockNumber('ethereum')).rejects.toThrow('expected 1');
    } finally {
      env.ETHEREUM_RPC_URL = undefined;
    }
  });

  it('reads transfer logs and full block transactions', async () => {
    const token = '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d';
    const topic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
    const topicAddress = `0x${'1'.repeat(64)}`;
    const log = {
      address: token,
      topics: [topic, topicAddress, topicAddress],
      data: `0x${'0'.repeat(63)}1`,
      transactionHash: `0x${'2'.repeat(64)}`,
      logIndex: '0x0',
      blockNumber: '0x64',
      blockHash: `0x${'3'.repeat(64)}`,
    };
    const tx = {
      hash: `0x${'4'.repeat(64)}`,
      from: '0x1111111111111111111111111111111111111111',
      to: token,
      input: '0x12345678',
      value: '0x1',
      nonce: '0x7',
      blockNumber: '0x64',
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(rpcResponse('0x38'))
      .mockResolvedValueOnce(rpcResponse([log]))
      .mockResolvedValueOnce(rpcResponse({ number: '0x64', transactions: [tx] }));
    const service = new EvmRpcService(fetchMock as unknown as typeof fetch);

    const logs = await service.getLogs('bsc', {
      fromBlock: 100,
      toBlock: 100,
      address: [token],
      topics: [topic],
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      address: token,
      transactionHash: log.transactionHash,
      logIndex: 0,
      blockNumber: 100,
    });

    const transactions = await service.getBlockTransactions('bsc', 100);
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({ hash: tx.hash, nonce: 7, value: '0x1' });
  });

  it('reports a missing contract and a reverted call', async () => {
    const missing = new EvmRpcService(
      vi
        .fn()
        .mockResolvedValueOnce(rpcResponse('0x38'))
        .mockResolvedValueOnce(rpcResponse('0x')) as unknown as typeof fetch,
    );
    const missingResult = await missing.simulate({
      chain: 'bsc',
      from: '0x1111111111111111111111111111111111111111',
      to: '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5',
      data: '0x12345678',
      value: '0',
    });
    expect(missingResult.success).toBe(false);
    expect(missingResult.revertReason).toContain('no contract code');

    const reverted = new EvmRpcService(
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
      chain: 'bsc',
      from: '0x1111111111111111111111111111111111111111',
      to: '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5',
      data: '0x12345678',
      value: '0',
    });
    expect(revertedResult.success).toBe(false);
    expect(revertedResult.revertReason).toContain('execution reverted');
  });
});
