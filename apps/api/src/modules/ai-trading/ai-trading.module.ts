import { Module } from '@nestjs/common';
import { MarketDataCoreModule } from '../market-data/market-data-core.module';
import { AiDataService } from './ai-data.service';
import { AiTradingController } from './ai-trading.controller';
import { AiTradingService } from './ai-trading.service';

@Module({
  imports: [MarketDataCoreModule],
  controllers: [AiTradingController],
  providers: [AiTradingService, AiDataService],
})
export class AiTradingModule {}
