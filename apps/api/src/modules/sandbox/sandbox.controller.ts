import {
  Body,
  Controller,
  Get,
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
  sandboxRunCreateRequestSchema,
  sandboxRunStartRequestSchema,
  sandboxRunUpdateRequestSchema,
  sandboxTokenCreateRequestSchema,
  sandboxTokenUpdateRequestSchema,
  type SandboxCoverageQuery,
  type SandboxCoverageResponse,
  type SandboxRun,
  type SandboxRunCreateRequest,
  type SandboxRunStartRequest,
  type SandboxRunUpdateRequest,
  type SandboxToken,
  type SandboxTokenCreateRequest,
  type SandboxTokenRefreshResponse,
  type SandboxTokensResponse,
  type SandboxTokenUpdateRequest,
} from '@nexter/contracts';
import type { FastifyRequest } from 'fastify';
import { ZodValidationPipe } from '../../shared/validation/zod-validation.pipe';
import { CurrentAuth } from '../auth/current-auth.decorator';
import type { AuthContext } from '../auth/auth.types';
import { SandboxEnabledGuard } from './sandbox-enabled.guard';
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
