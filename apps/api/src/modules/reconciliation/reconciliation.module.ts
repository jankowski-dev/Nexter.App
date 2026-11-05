import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { EvmRpcService } from '../swap/evm-rpc.service';
import { ReconciliationController } from './reconciliation.controller';
import { ReconciliationService } from './reconciliation.service';
import { OnchainIndexerService } from './onchain-indexer.service';

@Module({
  imports: [AccountingModule],
  controllers: [ReconciliationController],
  providers: [
    ReconciliationService,
    OnchainIndexerService,
    {
      provide: EvmRpcService,
      useFactory: () => new EvmRpcService(),
    },
  ],
})
export class ReconciliationModule {}
