import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { PortfolioAssetDetail } from '@nexter/contracts';
import { CurrentAuth } from '../auth/current-auth.decorator';
import type { AuthContext } from '../auth/auth.types';
import { PortfolioService } from './portfolio.service';

@ApiTags('accounting')
@Controller('portfolio')
export class PortfolioController {
  constructor(private readonly portfolio: PortfolioService) {}

  @Get('assets/:assetId')
  assetDetail(
    @CurrentAuth() auth: AuthContext,
    @Param('assetId', new ParseUUIDPipe()) assetId: string,
  ): Promise<PortfolioAssetDetail> {
    return this.portfolio.assetDetail(auth.user.id, assetId);
  }
}
