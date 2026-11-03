import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { assets, chains, type Asset, type Database, type DbExecutor } from '@nexter/db';
import type { Asset as AssetContract } from '@nexter/contracts';
import { DB } from '../../shared/db/db.module';

@Injectable()
export class AssetsService {
  constructor(@Inject(DB) private readonly db: Database) {}

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

  async require(assetId: string, executor: DbExecutor = this.db): Promise<Asset> {
    const [asset] = await executor.select().from(assets).where(eq(assets.id, assetId)).limit(1);

    if (!asset) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Asset not found' });
    }

    return asset;
  }
}
