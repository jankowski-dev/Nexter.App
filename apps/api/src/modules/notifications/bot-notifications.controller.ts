import {
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  ServiceUnavailableException,
  UnauthorizedException,
  Body,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { ViberAckRequest, ViberAckResponse, ViberPendingResponse } from '@nexter/contracts';
import { viberAckRequestSchema } from '@nexter/contracts';
import { env } from '../../shared/config/env';
import { ZodValidationPipe } from '../../shared/validation/zod-validation.pipe';
import { Public, SkipOrigin } from '../auth/public.decorator';
import { ViberOutboxService } from './viber-outbox.service';

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
@SkipOrigin()
@Controller('bot/notifications')
export class BotNotificationsController {
  constructor(private readonly outbox: ViberOutboxService) {}

  @Public()
  @Get('pending')
  pending(
    @Headers('authorization') authorization: string | undefined,
  ): Promise<ViberPendingResponse> {
    assertBotToken(authorization);
    return this.outbox.pendingForBot();
  }

  @Public()
  @Post(':id/ack')
  ack(
    @Headers('authorization') authorization: string | undefined,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(viberAckRequestSchema)) body: ViberAckRequest,
  ): Promise<ViberAckResponse> {
    assertBotToken(authorization);
    return this.outbox.ackForBot(id, body);
  }
}
