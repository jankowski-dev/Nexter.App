import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { SystemStatus } from '@nexter/contracts';
import { CurrentAuth } from '../auth/current-auth.decorator';
import type { AuthContext } from '../auth/auth.types';
import { SystemService } from './system.service';

@ApiTags('system')
@Controller('settings')
export class SystemController {
  constructor(private readonly system: SystemService) {}

  @Get('system-status')
  status(@CurrentAuth() auth: AuthContext): Promise<SystemStatus> {
    return this.system.status(auth.user.id);
  }
}
