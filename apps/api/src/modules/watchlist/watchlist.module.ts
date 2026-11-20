import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { MarketDataModule } from '../market-data/market-data.module';
import { SwapModule } from '../swap/swap.module';
import { WatchlistController } from './watchlist.controller';
import { WatchlistService } from './watchlist.service';

@Module({
  imports: [AccountingModule, MarketDataModule, SwapModule],
  controllers: [WatchlistController],
  providers: [WatchlistService],
})
export class WatchlistModule {}
