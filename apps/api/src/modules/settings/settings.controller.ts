import { Body, Controller, Get, Patch, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Settings, UpdateSettingsRequest } from '@nexter/contracts';
import { updateSettingsRequestSchema } from '@nexter/contracts';
import type { FastifyRequest } from 'fastify';
import { ZodValidationPipe } from '../../shared/validation/zod-validation.pipe';
import { CurrentAuth } from '../auth/current-auth.decorator';
import type { AuthContext } from '../auth/auth.types';
import { SettingsService } from './settings.service';

@ApiTags('settings')
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  get(@CurrentAuth() auth: AuthContext): Promise<Settings> {
    return this.settings.get(auth.user.id);
  }

  @Patch()
  update(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(updateSettingsRequestSchema))
    body: UpdateSettingsRequest,
    @Req() request: FastifyRequest,
  ): Promise<Settings> {
    return this.settings.update(auth.user.id, body, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }
}
