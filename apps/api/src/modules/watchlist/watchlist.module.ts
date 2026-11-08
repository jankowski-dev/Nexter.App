import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { MarketDataModule } from '../market-data/market-data.module';
import { WatchlistController } from './watchlist.controller';
import { WatchlistService } from './watchlist.service';

@Module({
  imports: [AccountingModule, MarketDataModule],
  controllers: [WatchlistController],
  providers: [WatchlistService],
})
export class WatchlistModule {}
