import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { MarketDataCoreModule } from '../market-data/market-data-core.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrderProtectionRunnerService } from './order-protection-runner.service';
import { PendingOrdersController } from './pending-orders.controller';
import { PendingOrdersService } from './pending-orders.service';

@Module({
  imports: [AccountingModule, MarketDataCoreModule, NotificationsModule],
  controllers: [PendingOrdersController],
  providers: [PendingOrdersService, OrderProtectionRunnerService],
})
export class PendingOrdersModule {}
