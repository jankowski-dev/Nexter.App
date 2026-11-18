import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import {
  automationRuleCreateRequestSchema,
  automationRuleUpdateRequestSchema,
  type AutomationRule,
  type AutomationRuleCreateRequest,
  type AutomationRuleUpdateRequest,
  type AutomationRulesResponse,
  type AutomationRunsResponse,
  type AutomationTestResponse,
} from '@nexter/contracts';
import { ZodValidationPipe } from '../../shared/validation/zod-validation.pipe';
import { CurrentAuth } from '../auth/current-auth.decorator';
import type { AuthContext } from '../auth/auth.types';
import { AutomationService } from './automation.service';

@ApiTags('automation')
@Controller('automation')
export class AutomationController {
  constructor(private readonly automation: AutomationService) {}

  @Get('rules')
  list(@CurrentAuth() auth: AuthContext): Promise<AutomationRulesResponse> {
    return this.automation.list(auth.user.id);
  }

  @Post('rules')
  create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(automationRuleCreateRequestSchema))
    body: AutomationRuleCreateRequest,
    @Req() request: FastifyRequest,
  ): Promise<AutomationRule> {
    return this.automation.create(auth.user.id, body, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  @Patch('rules/:id')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(automationRuleUpdateRequestSchema))
    body: AutomationRuleUpdateRequest,
    @Req() request: FastifyRequest,
  ): Promise<AutomationRule> {
    return this.automation.update(auth.user.id, id, body, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  @Post('rules/:id/test')
  test(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<AutomationTestResponse> {
    return this.automation.test(auth.user.id, id);
  }

  @Get('runs')
  runs(
    @CurrentAuth() auth: AuthContext,
    @Query('limit') limit?: string,
  ): Promise<AutomationRunsResponse> {
    const parsed = limit === undefined ? 50 : Number(limit);
    return this.automation.runs(auth.user.id, Number.isFinite(parsed) ? Math.trunc(parsed) : 50);
  }

  @Post('pause-all')
  pauseAll(
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<AutomationRulesResponse> {
    return this.automation.pauseAll(auth.user.id, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }
}
