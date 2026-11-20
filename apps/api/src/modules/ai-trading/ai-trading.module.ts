import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { MarketDataCoreModule } from '../market-data/market-data-core.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TradingBotsModule } from '../trading-bots/trading-bots.module';
import { AiCycleService } from './ai-cycle.service';
import { AiDataService } from './ai-data.service';
import { AiHealthService } from './ai-health.service';
import { AiLabService } from './ai-lab.service';
import { AiSearchService } from './ai-search.service';
import { AiTradingController } from './ai-trading.controller';
import { AiTradingService } from './ai-trading.service';

@Module({
  imports: [MarketDataCoreModule, AiModule, NotificationsModule, TradingBotsModule],
  controllers: [AiTradingController],
  providers: [
    AiTradingService,
    AiDataService,
    AiLabService,
    AiSearchService,
    AiHealthService,
    AiCycleService,
  ],
})
export class AiTradingModule {}
