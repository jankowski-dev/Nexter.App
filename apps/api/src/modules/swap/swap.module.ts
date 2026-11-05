import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { ApprovalService } from './approval.service';
import { BscRpcService } from './bsc-rpc.service';
import { ExternalApiCallService } from './external-api-call.service';
import { KyberSwapClient } from './kyber-swap.client';
import { SwapController } from './swap.controller';
import { SwapService } from './swap.service';
import { SwapTrackingService } from './swap-tracking.service';

@Module({
  imports: [AccountingModule],
  controllers: [SwapController],
  providers: [
    SwapService,
    ApprovalService,
    SwapTrackingService,
    ExternalApiCallService,
    {
      provide: KyberSwapClient,
      useFactory: (apiCalls: ExternalApiCallService) => new KyberSwapClient(apiCalls),
      inject: [ExternalApiCallService],
    },
    {
      provide: BscRpcService,
      useFactory: () => new BscRpcService(),
    },
  ],
})
export class SwapModule {}
