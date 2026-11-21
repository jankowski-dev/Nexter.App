import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { MarketDataCoreModule } from '../market-data/market-data-core.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TradingBotsModule } from '../trading-bots/trading-bots.module';
import { AiCycleService } from './ai-cycle.service';
import { AiDataService } from './ai-data.service';
import { AiHealthService } from './ai-health.service';
import { AiLabService } from './ai-lab.service';
import { AiRiskService } from './ai-risk.service';
import { AiSearchService } from './ai-search.service';
import { AiSearchWorkerService } from './ai-search-worker.service';
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
    AiSearchWorkerService,
    AiHealthService,
    AiRiskService,
    AiCycleService,
  ],
})
export class AiTradingModule {}
