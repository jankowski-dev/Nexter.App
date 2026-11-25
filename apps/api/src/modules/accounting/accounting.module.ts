import { Module } from '@nestjs/common';
import { MarketDataCoreModule } from '../market-data/market-data-core.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AccountingBootstrapService } from './accounting-bootstrap.service';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';
import { DashboardController } from './dashboard.controller';
import { ExportController } from './export.controller';
import { ExportService } from './export.service';
import { FifoService } from './fifo.service';
import { LedgerService } from './ledger.service';
import { PortfolioController } from './portfolio.controller';
import { PortfolioService } from './portfolio.service';
import { PortfolioSnapshotService } from './portfolio-snapshot.service';
import { PositionsController } from './positions.controller';
import { PricingService } from './pricing.service';
import { PricesController } from './prices.controller';
import { ReportingService } from './reporting.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { TradeGroupsController } from './trade-groups.controller';
import { TradeGroupsService } from './trade-groups.service';
import { TradeIntentService } from './trade-intent.service';
import { TradePolicyService } from './trade-policy.service';
import { TransactionsController } from './transactions.controller';

@Module({
  imports: [MarketDataCoreModule, NotificationsModule],
  controllers: [
    AccountsController,
    AssetsController,
    DashboardController,
    ExportController,
    PortfolioController,
    PositionsController,
    PricesController,
    ReportsController,
    TradeGroupsController,
    TransactionsController,
  ],
  providers: [
    AccountingBootstrapService,
    AccountsService,
    AssetsService,
    ExportService,
    FifoService,
    LedgerService,
    PortfolioSnapshotService,
    PortfolioService,
    PricingService,
    ReportingService,
    ReportsService,
    TradeGroupsService,
    TradeIntentService,
    TradePolicyService,
  ],
  exports: [
    AccountingBootstrapService,
    AccountsService,
    AssetsService,
    LedgerService,
    PricingService,
    TradeIntentService,
    TradePolicyService,
    TradeGroupsService,
  ],
})
export class AccountingModule {}
