import { Injectable, Logger } from '@nestjs/common';
import { env } from '../../shared/config/env';
import { Decimal, decimal } from '../../shared/money/decimal';

export interface DexScreenerQuote {
  priceUsd: string;
  change24hPct: string | null;
  liquidityUsd: string;
}

interface DexScreenerPair {
  chainId?: unknown;
  baseToken?: { address?: unknown };
  priceUsd?: unknown;
  priceChange?: { h24?: unknown } | null;
  liquidity?: { usd?: unknown } | null;
}

function optionalNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

@Injectable()
export class DexScreenerClient {
  private readonly logger = new Logger(DexScreenerClient.name);

  async getBestQuote(
    chain: 'bsc' | 'ethereum',
    address: string,
    minLiquidityUsd: Decimal,
  ): Promise<DexScreenerQuote | null> {
    const normalized = address.toLowerCase();
    const url = `${env.DEXSCREENER_BASE_URL.replace(/\/$/, '')}/token-pairs/v1/${chain}/${normalized}`;

    let body: unknown;

    try {
      const response = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(env.DEXSCREENER_TIMEOUT_MS),
      });

      if (!response.ok) {
        this.logger.warn(`DexScreener request failed: HTTP ${response.status}`);
        return null;
      }

      body = await response.json();
    } catch (error) {
      this.logger.warn(
        `DexScreener request failed: ${error instanceof Error ? error.name : 'unknown error'}`,
      );
      return null;
    }

    if (!Array.isArray(body)) return null;

    const candidates = (body as DexScreenerPair[])
      .filter((pair) => {
        if (!pair || typeof pair !== 'object') return false;
        if (pair.chainId !== chain) return false;
        if (typeof pair.baseToken?.address !== 'string') return false;
        if (pair.baseToken.address.toLowerCase() !== normalized) return false;
        if (typeof pair.priceUsd !== 'string' || !/^\d+(?:\.\d+)?$/.test(pair.priceUsd)) {
          return false;
        }
        if (decimal(pair.priceUsd).lte(0)) return false;
        const liquidity = optionalNumber(pair.liquidity?.usd);
        return liquidity !== null && decimal(String(liquidity)).gte(minLiquidityUsd);
      })
      .map((pair) => ({
        priceUsd: decimal(pair.priceUsd as string).toFixed(18),
        change24hPct:
          optionalNumber(pair.priceChange?.h24) === null
            ? null
            : decimal(String(optionalNumber(pair.priceChange?.h24))).toFixed(4),
        liquidityUsd: decimal(String(optionalNumber(pair.liquidity?.usd) ?? 0)).toFixed(2),
        liquidity: optionalNumber(pair.liquidity?.usd) ?? 0,
      }))
      .filter((candidate) => decimal(candidate.priceUsd).gt(0))
      .sort((left, right) => right.liquidity - left.liquidity);

    const best = candidates[0];
    if (!best) return null;

    return {
      priceUsd: best.priceUsd,
      change24hPct: best.change24hPct,
      liquidityUsd: best.liquidityUsd,
    };
  }
}
