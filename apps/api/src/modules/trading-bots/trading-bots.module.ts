import { Module } from '@nestjs/common';
import { MarketDataCoreModule } from '../market-data/market-data-core.module';
import { BotRunnerService } from './bot-runner.service';
import { TradingBotsController } from './trading-bots.controller';
import { TradingBotsService } from './trading-bots.service';

@Module({
  imports: [MarketDataCoreModule],
  controllers: [TradingBotsController],
  providers: [TradingBotsService, BotRunnerService],
})
export class TradingBotsModule {}
