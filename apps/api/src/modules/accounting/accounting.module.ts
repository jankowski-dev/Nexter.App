import { Module } from '@nestjs/common';
import { AccountingBootstrapService } from './accounting-bootstrap.service';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';
import { DashboardController } from './dashboard.controller';
import { FifoService } from './fifo.service';
import { LedgerService } from './ledger.service';
import { PositionsController } from './positions.controller';
import { PricingService } from './pricing.service';
import { PricesController } from './prices.controller';
import { ReportingService } from './reporting.service';
import { TransactionsController } from './transactions.controller';

@Module({
  controllers: [
    AccountsController,
    AssetsController,
    DashboardController,
    PositionsController,
    PricesController,
    TransactionsController,
  ],
  providers: [
    AccountingBootstrapService,
    AccountsService,
    AssetsService,
    FifoService,
    LedgerService,
    PricingService,
    ReportingService,
  ],
  exports: [AccountingBootstrapService],
})
export class AccountingModule {}
