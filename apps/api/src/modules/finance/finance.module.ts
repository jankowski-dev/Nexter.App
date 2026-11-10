import { Module } from '@nestjs/common';
import { FinanceImportService } from './finance-import.service';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';

@Module({
  controllers: [FinanceController],
  providers: [FinanceService, FinanceImportService],
})
export class FinanceModule {}
