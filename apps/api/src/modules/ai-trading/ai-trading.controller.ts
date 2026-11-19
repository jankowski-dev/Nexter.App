import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import {
  aiDataRefreshRequestSchema,
  aiLabAnalyzeRequestSchema,
  aiLabBacktestRequestSchema,
  aiLabQuerySchema,
  aiSearchRequestSchema,
  aiProfileTokenCreateRequestSchema,
  aiProfileTokenUpdateRequestSchema,
  aiProfileUpdateRequestSchema,
  aiServiceConfigUpdateRequestSchema,
  type AiCoverage,
  type AiDataRefreshRequest,
  type AiDataRefreshResponse,
  type AiLabAnalysis,
  type AiLabAnalyzeRequest,
  type AiLabBacktestRequest,
  type AiLabBacktestResponse,
  type AiLabLatest,
  type AiLabQuery,
  type AiSearchRequest,
  type AiSearchResults,
  type AiSearchStatus,
  type AiProfile,
  type AiProfileToken,
  type AiProfileTokenCreateRequest,
  type AiProfileTokenUpdateRequest,
  type AiProfileUpdateRequest,
  type AiServiceConfig,
  type AiServiceConfigUpdateRequest,
  type AiTradingDashboard,
} from '@nexter/contracts';
import { ZodValidationPipe } from '../../shared/validation/zod-validation.pipe';
import { CurrentAuth } from '../auth/current-auth.decorator';
import type { AuthContext } from '../auth/auth.types';
import { AiDataService } from './ai-data.service';
import { AiLabService } from './ai-lab.service';
import { AiSearchService } from './ai-search.service';
import { AiTradingService } from './ai-trading.service';

@ApiTags('ai-trading')
@Controller('ai-trading')
export class AiTradingController {
  constructor(
    private readonly aiTrading: AiTradingService,
    private readonly aiData: AiDataService,
    private readonly aiLab: AiLabService,
    private readonly aiSearch: AiSearchService,
  ) {}

  @Get('profile')
  getProfile(@CurrentAuth() auth: AuthContext): Promise<AiProfile> {
    return this.aiTrading.getProfile(auth.user.id);
  }

  @Put('profile')
  updateProfile(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(aiProfileUpdateRequestSchema)) body: AiProfileUpdateRequest,
    @Req() request: FastifyRequest,
  ): Promise<AiProfile> {
    return this.aiTrading.updateProfile(auth.user.id, body, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  @Get('profile/tokens')
  listTokens(@CurrentAuth() auth: AuthContext): Promise<{ data: AiProfileToken[] }> {
    return this.aiTrading.listTokens(auth.user.id).then((data) => ({ data }));
  }

  @Post('profile/tokens')
  addToken(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(aiProfileTokenCreateRequestSchema))
    body: AiProfileTokenCreateRequest,
    @Req() request: FastifyRequest,
  ): Promise<AiProfileToken> {
    return this.aiTrading.addToken(auth.user.id, body, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  @Patch('profile/tokens/:id')
  updateToken(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(aiProfileTokenUpdateRequestSchema))
    body: AiProfileTokenUpdateRequest,
    @Req() request: FastifyRequest,
  ): Promise<AiProfileToken> {
    return this.aiTrading.updateToken(auth.user.id, id, body, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  @Delete('profile/tokens/:id')
  removeToken(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    return this.aiTrading.removeToken(auth.user.id, id, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  @Get('services')
  listServices(
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<{ data: AiServiceConfig[] }> {
    return this.aiTrading
      .listServices(auth.user.id, {
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      })
      .then((data) => ({ data }));
  }

  @Put('services/:service')
  updateService(
    @CurrentAuth() auth: AuthContext,
    @Param('service') service: string,
    @Body(new ZodValidationPipe(aiServiceConfigUpdateRequestSchema))
    body: AiServiceConfigUpdateRequest,
    @Req() request: FastifyRequest,
  ): Promise<AiServiceConfig> {
    return this.aiTrading.updateService(auth.user.id, service, body, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  @Post('search')
  @HttpCode(202)
  startSearch(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(aiSearchRequestSchema)) body: AiSearchRequest,
    @Req() request: FastifyRequest,
  ): Promise<{ runId: string }> {
    return this.aiSearch.start(auth.user.id, body, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  @Get('search/:runId')
  searchStatus(
    @CurrentAuth() auth: AuthContext,
    @Param('runId', new ParseUUIDPipe()) runId: string,
  ): Promise<AiSearchStatus> {
    return this.aiSearch.status(auth.user.id, runId);
  }

  @Get('search/:runId/results')
  searchResults(
    @CurrentAuth() auth: AuthContext,
    @Param('runId', new ParseUUIDPipe()) runId: string,
  ): Promise<AiSearchResults> {
    return this.aiSearch.results(auth.user.id, runId);
  }

  @Post('search/:runId/cancel')
  @HttpCode(200)
  cancelSearch(
    @CurrentAuth() auth: AuthContext,
    @Param('runId', new ParseUUIDPipe()) runId: string,
  ): Promise<AiSearchStatus> {
    return this.aiSearch.cancel(auth.user.id, runId);
  }

  @Get('dashboard')
  dashboard(@CurrentAuth() auth: AuthContext): Promise<AiTradingDashboard> {
    return this.aiTrading.dashboard(auth.user.id);
  }

  @Get('coverage')
  coverage(@CurrentAuth() auth: AuthContext): Promise<AiCoverage> {
    return this.aiData.coverage(auth.user.id);
  }

  @Get('lab')
  latestLab(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(aiLabQuerySchema)) query: AiLabQuery,
  ): Promise<AiLabLatest> {
    return this.aiLab.latest(auth.user.id, query);
  }

  @Post('lab/analyze')
  analyze(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(aiLabAnalyzeRequestSchema)) body: AiLabAnalyzeRequest,
    @Req() request: FastifyRequest,
  ): Promise<AiLabAnalysis> {
    return this.aiLab.analyze(auth.user.id, body, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  @Post('lab/backtest')
  backtestCandidate(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(aiLabBacktestRequestSchema)) body: AiLabBacktestRequest,
    @Req() request: FastifyRequest,
  ): Promise<AiLabBacktestResponse> {
    return this.aiLab.backtest(auth.user.id, body.candidateId, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  @Post('data/refresh')
  refreshData(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(aiDataRefreshRequestSchema)) body: AiDataRefreshRequest,
    @Req() request: FastifyRequest,
  ): Promise<AiDataRefreshResponse> {
    return this.aiData.refresh(auth.user.id, body, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }
}
