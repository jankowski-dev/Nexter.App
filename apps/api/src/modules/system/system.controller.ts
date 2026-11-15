import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { DataQualityReport, SystemStatus } from '@nexter/contracts';
import { CurrentAuth } from '../auth/current-auth.decorator';
import type { AuthContext } from '../auth/auth.types';
import { DataQualityService } from './data-quality.service';
import { SystemService } from './system.service';

@ApiTags('system')
@Controller('settings')
export class SystemController {
  constructor(
    private readonly system: SystemService,
    private readonly dataQuality: DataQualityService,
  ) {}

  @Get('system-status')
  status(@CurrentAuth() auth: AuthContext): Promise<SystemStatus> {
    return this.system.status(auth.user.id);
  }

  @Get('data-quality')
  quality(@CurrentAuth() auth: AuthContext): Promise<DataQualityReport> {
    return this.dataQuality.report(auth.user.id);
  }
}
