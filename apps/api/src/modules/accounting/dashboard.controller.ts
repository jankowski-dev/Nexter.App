import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { DashboardSummary } from '@nexter/contracts';
import { CurrentAuth } from '../auth/current-auth.decorator';
import type { AuthContext } from '../auth/auth.types';
import { ReportingService } from './reporting.service';

@ApiTags('accounting')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly reporting: ReportingService) {}

  @Get('summary')
  summary(@CurrentAuth() auth: AuthContext): Promise<DashboardSummary> {
    return this.reporting.dashboard(auth.user.id);
  }
}
