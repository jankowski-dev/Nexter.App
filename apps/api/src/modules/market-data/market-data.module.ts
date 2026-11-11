import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { SwapModule } from '../swap/swap.module';
import { AssetLogoBackfillService } from './asset-logo-backfill.service';
import { CoinGeckoClient } from './coingecko.client';
import { MarketDataService } from './market-data.service';

@Module({
  imports: [AccountingModule, SwapModule],
  providers: [AssetLogoBackfillService, CoinGeckoClient, MarketDataService],
  exports: [MarketDataService],
})
export class MarketDataModule {}
