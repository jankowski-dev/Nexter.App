import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { ImportsController } from './imports.controller';
import { NotionImportService } from './notion-import.service';

@Module({
  imports: [AccountingModule],
  controllers: [ImportsController],
  providers: [NotionImportService],
  exports: [NotionImportService],
})
export class ImportsModule {}
