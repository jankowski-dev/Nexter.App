import {
  Controller,
  Get,
  Headers,
  Query,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { BotUpcomingTasksResponse } from '@nexter/contracts';
import { env } from '../../shared/config/env';
import { Public, SkipOrigin } from '../auth/public.decorator';
import { TasksService } from './tasks.service';
import { SettingsService } from '../settings/settings.service';

function tokensEqual(left: string, right: string): boolean {
  const leftHash = createHash('sha256').update(left).digest();
  const rightHash = createHash('sha256').update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

@ApiTags('bot')
@SkipOrigin()
@Controller('bot')
export class BotTasksController {
  constructor(
    private readonly tasks: TasksService,
    private readonly settings: SettingsService,
  ) {}

  @Public()
  @Get('tasks/upcoming')
  async upcoming(
    @Headers('authorization') authorization: string | undefined,
    @Query('minutes') minutes: string | undefined,
  ): Promise<BotUpcomingTasksResponse> {
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

    const runtime = await this.settings.getRuntime();
    const parsed = minutes === undefined ? runtime.taskReminderLeadMinutes : Number(minutes);
    const safeMinutes = Math.min(
      Math.max(Number.isFinite(parsed) ? Math.trunc(parsed) : runtime.taskReminderLeadMinutes, 1),
      60,
    );
    return this.tasks.upcomingForBot(safeMinutes);
  }
}
