import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { SwapModule } from '../swap/swap.module';
import { AssetLogoBackfillService } from './asset-logo-backfill.service';
import { MarketDataCoreModule } from './market-data-core.module';
import { SettingsModule } from '../settings/settings.module';
import { MarketDataService } from './market-data.service';
import { MarketTickerController } from './market-ticker.controller';

@Module({
  imports: [AccountingModule, SwapModule, MarketDataCoreModule, SettingsModule],
  controllers: [MarketTickerController],
  providers: [AssetLogoBackfillService, MarketDataService],
  exports: [MarketDataService],
})
export class MarketDataModule {}
