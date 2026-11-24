import {
  Body,
  Controller,
  Get,
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
  sandboxTokenCreateRequestSchema,
  sandboxTokenUpdateRequestSchema,
  type SandboxCoverageQuery,
  type SandboxCoverageResponse,
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
import { SandboxTokensService } from './sandbox-tokens.service';
import { SANDBOX_ENABLED, SANDBOX_VERSION, type SandboxStatus } from './sandbox.types';

@ApiTags('sandbox')
@Controller('sandbox')
export class SandboxController {
  constructor(
    @Inject(SANDBOX_ENABLED) private readonly enabled: boolean,
    private readonly tokens: SandboxTokensService,
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
}
