import { Controller, Get, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type {
  DashboardActivePositions,
  DashboardAllocation,
  DashboardDataQuality,
  DashboardPnl,
  DashboardRecentTrades,
  DashboardSummary,
  EquityCurve,
  PortfolioSnapshot,
} from '@nexter/contracts';
import { CurrentAuth } from '../auth/current-auth.decorator';
import type { AuthContext } from '../auth/auth.types';
import { PortfolioSnapshotService } from './portfolio-snapshot.service';
import { ReportingService } from './reporting.service';

@ApiTags('accounting')
@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly reporting: ReportingService,
    private readonly snapshots: PortfolioSnapshotService,
  ) {}

  @Get('summary')
  summary(@CurrentAuth() auth: AuthContext): Promise<DashboardSummary> {
    return this.reporting.dashboard(auth.user.id);
  }

  @Get('equity-curve')
  equityCurve(@CurrentAuth() auth: AuthContext): Promise<EquityCurve> {
    return this.reporting.equityCurve(auth.user.id);
  }

  @Get('allocation')
  allocation(@CurrentAuth() auth: AuthContext): Promise<DashboardAllocation> {
    return this.reporting.allocation(auth.user.id);
  }

  @Get('pnl')
  pnl(@CurrentAuth() auth: AuthContext): Promise<DashboardPnl> {
    return this.reporting.pnlByMonth(auth.user.id);
  }

  @Get('active-positions')
  activePositions(@CurrentAuth() auth: AuthContext): Promise<DashboardActivePositions> {
    return this.reporting.activePositions(auth.user.id);
  }

  @Get('recent-trades')
  recentTrades(@CurrentAuth() auth: AuthContext): Promise<DashboardRecentTrades> {
    return this.reporting.recentTrades(auth.user.id);
  }

  @Get('data-quality')
  dataQuality(@CurrentAuth() auth: AuthContext): Promise<DashboardDataQuality> {
    return this.reporting.dataQuality(auth.user.id);
  }

  @Post('snapshot')
  snapshot(@CurrentAuth() auth: AuthContext): Promise<PortfolioSnapshot> {
    return this.snapshots.capture(auth.user.id);
  }
}
