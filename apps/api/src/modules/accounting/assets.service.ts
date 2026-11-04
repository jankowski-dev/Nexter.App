import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { assets, chains, type Asset, type Database, type DbExecutor } from '@nexter/db';
import type { Asset as AssetContract } from '@nexter/contracts';
import { AuditService } from '../../shared/audit/audit.service';
import { DB } from '../../shared/db/db.module';

@Injectable()
export class AssetsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  private toContract(row: { asset: Asset; chainCode: string }): AssetContract {
    return {
      id: row.asset.id,
      chainId: row.asset.chainId,
      chainCode: row.chainCode,
      symbol: row.asset.symbol,
      name: row.asset.name,
      decimals: row.asset.decimals,
      contractAddress: row.asset.contractAddress,
      coingeckoId: row.asset.coingeckoId,
      isStablecoin: row.asset.isStablecoin,
      isCashEquivalent: row.asset.isCashEquivalent,
      isVerified: row.asset.isVerified,
    };
  }

  async list(): Promise<AssetContract[]> {
    const rows = await this.db
      .select({ asset: assets, chainCode: chains.code })
      .from(assets)
      .innerJoin(chains, eq(assets.chainId, chains.id))
      .orderBy(chains.code, assets.symbol);

    return rows.map((row) => this.toContract(row));
  }

  async get(assetId: string): Promise<AssetContract> {
    const [row] = await this.db
      .select({ asset: assets, chainCode: chains.code })
      .from(assets)
      .innerJoin(chains, eq(assets.chainId, chains.id))
      .where(eq(assets.id, assetId))
      .limit(1);

    if (!row) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Asset not found' });
    }

    return this.toContract(row);
  }

  async ensureForSwapToken(
    chainCode: string,
    token: {
      symbol: string;
      name: string;
      address: string;
      decimals: number;
      native: boolean;
    },
    executor: DbExecutor = this.db,
    userId?: string,
  ): Promise<Asset> {
    const [chain] = await executor.select().from(chains).where(eq(chains.code, chainCode)).limit(1);

    if (!chain) {
      throw new Error(`Chain ${chainCode} is not configured`);
    }

    const [existing] = await executor
      .select()
      .from(assets)
      .where(and(eq(assets.chainId, chain.id), eq(assets.symbol, token.symbol)))
      .limit(1);

    if (existing) return existing;

    const cashEquivalent = ['USDC', 'USDT', 'BUSD', 'FDUSD'].includes(token.symbol);
    const [created] = await executor
      .insert(assets)
      .values({
        chainId: chain.id,
        symbol: token.symbol,
        name: token.name,
        contractAddress: token.native ? null : token.address.toLowerCase(),
        decimals: token.decimals,
        isStablecoin: cashEquivalent,
        isCashEquivalent: cashEquivalent,
        isVerified: true,
        sourceId: 'swap-registry',
        dataQuality: { source: 'swap-registry' },
      })
      .onConflictDoNothing({ target: [assets.chainId, assets.symbol] })
      .returning();

    if (created) {
      await this.audit.log(
        {
          userId,
          action: 'accounting.asset_created',
          entityType: 'asset',
          entityId: created.id,
          after: {
            chainCode,
            symbol: created.symbol,
            contractAddress: created.contractAddress,
            source: 'swap-registry',
          },
        },
        { executor, strict: true },
      );

      return created;
    }

    const [row] = await executor
      .select()
      .from(assets)
      .where(and(eq(assets.chainId, chain.id), eq(assets.symbol, token.symbol)))
      .limit(1);

    if (!row) {
      throw new Error(`Failed to resolve asset ${token.symbol}`);
    }

    return row;
  }

  async require(assetId: string, executor: DbExecutor = this.db): Promise<Asset> {
    const [asset] = await executor.select().from(assets).where(eq(assets.id, assetId)).limit(1);

    if (!asset) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Asset not found' });
    }

    return asset;
  }
}
