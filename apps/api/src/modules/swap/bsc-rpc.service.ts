import { Injectable, Logger } from '@nestjs/common';
import { env } from '../../shared/config/env';

export interface SimulationResult {
  success: boolean;
  revertReason: string | null;
  gasEstimate: string | null;
  chainId: number | null;
}

export interface RpcTransaction {
  hash: string;
  from: string;
  to: string | null;
  input: string;
  value: string;
  nonce: number | null;
  blockNumber: number | null;
}

export interface RpcLog {
  address: string;
  topics: string[];
  data: string;
}

export interface RpcReceipt {
  status: boolean;
  blockNumber: number;
  blockHash: string;
  gasUsed: string;
  effectiveGasPrice: string | null;
  logs: RpcLog[];
}

export interface RpcBlock {
  number: number;
  timestamp: number;
  hash: string;
}

interface RpcResponse {
  result?: unknown;
  error?: { code?: unknown; message?: unknown };
}

function hexToNumber(value: unknown): number | null {
  if (typeof value !== 'string' || !/^0x[0-9a-f]+$/i.test(value)) return null;
  const parsed = Number.parseInt(value, 16);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function message(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, 500) : 'RPC error';
}

function padAddress(address: string): string {
  return address.toLowerCase().replace(/^0x/, '').padStart(64, '0');
}

export function padUint(value: string): string {
  return BigInt(value).toString(16).padStart(64, '0');
}

function hexToBigInt(value: unknown): string | null {
  if (typeof value !== 'string' || !/^0x[0-9a-f]+$/i.test(value)) return null;

  try {
    return BigInt(value).toString();
  } catch {
    return null;
  }
}

@Injectable()
export class BscRpcService {
  private readonly logger = new Logger(BscRpcService.name);
  private readonly rpcUrl = env.BSC_RPC_URL;
  private readonly fetchImpl: typeof fetch;

  constructor(fetchImpl?: typeof fetch) {
    this.fetchImpl = fetchImpl ?? fetch;
  }

  get configured(): boolean {
    return Boolean(this.rpcUrl);
  }

  async getErc20Allowance(token: string, owner: string, spender: string): Promise<string | null> {
    if (!this.rpcUrl) return null;
    const data = `0xdd62ed3e${padAddress(owner)}${padAddress(spender)}`;
    const result = await this.call('eth_call', [{ from: owner, to: token, data }, 'latest']);
    return hexToBigInt(result);
  }

  async getErc20Balance(token: string, owner: string): Promise<string | null> {
    if (!this.rpcUrl) return null;
    const data = `0x70a08231${padAddress(owner)}`;
    const result = await this.call('eth_call', [{ from: owner, to: token, data }, 'latest']);
    return hexToBigInt(result);
  }

  async getNativeBalance(owner: string): Promise<string | null> {
    if (!this.rpcUrl) return null;
    const result = await this.call('eth_getBalance', [owner, 'latest']);
    return hexToBigInt(result);
  }

  async getTransactionByHash(hash: string): Promise<RpcTransaction | null> {
    if (!this.rpcUrl) return null;
    const result = await this.call('eth_getTransactionByHash', [hash]);

    if (!result || typeof result !== 'object') return null;
    const tx = result as Record<string, unknown>;

    if (
      typeof tx.hash !== 'string' ||
      typeof tx.from !== 'string' ||
      typeof tx.input !== 'string'
    ) {
      return null;
    }

    return {
      hash: tx.hash,
      from: tx.from,
      to: typeof tx.to === 'string' ? tx.to : null,
      input: tx.input,
      value: typeof tx.value === 'string' ? tx.value : '0x0',
      nonce: hexToNumber(tx.nonce),
      blockNumber: hexToNumber(tx.blockNumber),
    };
  }

