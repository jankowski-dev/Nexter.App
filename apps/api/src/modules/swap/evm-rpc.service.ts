import { Injectable, Logger } from '@nestjs/common';
import { env } from '../../shared/config/env';
import { getSwapChain } from './token-registry';

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
  transactionHash?: string;
  logIndex?: number;
  blockNumber?: number;
  blockHash?: string;
}

export interface RpcLogFilter {
  fromBlock: number;
  toBlock: number;
  address?: string;
  topics?: Array<string | null | string[]>;
}

export interface RpcReceipt {
  status: boolean;
  blockNumber: number;
  blockHash: string;
  transactionHash: string;
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

interface ChainRpcConfig {
  url: string | undefined;
  chainId: number;
  name: string;
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

function parseTransaction(value: unknown): RpcTransaction | null {
  if (!value || typeof value !== 'object') return null;
  const tx = value as Record<string, unknown>;

  if (typeof tx.hash !== 'string' || typeof tx.from !== 'string' || typeof tx.input !== 'string') {
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

function parseLog(value: unknown): RpcLog | null {
  if (!value || typeof value !== 'object') return null;
  const log = value as Record<string, unknown>;

  if (
    typeof log.address !== 'string' ||
    typeof log.data !== 'string' ||
    !Array.isArray(log.topics)
  ) {
    return null;
  }

  const topics = log.topics.filter((topic): topic is string => typeof topic === 'string');

  if (topics.length !== log.topics.length) return null;

  return {
    address: log.address,
    topics,
    data: log.data,
    transactionHash: typeof log.transactionHash === 'string' ? log.transactionHash : undefined,
    logIndex: hexToNumber(log.logIndex) ?? undefined,
    blockNumber: hexToNumber(log.blockNumber) ?? undefined,
    blockHash: typeof log.blockHash === 'string' ? log.blockHash : undefined,
  };
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
export class EvmRpcService {
  private readonly logger = new Logger(EvmRpcService.name);
  private readonly chainIds = new Map<string, number>();
  private readonly fetchImpl: typeof fetch;

  constructor(fetchImpl?: typeof fetch) {
    this.fetchImpl = fetchImpl ?? fetch;
  }

  get configured(): boolean {
    return Boolean(env.BSC_RPC_URL || env.ETHEREUM_RPC_URL);
  }

  configuredFor(chain: string): boolean {
    return Boolean(this.config(chain).url);
  }

  async ensureChain(chain: string): Promise<void> {
    await this.assertChain(chain);
  }

  private async assertChain(chain: string): Promise<void> {
    const config = this.config(chain);
    if (!config.url) return;

    const chainId = await this.getChainId(chain);

    if (chainId !== config.chainId) {
      throw new Error(
        `${config.name} RPC chain id is ${chainId ?? 'unknown'}, expected ${config.chainId}`,
      );
    }
  }

  private async getChainId(chain: string): Promise<number | null> {
    const cached = this.chainIds.get(chain);
    if (cached !== undefined) return cached;

    const chainId = hexToNumber(await this.call(chain, 'eth_chainId', []));
    if (chainId !== null) this.chainIds.set(chain, chainId);
    return chainId;
  }

  async getErc20Allowance(
    chain: string,
    token: string,
    owner: string,
    spender: string,
  ): Promise<string | null> {
    if (!this.configuredFor(chain)) return null;
    await this.assertChain(chain);
    const data = `0xdd62ed3e${padAddress(owner)}${padAddress(spender)}`;
    const result = await this.call(chain, 'eth_call', [{ from: owner, to: token, data }, 'latest']);
    return hexToBigInt(result);
  }

  async getErc20Balance(chain: string, token: string, owner: string): Promise<string | null> {
    if (!this.configuredFor(chain)) return null;
    await this.assertChain(chain);
    const data = `0x70a08231${padAddress(owner)}`;
    const result = await this.call(chain, 'eth_call', [{ from: owner, to: token, data }, 'latest']);
    return hexToBigInt(result);
  }

  async getNativeBalance(chain: string, owner: string): Promise<string | null> {
    if (!this.configuredFor(chain)) return null;
    await this.assertChain(chain);
    const result = await this.call(chain, 'eth_getBalance', [owner, 'latest']);
    return hexToBigInt(result);
  }

  async getTransactionByHash(chain: string, hash: string): Promise<RpcTransaction | null> {
    if (!this.configuredFor(chain)) return null;
    await this.assertChain(chain);
    return parseTransaction(await this.call(chain, 'eth_getTransactionByHash', [hash]));
  }

  async getTransactionReceipt(chain: string, hash: string): Promise<RpcReceipt | null> {
    if (!this.configuredFor(chain)) return null;
    await this.assertChain(chain);
    const result = await this.call(chain, 'eth_getTransactionReceipt', [hash]);

    if (!result || typeof result !== 'object') return null;
    const receipt = result as Record<string, unknown>;
    const statusCode = hexToNumber(receipt.status);
    const status = statusCode === 1 ? true : statusCode === 0 ? false : null;
    const blockNumber = hexToNumber(receipt.blockNumber);

    if (status === null || blockNumber === null) return null;

    const logs = Array.isArray(receipt.logs)
      ? receipt.logs.flatMap((entry) => {
          const log = parseLog(entry);
          return log ? [log] : [];
        })
      : [];

    return {
      status,
      blockNumber,
      blockHash: typeof receipt.blockHash === 'string' ? receipt.blockHash : '',
      transactionHash: typeof receipt.transactionHash === 'string' ? receipt.transactionHash : '',
      gasUsed: hexToBigInt(receipt.gasUsed) ?? '0',
      effectiveGasPrice:
        hexToBigInt(receipt.effectiveGasPrice) ?? hexToBigInt(receipt.gasPrice) ?? null,
      logs,
    };
  }

  async getBlockNumber(chain: string): Promise<number | null> {
    if (!this.configuredFor(chain)) return null;
    await this.assertChain(chain);
    return hexToNumber(await this.call(chain, 'eth_blockNumber', []));
  }

  async getTransactionCount(chain: string, owner: string): Promise<number | null> {
    if (!this.configuredFor(chain)) return null;
    await this.assertChain(chain);
    return hexToNumber(await this.call(chain, 'eth_getTransactionCount', [owner, 'latest']));
  }

  async getGasPrice(chain: string): Promise<string | null> {
    if (!this.configuredFor(chain)) return null;
    await this.assertChain(chain);
    return hexToBigInt(await this.call(chain, 'eth_gasPrice', []));
  }

  async findMatchingTransactions(input: {
    chain: string;
    owner: string;
    router: string;
    calldata: string;
    value: string;
    lookbackBlocks?: number;
    sinceTimestamp?: number;
  }): Promise<RpcTransaction[]> {
    if (!this.configuredFor(input.chain)) return [];
    await this.assertChain(input.chain);

    const latest = await this.getBlockNumber(input.chain);
    if (latest === null) return [];
    const lower = input.owner.toLowerCase();
    const router = input.router.toLowerCase();
    const calldata = input.calldata.toLowerCase();
    const lookback = input.lookbackBlocks ?? 240;
    const fromBlock = Math.max(0, latest - lookback);
    const matches: RpcTransaction[] = [];

    for (let blockNumber = latest; blockNumber >= fromBlock; blockNumber -= 1) {
      const result = await this.call(input.chain, 'eth_getBlockByNumber', [
        `0x${blockNumber.toString(16)}`,
        true,
      ]);

      if (!result || typeof result !== 'object') continue;
      const block = result as Record<string, unknown>;
      const blockTimestamp = hexToNumber(block.timestamp);

      if (input.sinceTimestamp !== undefined) {
        if (blockTimestamp === null) continue;
        if (blockTimestamp < input.sinceTimestamp) break;
      }

      const transactions = block.transactions;

      if (!Array.isArray(transactions)) continue;

      for (const raw of transactions) {
        const tx = parseTransaction(raw);

        if (!tx || tx.from.toLowerCase() !== lower || !tx.to) continue;
        if (tx.to.toLowerCase() !== router) continue;
        if (tx.input.toLowerCase() !== calldata) continue;

        try {
          if (BigInt(tx.value || '0x0') !== BigInt(input.value)) continue;
        } catch {
          continue;
        }

        matches.push(tx);
      }
    }

    return matches;
  }

  async findTransactionByNonce(
    chain: string,
    owner: string,
    nonce: number,
    lookbackBlocks = 60,
  ): Promise<RpcTransaction | null> {
    if (!this.configuredFor(chain)) return null;
    await this.assertChain(chain);

    const latest = await this.getBlockNumber(chain);
    if (latest === null) return null;
    const lower = owner.toLowerCase();
    const fromBlock = Math.max(0, latest - lookbackBlocks);

    for (let blockNumber = latest; blockNumber >= fromBlock; blockNumber -= 1) {
      const result = await this.call(chain, 'eth_getBlockByNumber', [
        `0x${blockNumber.toString(16)}`,
        true,
      ]);

      if (!result || typeof result !== 'object') continue;
      const transactions = (result as Record<string, unknown>).transactions;

      if (!Array.isArray(transactions)) continue;

      for (const raw of transactions) {
        const tx = parseTransaction(raw);

        if (tx && tx.from.toLowerCase() === lower && tx.nonce === nonce) {
          return tx;
        }
      }
    }

    return null;
  }

  async getLogs(chain: string, filter: RpcLogFilter): Promise<RpcLog[]> {
    if (!this.configuredFor(chain)) return [];
    if (filter.toBlock < filter.fromBlock) return [];
    await this.assertChain(chain);

    const payload: Record<string, unknown> = {
      fromBlock: `0x${filter.fromBlock.toString(16)}`,
      toBlock: `0x${filter.toBlock.toString(16)}`,
    };

    if (filter.address) payload.address = filter.address;
    if (filter.topics) payload.topics = filter.topics;

    const result = await this.call(chain, 'eth_getLogs', [payload]);

    if (!Array.isArray(result)) return [];

    return result.flatMap((entry) => {
      const log = parseLog(entry);
      return log ? [log] : [];
    });
  }

  async getBlockTransactions(chain: string, blockNumber: number): Promise<RpcTransaction[]> {
    if (!this.configuredFor(chain)) return [];
    await this.assertChain(chain);

    const result = await this.call(chain, 'eth_getBlockByNumber', [
      `0x${blockNumber.toString(16)}`,
      true,
    ]);

    if (!result || typeof result !== 'object') return [];
    const transactions = (result as Record<string, unknown>).transactions;

    if (!Array.isArray(transactions)) return [];

    return transactions.flatMap((entry) => {
      const tx = parseTransaction(entry);
      return tx ? [tx] : [];
    });
  }

  async getBlock(chain: string, blockNumber: number): Promise<RpcBlock | null> {
    if (!this.configuredFor(chain)) return null;
    await this.assertChain(chain);
    const result = await this.call(chain, 'eth_getBlockByNumber', [
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
    chain: string;
    from: string;
    to: string;
    data: string;
    value: string;
  }): Promise<SimulationResult> {
    const config = this.config(input.chain);

    if (!config.url) {
      return {
        success: false,
        revertReason: `${config.name} RPC is not configured`,
        gasEstimate: null,
        chainId: null,
      };
    }

    const chainId = await this.getChainId(input.chain);

    if (chainId !== config.chainId) {
      return {
        success: false,
        revertReason: `RPC chain id is ${chainId ?? 'unknown'}, expected ${config.chainId}`,
        gasEstimate: null,
        chainId,
      };
    }

    const code = await this.call(input.chain, 'eth_getCode', [input.to, 'latest']);

    if (typeof code !== 'string' || code === '0x') {
      return {
        success: false,
        revertReason: `Router has no contract code on ${config.name}`,
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
      await this.call(input.chain, 'eth_call', [transaction, 'latest']);
    } catch (error) {
      return {
        success: false,
        revertReason: error instanceof Error ? error.message : 'Simulation reverted',
        gasEstimate: null,
        chainId,
      };
    }

    try {
      const gasHex = await this.call(input.chain, 'eth_estimateGas', [transaction]);
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

  private config(chain: string): ChainRpcConfig {
    const chainConfig = getSwapChain(chain);
    return {
      url:
        chain === 'ethereum' ? env.ETHEREUM_RPC_URL : chain === 'bsc' ? env.BSC_RPC_URL : undefined,
      chainId: chainConfig?.chainId ?? 0,
      name: chainConfig?.name ?? chain,
    };
  }

  private async call(chain: string, method: string, params: unknown[]): Promise<unknown> {
    const config = this.config(chain);

    if (!config.url) {
      throw new Error(`${config.name} RPC is not configured`);
    }

    try {
      const response = await this.fetchImpl(config.url, {
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
        `${config.name} RPC ${method} failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      throw error;
    }
  }
}
