import { Controller, Get, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type {
  ViberListQuery,
  ViberListResponse,
  ViberStatusResponse,
  ViberTestResponse,
} from '@nexter/contracts';
import { viberListQuerySchema } from '@nexter/contracts';
import { ZodValidationPipe } from '../../shared/validation/zod-validation.pipe';
import { CurrentAuth } from '../auth/current-auth.decorator';
import type { AuthContext } from '../auth/auth.types';
import { ViberOutboxService } from './viber-outbox.service';

@ApiTags('notifications')
@Controller('notifications/viber')
export class ViberController {
  constructor(private readonly outbox: ViberOutboxService) {}

  @Get('status')
  status(@CurrentAuth() auth: AuthContext): Promise<ViberStatusResponse> {
    return this.outbox.status(auth.user.id);
  }

  @Get()
  list(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(viberListQuerySchema)) query: ViberListQuery,
  ): Promise<ViberListResponse> {
    return this.outbox.list(auth.user.id, query.limit);
  }

  @Post('test')
  test(@CurrentAuth() auth: AuthContext): Promise<ViberTestResponse> {
    return this.outbox.test(auth.user.id);
  }
}