  async getTransactionReceipt(hash: string): Promise<RpcReceipt | null> {
    if (!this.rpcUrl) return null;
    const result = await this.call('eth_getTransactionReceipt', [hash]);

    if (!result || typeof result !== 'object') return null;
    const receipt = result as Record<string, unknown>;
    const status = receipt.status === '0x1' ? true : receipt.status === '0x0' ? false : null;
    const blockNumber = hexToNumber(receipt.blockNumber);

    if (status === null || blockNumber === null) return null;

    const logs = Array.isArray(receipt.logs)
      ? receipt.logs.flatMap((entry) => {
          if (!entry || typeof entry !== 'object') return [];
          const log = entry as Record<string, unknown>;

          if (
            typeof log.address !== 'string' ||
            typeof log.data !== 'string' ||
            !Array.isArray(log.topics)
          ) {
            return [];
          }

          const topics = log.topics.filter((topic): topic is string => typeof topic === 'string');

          if (topics.length !== log.topics.length) return [];

          return [{ address: log.address, topics, data: log.data }];
        })
      : [];

    return {
      status,
      blockNumber,
      blockHash: typeof receipt.blockHash === 'string' ? receipt.blockHash : '',
      gasUsed: hexToBigInt(receipt.gasUsed) ?? '0',
      effectiveGasPrice:
        hexToBigInt(receipt.effectiveGasPrice) ?? hexToBigInt(receipt.gasPrice) ?? null,
      logs,
    };
  }

  async getBlockNumber(): Promise<number | null> {
    if (!this.rpcUrl) return null;
    return hexToNumber(await this.call('eth_blockNumber', []));
  }

  async getTransactionCount(owner: string): Promise<number | null> {
    if (!this.rpcUrl) return null;
    return hexToNumber(await this.call('eth_getTransactionCount', [owner, 'latest']));
  }

  async getBlock(blockNumber: number): Promise<RpcBlock | null> {
    if (!this.rpcUrl) return null;
    const result = await this.call('eth_getBlockByNumber', [
      `0x${blockNumber.toString(16)}`,
      false,
    ]);

    if (!result || typeof result !== 'object') return null;
    const block = result as Record<string, unknown>;
    const number = hexToNumber(block.number);
    const timestamp = hexToNumber(block.timestamp);

    if (number === null || timestamp === null) return null;

    return {
      number,
      timestamp,
      hash: typeof block.hash === 'string' ? block.hash : '',
    };
  }

  async simulate(input: {
    from: string;
    to: string;
    data: string;
    value: string;
  }): Promise<SimulationResult> {
    if (!this.rpcUrl) {
      return {
        success: false,
        revertReason: 'BSC_RPC_URL is not configured',
        gasEstimate: null,
        chainId: null,
      };
    }

    const chainHex = await this.call('eth_chainId', []);
    const chainId = hexToNumber(chainHex);

    if (chainId !== 56) {
      return {
        success: false,
        revertReason: `RPC chain id is ${chainId ?? 'unknown'}, expected 56`,
        gasEstimate: null,
        chainId,
      };
    }

    const code = await this.call('eth_getCode', [input.to, 'latest']);

    if (typeof code !== 'string' || code === '0x') {
      return {
        success: false,
        revertReason: 'Router has no contract code on BSC',
        gasEstimate: null,
        chainId,
      };
    }

    if (!/^\d+$/.test(input.value) || input.value.length > 78) {
      return {
        success: false,
        revertReason: 'Transaction value is not a bounded integer',
        gasEstimate: null,
        chainId,
      };
    }

    const transaction = {
      from: input.from,
      to: input.to,
      data: input.data,
      value: `0x${BigInt(input.value).toString(16)}`,
    };

    try {
      await this.call('eth_call', [transaction, 'latest']);
    } catch (error) {
      return {
        success: false,
        revertReason: error instanceof Error ? error.message : 'Simulation reverted',
        gasEstimate: null,
        chainId,
      };
    }

    try {
      const gasHex = await this.call('eth_estimateGas', [transaction]);
      const gasEstimate = hexToNumber(gasHex);

      return {
        success: true,
        revertReason: null,
        gasEstimate: gasEstimate === null ? null : String(gasEstimate),
        chainId,
      };
    } catch (error) {
      return {
        success: false,
        revertReason: error instanceof Error ? error.message : 'Gas estimation failed',
        gasEstimate: null,
        chainId,
      };
    }
  }

  private async call(method: string, params: unknown[]): Promise<unknown> {
    try {
      const response = await this.fetchImpl(this.rpcUrl as string, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(10_000),
      });
      const body = (await response.json()) as RpcResponse;

      if (!response.ok || body.error) {
        throw new Error(message(body.error?.message ?? `RPC HTTP ${response.status}`));
      }

      return body.result;
    } catch (error) {
      this.logger.warn(
        `BSC RPC ${method} failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      throw error;
    }
  }
}
