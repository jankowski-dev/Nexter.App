import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import {
  aiProfileTokenCreateRequestSchema,
  aiProfileTokenUpdateRequestSchema,
  aiProfileUpdateRequestSchema,
  aiServiceConfigUpdateRequestSchema,
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
import { AiTradingService } from './ai-trading.service';

@ApiTags('ai-trading')
@Controller('ai-trading')
export class AiTradingController {
  constructor(private readonly aiTrading: AiTradingService) {}

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
  listServices(@CurrentAuth() auth: AuthContext): Promise<{ data: AiServiceConfig[] }> {
    return this.aiTrading.listServices(auth.user.id).then((data) => ({ data }));
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

  @Get('dashboard')
  dashboard(@CurrentAuth() auth: AuthContext): Promise<AiTradingDashboard> {
    return this.aiTrading.dashboard(auth.user.id);
  }
}
