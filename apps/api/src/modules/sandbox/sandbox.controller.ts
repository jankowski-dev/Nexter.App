import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  sandboxCoverageQuerySchema,
  sandboxEquityQuerySchema,
  sandboxEventsQuerySchema,
  sandboxPageQuerySchema,
  sandboxReplayCreateRequestSchema,
  sandboxReplayListQuerySchema,
  sandboxReplayPreflightRequestSchema,
  sandboxRunCreateRequestSchema,
  sandboxRunStartRequestSchema,
  sandboxRunUpdateRequestSchema,
  sandboxRunsQuerySchema,
  sandboxTokenCreateRequestSchema,
  sandboxTokenUpdateRequestSchema,
  type SandboxCoverageQuery,
  type SandboxCoverageResponse,
  type SandboxEquityQuery,
  type SandboxEquityResponse,
  type SandboxEventsQuery,
  type SandboxEventsResponse,
  type SandboxIntentsResponse,
  type SandboxOverview,
  type SandboxPageQuery,
  type SandboxPositionsResponse,
  type SandboxReplayCreateRequest,
  type SandboxReplayDetail,
  type SandboxReplayListQuery,
  type SandboxReplayListResponse,
  type SandboxReplayPreflightRequest,
  type SandboxReplayPreflightResponse,
  type SandboxReplayReportResponse,
  type SandboxReportResponse,
  type SandboxRun,
  type SandboxRunCreateRequest,
  type SandboxRunDetail,
  type SandboxRunStartRequest,
  type SandboxRunsQuery,
  type SandboxRunsResponse,
  type SandboxRunUpdateRequest,
  type SandboxToken,
  type SandboxTokenCreateRequest,
  type SandboxTokenRefreshResponse,
  type SandboxTokensResponse,
  type SandboxTokenUpdateRequest,
  type SandboxTradesResponse,
} from '@nexter/contracts';
import type { FastifyRequest } from 'fastify';
import { ZodValidationPipe } from '../../shared/validation/zod-validation.pipe';
import { CurrentAuth } from '../auth/current-auth.decorator';
import type { AuthContext } from '../auth/auth.types';
import { SandboxEnabledGuard } from './sandbox-enabled.guard';
import { SandboxReadService } from './sandbox-read.service';
import { SandboxReplayReportService } from './sandbox-replay-report.service';
import { SandboxReplayService } from './sandbox-replay.service';
import { SandboxRunService } from './sandbox-run.service';
import { SandboxTokensService } from './sandbox-tokens.service';
import { SANDBOX_ENABLED, SANDBOX_VERSION, type SandboxStatus } from './sandbox.types';

@ApiTags('sandbox')
@Controller('sandbox')
export class SandboxController {
  constructor(
    @Inject(SANDBOX_ENABLED) private readonly enabled: boolean,
    private readonly tokens: SandboxTokensService,
    private readonly runs: SandboxRunService,
    private readonly read: SandboxReadService,
    private readonly replay: SandboxReplayService,
    private readonly replayReports: SandboxReplayReportService,
  ) {}

  @Get('status')
  status(): SandboxStatus {
    return { enabled: this.enabled, version: SANDBOX_VERSION };
  }

  @Get('tokens')
  @UseGuards(SandboxEnabledGuard)
  listTokens(@CurrentAuth() auth: AuthContext): Promise<SandboxTokensResponse> {
    return this.tokens.list(auth.user.id);
  }

