import { Injectable, Logger } from '@nestjs/common';
import { env } from '../../shared/config/env';

export interface SimulationResult {
  success: boolean;
  revertReason: string | null;
  gasEstimate: string | null;
  chainId: number | null;
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
