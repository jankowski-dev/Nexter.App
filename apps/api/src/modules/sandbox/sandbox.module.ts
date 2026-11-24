import { Module } from '@nestjs/common';
import { env } from '../../shared/config/env';
import { SandboxController } from './sandbox.controller';
import { SANDBOX_ENABLED } from './sandbox.types';

@Module({
  controllers: [SandboxController],
  providers: [{ provide: SANDBOX_ENABLED, useValue: env.SANDBOX_ENABLED }],
})
export class SandboxModule {}
