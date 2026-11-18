import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { MarketDataCoreModule } from '../market-data/market-data-core.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SettingsModule } from '../settings/settings.module';
import { AutomationController } from './automation.controller';
import { AutomationEvaluatorService } from './automation-evaluator.service';
import { AutomationRunnerService } from './automation-runner.service';
import { AutomationService } from './automation.service';

@Module({
  imports: [AccountingModule, MarketDataCoreModule, NotificationsModule, SettingsModule],
  controllers: [AutomationController],
  providers: [AutomationService, AutomationEvaluatorService, AutomationRunnerService],
})
export class AutomationModule {}
