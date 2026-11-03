import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Position, PositionsResponse } from '@nexter/contracts';
import { CurrentAuth } from '../auth/current-auth.decorator';
import type { AuthContext } from '../auth/auth.types';
import { ReportingService } from './reporting.service';

@ApiTags('accounting')
@Controller('positions')
export class PositionsController {
  constructor(private readonly reporting: ReportingService) {}

  @Get()
  list(@CurrentAuth() auth: AuthContext): Promise<PositionsResponse> {
    return this.reporting.positions(auth.user.id);
  }

  @Get(':assetId')
  get(
    @CurrentAuth() auth: AuthContext,
    @Param('assetId', new ParseUUIDPipe()) assetId: string,
  ): Promise<Position> {
    return this.reporting.position(auth.user.id, assetId);
  }
}