  @Post('tokens')
  @UseGuards(SandboxEnabledGuard)
  createToken(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(sandboxTokenCreateRequestSchema))
    body: SandboxTokenCreateRequest,
    @Req() request: FastifyRequest,
  ): Promise<SandboxToken> {
    return this.tokens.create(auth.user.id, body, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  @Patch('tokens/:id')
  @UseGuards(SandboxEnabledGuard)
  updateToken(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(sandboxTokenUpdateRequestSchema))
    body: SandboxTokenUpdateRequest,
    @Req() request: FastifyRequest,
  ): Promise<SandboxToken> {
    return this.tokens.update(auth.user.id, id, body, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  @Post('tokens/:id/refresh')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SandboxEnabledGuard)
  refreshToken(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: FastifyRequest,
  ): Promise<SandboxTokenRefreshResponse> {
    return this.tokens.refresh(auth.user.id, id, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  @Get('coverage')
  @UseGuards(SandboxEnabledGuard)
  coverage(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(sandboxCoverageQuerySchema)) query: SandboxCoverageQuery,
  ): Promise<SandboxCoverageResponse> {
    return this.tokens.coverage(auth.user.id, query.tokenKey);
  }

  @Get('overview')
  @UseGuards(SandboxEnabledGuard)
  @Header('Cache-Control', 'no-store')
  overview(@CurrentAuth() auth: AuthContext): Promise<SandboxOverview> {
    return this.read.overview(auth.user.id);
  }

  @Post('replays/preflight')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SandboxEnabledGuard)
  @Header('Cache-Control', 'no-store')
  replayPreflight(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(sandboxReplayPreflightRequestSchema))
    body: SandboxReplayPreflightRequest,
  ): Promise<SandboxReplayPreflightResponse> {
    return this.replay.preflight(auth.user.id, body);
  }

  @Post('replays')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(SandboxEnabledGuard)
  @Header('Cache-Control', 'no-store')
  createReplay(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(sandboxReplayCreateRequestSchema))
    body: SandboxReplayCreateRequest,
    @Req() request: FastifyRequest,
  ): Promise<SandboxReplayDetail> {
    return this.replay.create(auth.user.id, body, auditMeta(request));
  }

  @Get('replays')
  @UseGuards(SandboxEnabledGuard)
  @Header('Cache-Control', 'no-store')
  listReplays(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(sandboxReplayListQuerySchema)) query: SandboxReplayListQuery,
  ): Promise<SandboxReplayListResponse> {
    return this.replay.list(auth.user.id, query);
  }

  @Get('replays/:id')
  @UseGuards(SandboxEnabledGuard)
  @Header('Cache-Control', 'no-store')
  getReplay(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<SandboxReplayDetail> {
    return this.replay.detail(auth.user.id, id);
  }

  @Get('replays/:id/report.json')
  @UseGuards(SandboxEnabledGuard)
  @Header('Cache-Control', 'no-store')
  replayReportJson(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<SandboxReplayReportResponse> {
    return this.replayReports.getReport(auth.user.id, id);
  }

  @Get('replays/:id/report.md')
  @UseGuards(SandboxEnabledGuard)
  @Header('Cache-Control', 'no-store')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  replayReportMarkdown(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<string> {
    return this.replayReports.getReportMarkdown(auth.user.id, id);
  }

  @Post('replays/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SandboxEnabledGuard)
  @Header('Cache-Control', 'no-store')
  cancelReplay(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: FastifyRequest,
  ): Promise<SandboxReplayDetail> {
    return this.replay.cancel(auth.user.id, id, auditMeta(request));
  }

  @Post('replays/:id/archive')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SandboxEnabledGuard)
  @Header('Cache-Control', 'no-store')
  archiveReplay(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: FastifyRequest,
  ): Promise<SandboxReplayDetail> {
    return this.replay.archive(auth.user.id, id, auditMeta(request));
  }

  @Get('runs')
  @UseGuards(SandboxEnabledGuard)
  @Header('Cache-Control', 'no-store')
  listRuns(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(sandboxRunsQuerySchema)) query: SandboxRunsQuery,
  ): Promise<SandboxRunsResponse> {
    return this.read.listRuns(auth.user.id, query);
  }

  @Get('runs/:id')
  @UseGuards(SandboxEnabledGuard)
  @Header('Cache-Control', 'no-store')
  getRun(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<SandboxRunDetail> {
    return this.read.getRun(auth.user.id, id);
  }

  @Get('runs/:id/positions')
  @UseGuards(SandboxEnabledGuard)
  @Header('Cache-Control', 'no-store')
  positions(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<SandboxPositionsResponse> {
    return this.read.positions(auth.user.id, id);
  }

  @Get('runs/:id/trades')
  @UseGuards(SandboxEnabledGuard)
  @Header('Cache-Control', 'no-store')
  trades(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query(new ZodValidationPipe(sandboxPageQuerySchema)) query: SandboxPageQuery,
  ): Promise<SandboxTradesResponse> {
    return this.read.trades(auth.user.id, id, query);
  }

  @Get('runs/:id/intents')
  @UseGuards(SandboxEnabledGuard)
  @Header('Cache-Control', 'no-store')
  intents(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query(new ZodValidationPipe(sandboxPageQuerySchema)) query: SandboxPageQuery,
  ): Promise<SandboxIntentsResponse> {
    return this.read.intents(auth.user.id, id, query);
  }

  @Get('runs/:id/events')
  @UseGuards(SandboxEnabledGuard)
  @Header('Cache-Control', 'no-store')
  events(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query(new ZodValidationPipe(sandboxEventsQuerySchema)) query: SandboxEventsQuery,
  ): Promise<SandboxEventsResponse> {
    return this.read.events(auth.user.id, id, query);
  }

  @Get('runs/:id/equity')
  @UseGuards(SandboxEnabledGuard)
  @Header('Cache-Control', 'no-store')
  equity(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query(new ZodValidationPipe(sandboxEquityQuerySchema)) query: SandboxEquityQuery,
  ): Promise<SandboxEquityResponse> {
    return this.read.equity(auth.user.id, id, query);
  }

  @Get('runs/:id/report.json')
  @UseGuards(SandboxEnabledGuard)
  @Header('Cache-Control', 'no-store')
  reportJson(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<SandboxReportResponse> {
    return this.read.report(auth.user.id, id);
  }

  @Get('runs/:id/report.md')
  @UseGuards(SandboxEnabledGuard)
  @Header('Cache-Control', 'no-store')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  reportMarkdown(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<string> {
    return this.read.reportMarkdown(auth.user.id, id);
  }

  @Post('runs')
  @UseGuards(SandboxEnabledGuard)
  createRun(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(sandboxRunCreateRequestSchema)) body: SandboxRunCreateRequest,
    @Req() request: FastifyRequest,
  ): Promise<SandboxRun> {
    return this.runs.create(auth.user.id, body, auditMeta(request));
  }

  @Patch('runs/:id')
  @UseGuards(SandboxEnabledGuard)
  updateRun(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(sandboxRunUpdateRequestSchema)) body: SandboxRunUpdateRequest,
    @Req() request: FastifyRequest,
  ): Promise<SandboxRun> {
    return this.runs.updateDraft(auth.user.id, id, body, auditMeta(request));
  }

  @Post('runs/:id/start')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SandboxEnabledGuard)
  startRun(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(sandboxRunStartRequestSchema)) body: SandboxRunStartRequest,
    @Req() request: FastifyRequest,
  ): Promise<SandboxRun> {
    return this.runs.start(auth.user.id, id, body, auditMeta(request));
  }

  @Post('runs/:id/pause')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SandboxEnabledGuard)
  pauseRun(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: FastifyRequest,
  ): Promise<SandboxRun> {
    return this.runs.pause(auth.user.id, id, auditMeta(request));
  }

  @Post('runs/:id/resume')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SandboxEnabledGuard)
  resumeRun(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: FastifyRequest,
  ): Promise<SandboxRun> {
    return this.runs.resume(auth.user.id, id, auditMeta(request));
  }

  @Post('runs/:id/stop')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SandboxEnabledGuard)
  stopRun(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: FastifyRequest,
  ): Promise<SandboxRun> {
    return this.runs.stop(auth.user.id, id, auditMeta(request));
  }

  @Post('runs/:id/archive')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SandboxEnabledGuard)
  archiveRun(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: FastifyRequest,
  ): Promise<SandboxRun> {
    return this.runs.archive(auth.user.id, id, auditMeta(request));
  }

  @Post('runs/:id/close/:tokenId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SandboxEnabledGuard)
  closeTrade(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('tokenId') tokenId: string,
    @Req() request: FastifyRequest,
  ): Promise<SandboxRun> {
    return this.runs.requestClose(auth.user.id, id, tokenId, auditMeta(request));
  }
}

function auditMeta(request: FastifyRequest) {
  return { ip: request.ip, userAgent: request.headers['user-agent'] };
}
