import { Injectable, Logger } from '@nestjs/common';
import { env } from '../../shared/config/env';
import { ExternalApiCallService } from './external-api-call.service';

export interface KyberRouteRequest {
  chain: string;
  tokenIn: string;
  tokenOut: string;
  amountInBase: string;
  walletAddress?: string;
  slippageBps: number;
}

export interface KyberRouteResult {
  routeSummary: Record<string, unknown>;
  routerAddress: string;
  amountIn: string;
  amountOut: string;
  amountInUsd: string | null;
  amountOutUsd: string | null;
  gas: string | null;
  gasUsd: string | null;
  priceImpact: string | null;
}

export interface KyberBuildRequest {
  chain: string;
  routeSummary: Record<string, unknown>;
  sender: string;
  recipient: string;
  slippageBps: number;
  deadline: number;
}

export interface KyberBuildResult {
  data: string;
  routerAddress: string;
  amountIn: string;
  amountOut: string;
  transactionValue: string;
  gas: string | null;
  gasUsd: string | null;
}

export class KyberApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'KyberApiError';
  }
}

interface KyberEnvelope {
  code?: unknown;
  message?: unknown;
  data?: unknown;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function truncate(value: string, max = 500): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

@Injectable()
export class KyberSwapClient {
  private readonly logger = new Logger(KyberSwapClient.name);
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly clientId: string;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly apiCalls: ExternalApiCallService,
    fetchImpl?: typeof fetch,
  ) {
    this.apiKey = env.KYBERSWAP_API_KEY;
    this.clientId = env.KYBERSWAP_CLIENT_ID;
    this.fetchImpl = fetchImpl ?? fetch;
    this.baseUrl =
      env.KYBERSWAP_BASE_URL ??
      (this.apiKey ? 'https://api.kyberswap.com/swap' : 'https://aggregator-api.kyberswap.com');
  }

  get configured(): boolean {
    return Boolean(this.baseUrl);
  }

  async getRoutes(input: KyberRouteRequest): Promise<KyberRouteResult> {
    const params = new URLSearchParams({
      tokenIn: input.tokenIn,
      tokenOut: input.tokenOut,
      amountIn: input.amountInBase,
      saveGas: '0',
      gasInclude: '1',
      isAggregator: 'true',
      slippageTolerance: String(input.slippageBps),
    });

    if (input.walletAddress) {
      params.set('to', input.walletAddress);
    }

    const data = await this.request(
      'GET',
      `/${input.chain}/api/v1/routes?${params.toString()}`,
      undefined,
      'routes',
    );
    const routeSummary = record(data.routeSummary);
    const routerAddress = stringValue(data.routerAddress);
    const amountIn = stringValue(routeSummary.amountIn) ?? stringValue(data.amountIn);
    const amountOut = stringValue(routeSummary.amountOut) ?? stringValue(data.amountOut);

    if (!routerAddress || !amountIn || !amountOut) {
      throw new KyberApiError('SWAP_QUOTE_FAILED', 'Provider returned an incomplete route', 502);
    }

    return {
      routeSummary,
      routerAddress,
      amountIn,
      amountOut,
      amountInUsd: stringValue(routeSummary.amountInUsd),
      amountOutUsd: stringValue(routeSummary.amountOutUsd),
      gas: stringValue(routeSummary.gas),
      gasUsd: stringValue(routeSummary.gasUsd),
      priceImpact: stringValue(routeSummary.priceImpact),
    };
  }

  async buildRoute(input: KyberBuildRequest): Promise<KyberBuildResult> {
    const data = await this.request(
      'POST',
      `/${input.chain}/api/v1/route/build`,
      {
        routeSummary: input.routeSummary,
        sender: input.sender,
        recipient: input.recipient,
        slippageTolerance: input.slippageBps,
        deadline: input.deadline,
        source: this.clientId,
        enableGasEstimation: true,
      },
      'route/build',
    );
    const calldata = stringValue(data.data);
    const routerAddress = stringValue(data.routerAddress);
    const amountIn = stringValue(data.amountIn);
    const amountOut = stringValue(data.amountOut);
    const transactionValue = stringValue(data.transactionValue);

    if (!calldata || !routerAddress || !amountIn || !amountOut || transactionValue === null) {
      throw new KyberApiError('SWAP_BUILD_FAILED', 'Provider returned incomplete calldata', 502);
    }

    return {
      data: calldata,
      routerAddress,
      amountIn,
      amountOut,
      transactionValue,
      gas: stringValue(data.gas),
      gasUsd: stringValue(data.gasUsd),
    };
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    body: Record<string, unknown> | undefined,
    endpoint: string,
  ): Promise<Record<string, unknown>> {
    const started = Date.now();
    let lastError: unknown;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
          method,
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'X-Client-Id': this.clientId,
            ...(this.apiKey ? { 'X-Api-Key': this.apiKey } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(10_000),
        });
        const text = await response.text();

        if (text.length > 2_000_000) {
          await this.apiCalls.record({
            provider: 'kyberswap',
            endpoint,
            status: response.status,
            latencyMs: Date.now() - started,
            errorCode: 'RESPONSE_TOO_LARGE',
          });
          throw new KyberApiError(
            'SWAP_PROVIDER_ERROR',
            'Swap provider response is too large',
            502,
          );
        }

        let parsed: KyberEnvelope = {};

        try {
          parsed = JSON.parse(text) as KyberEnvelope;
        } catch {
          // Keep the response opaque; provider HTML must never reach logs.
        }

        const latencyMs = Date.now() - started;
        await this.apiCalls.record({
          provider: 'kyberswap',
          endpoint,
          status: response.status,
          latencyMs,
          errorCode: response.ok ? null : `HTTP_${response.status}`,
        });

        if (!response.ok) {
          const message = truncate(
            stringValue(parsed.message) ?? `KyberSwap request failed (${response.status})`,
          );

          if ((response.status === 429 || response.status >= 500) && attempt < 2) {
            await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
            continue;
          }

          throw new KyberApiError(
            response.status === 429 ? 'SWAP_RATE_LIMITED' : 'SWAP_PROVIDER_ERROR',
            message,
            response.status,
          );
        }

        const code = parsed.code;
        if (code !== undefined && code !== 0 && code !== '0') {
          throw new KyberApiError(
            'SWAP_PROVIDER_ERROR',
            truncate(stringValue(parsed.message) ?? 'KyberSwap returned an error'),
            502,
          );
        }

        const data = record(parsed.data);
        if (Object.keys(data).length === 0) {
          throw new KyberApiError('SWAP_PROVIDER_ERROR', 'KyberSwap returned no data', 502);
        }

        return data;
      } catch (error) {
        lastError = error;

        if (error instanceof KyberApiError) {
          throw error;
        }

        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
          continue;
        }
      }
    }

    await this.apiCalls.record({
      provider: 'kyberswap',
      endpoint,
      status: 0,
      latencyMs: Date.now() - started,
      errorCode: 'NETWORK_ERROR',
    });
    this.logger.warn(`KyberSwap ${endpoint} unavailable: ${String(lastError)}`);
    throw new KyberApiError('SWAP_PROVIDER_UNAVAILABLE', 'Swap provider is unavailable', 503);
  }
}
