import { Module } from '@nestjs/common';
import { env } from '../../shared/config/env';
import { MarketDataCoreModule } from '../market-data/market-data-core.module';
import { SandboxController } from './sandbox.controller';
import { SandboxDataService } from './sandbox-data.service';
import { SandboxEnabledGuard } from './sandbox-enabled.guard';
import { SandboxRepository } from './sandbox.repository';
import { SandboxRunnerService } from './sandbox-runner.service';
import { SandboxRunService } from './sandbox-run.service';
import { SandboxTokensService } from './sandbox-tokens.service';
import { SANDBOX_ENABLED } from './sandbox.types';

@Module({
  imports: [MarketDataCoreModule],
  controllers: [SandboxController],
  providers: [
    SandboxRepository,
    SandboxDataService,
    SandboxTokensService,
    SandboxRunService,
    SandboxRunnerService,
    SandboxEnabledGuard,
    { provide: SANDBOX_ENABLED, useValue: env.SANDBOX_ENABLED },
  ],
  exports: [
    SandboxRepository,
    SandboxDataService,
    SandboxTokensService,
    SandboxRunService,
    SandboxRunnerService,
  ],
})
export class SandboxModule {}
