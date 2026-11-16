import { Body, Controller, Delete, Get, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AiSettings, AiTestResponse, UpdateAiSettingsRequest } from '@nexter/contracts';
import { updateAiSettingsRequestSchema } from '@nexter/contracts';
import { CurrentAuth } from '../auth/current-auth.decorator';
import type { AuthContext } from '../auth/auth.types';
import { ZodValidationPipe } from '../../shared/validation/zod-validation.pipe';
import { AiSettingsService } from './ai-settings.service';
import { AiService } from './ai.service';

@ApiTags('ai')
@Controller('settings/ai')
export class AiController {
  constructor(
    private readonly settings: AiSettingsService,
    private readonly ai: AiService,
  ) {}

  @Get()
  get(@CurrentAuth() auth: AuthContext): Promise<AiSettings> {
    return this.settings.get(auth.user.id);
  }

  @Put()
  update(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(updateAiSettingsRequestSchema)) body: UpdateAiSettingsRequest,
  ): Promise<AiSettings> {
    return this.settings.update(auth.user.id, body);
  }

  @Post('test')
  test(@CurrentAuth() auth: AuthContext): Promise<AiTestResponse> {
    return this.ai.testConnection(auth.user.id);
  }

  @Delete('key')
  async removeKey(@CurrentAuth() auth: AuthContext): Promise<AiSettings> {
    return this.settings.update(auth.user.id, { clearApiKey: true });
  }
}
