import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { MarketDataCoreModule } from '../market-data/market-data-core.module';
import { AiDataService } from './ai-data.service';
import { AiLabService } from './ai-lab.service';
import { AiTradingController } from './ai-trading.controller';
import { AiTradingService } from './ai-trading.service';

@Module({
  imports: [MarketDataCoreModule, AiModule],
  controllers: [AiTradingController],
  providers: [AiTradingService, AiDataService, AiLabService],
})
export class AiTradingModule {}
