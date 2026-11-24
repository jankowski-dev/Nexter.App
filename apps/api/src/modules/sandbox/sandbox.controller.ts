import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SANDBOX_ENABLED, SANDBOX_VERSION, type SandboxStatus } from './sandbox.types';

@ApiTags('sandbox')
@Controller('sandbox')
export class SandboxController {
  constructor(@Inject(SANDBOX_ENABLED) private readonly enabled: boolean) {}

  @Get('status')
  status(): SandboxStatus {
    return { enabled: this.enabled, version: SANDBOX_VERSION };
  }
}
