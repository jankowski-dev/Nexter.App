import { Controller, Get, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type {
  NotificationsClearResponse,
  NotificationsReadAllResponse,
  NotificationsResponse,
  NotificationUnreadCount,
} from '@nexter/contracts';
import { notificationsListQuerySchema } from '@nexter/contracts';
import { ZodValidationPipe } from '../../shared/validation/zod-validation.pipe';
import { CurrentAuth } from '../auth/current-auth.decorator';
import type { AuthContext } from '../auth/auth.types';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(notificationsListQuerySchema)) query: { limit: number },
  ): Promise<NotificationsResponse> {
    return this.notifications.list(auth.user.id, query.limit);
  }

  @Get('unread-count')
  unreadCount(@CurrentAuth() auth: AuthContext): Promise<NotificationUnreadCount> {
    return this.notifications.unreadCount(auth.user.id);
  }

  @Post('read-all')
  markAllRead(@CurrentAuth() auth: AuthContext): Promise<NotificationsReadAllResponse> {
    return this.notifications.markAllRead(auth.user.id);
  }

  @Post('clear')
  clear(@CurrentAuth() auth: AuthContext): Promise<NotificationsClearResponse> {
    return this.notifications.clear(auth.user.id);
  }
}
