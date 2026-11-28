import { Module } from '@nestjs/common';
import { FinanceFxRatesService } from './finance-fx-rates.service';
import { FinanceImportService } from './finance-import.service';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';

@Module({
  controllers: [FinanceController],
  providers: [FinanceService, FinanceImportService, FinanceFxRatesService],
})
export class FinanceModule {}
