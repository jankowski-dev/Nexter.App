import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { BotAudioNoteRequest, BotAudioNoteResponse } from '@nexter/contracts';
import { botAudioNoteRequestSchema } from '@nexter/contracts';
import { env } from '../../shared/config/env';
import { ZodValidationPipe } from '../../shared/validation/zod-validation.pipe';
import { Public } from '../auth/public.decorator';
import { AudioNotesService } from './audio-notes.service';

function tokensEqual(left: string, right: string): boolean {
  const leftHash = createHash('sha256').update(left).digest();
  const rightHash = createHash('sha256').update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

function assertBotToken(authorization: string | undefined): void {
  if (!env.BOT_API_TOKEN) {
    throw new ServiceUnavailableException({
      code: 'BOT_DISABLED',
      message: 'Bot API is not configured',
    });
  }
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!token || !tokensEqual(token, env.BOT_API_TOKEN)) {
    throw new UnauthorizedException({
      code: 'BOT_UNAUTHORIZED',
      message: 'Invalid bot token',
    });
  }
}

@ApiTags('bot')
@Controller('bot/audio-notes')
export class AudioNotesController {
  constructor(private readonly audioNotes: AudioNotesService) {}

  @Public()
  @Post()
  create(
    @Headers('authorization') authorization: string | undefined,
    @Body(new ZodValidationPipe(botAudioNoteRequestSchema)) body: BotAudioNoteRequest,
  ): Promise<BotAudioNoteResponse> {
    assertBotToken(authorization);
    return this.audioNotes.createFromBot(body);
  }

  @Public()
  @Get(':id')
  status(
    @Headers('authorization') authorization: string | undefined,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<BotAudioNoteResponse> {
    assertBotToken(authorization);
    return this.audioNotes.status(id);
  }
}
