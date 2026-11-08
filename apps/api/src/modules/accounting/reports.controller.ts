import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { ReportsQuery, ReportsResponse } from '@nexter/contracts';
import { reportsQuerySchema } from '@nexter/contracts';
import { ZodValidationPipe } from '../../shared/validation/zod-validation.pipe';
import { CurrentAuth } from '../auth/current-auth.decorator';
import type { AuthContext } from '../auth/auth.types';
import { ReportsService } from './reports.service';

@ApiTags('accounting')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  report(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(reportsQuerySchema)) query: ReportsQuery,
  ): Promise<ReportsResponse> {
    return this.reports.report(auth.user.id, query);
  }
}
