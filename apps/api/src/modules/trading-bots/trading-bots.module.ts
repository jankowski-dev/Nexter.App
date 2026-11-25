import { Module } from '@nestjs/common';
import { MarketDataCoreModule } from '../market-data/market-data-core.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SettingsModule } from '../settings/settings.module';
import { BotRunnerService } from './bot-runner.service';
import { BotTelemetryService } from './bot-telemetry.service';
import { TradingBotsController } from './trading-bots.controller';
import { TradingBotsService } from './trading-bots.service';

@Module({
  imports: [MarketDataCoreModule, NotificationsModule, SettingsModule],
  controllers: [TradingBotsController],
  providers: [TradingBotsService, BotRunnerService, BotTelemetryService],
  exports: [TradingBotsService],
})
export class TradingBotsModule {}
