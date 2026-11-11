import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { SwapModule } from '../swap/swap.module';
import { AssetLogoBackfillService } from './asset-logo-backfill.service';
import { MarketDataCoreModule } from './market-data-core.module';
import { MarketDataService } from './market-data.service';

@Module({
  imports: [AccountingModule, SwapModule, MarketDataCoreModule],
  providers: [AssetLogoBackfillService, MarketDataService],
  exports: [MarketDataService],
})
export class MarketDataModule {}
