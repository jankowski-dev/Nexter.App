import { Module } from '@nestjs/common';
import { MarketDataCoreModule } from '../market-data/market-data-core.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { BotRunnerService } from './bot-runner.service';
import { TradingBotsController } from './trading-bots.controller';
import { TradingBotsService } from './trading-bots.service';

@Module({
  imports: [MarketDataCoreModule, NotificationsModule],
  controllers: [TradingBotsController],
  providers: [TradingBotsService, BotRunnerService],
})
export class TradingBotsModule {}
