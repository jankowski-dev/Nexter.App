import { Module } from '@nestjs/common';
import { MarketDataCoreModule } from '../market-data/market-data-core.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { BacktestController } from './backtest.controller';
import { BacktestReportService } from './backtest/backtest-report.service';
import { BacktestService } from './backtest/backtest.service';
import { HistoricalDataService } from './backtest/historical-data.service';
import { BotRunnerService } from './bot-runner.service';
import { TradingBotsController } from './trading-bots.controller';
import { TradingBotsService } from './trading-bots.service';

@Module({
  imports: [MarketDataCoreModule, NotificationsModule],
  controllers: [TradingBotsController, BacktestController],
  providers: [
    TradingBotsService,
    BotRunnerService,
    BacktestService,
    BacktestReportService,
    HistoricalDataService,
  ],
})
export class TradingBotsModule {}
