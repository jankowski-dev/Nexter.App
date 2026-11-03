import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type {
  WatchlistCreateRequest,
  WatchlistEntry,
  WatchlistListQuery,
  WatchlistResponse,
  WatchlistUpdateRequest,
} from '@nexter/contracts';
import {
  watchlistCreateRequestSchema,
  watchlistListQuerySchema,
  watchlistUpdateRequestSchema,
} from '@nexter/contracts';
import type { FastifyRequest } from 'fastify';
import { ZodValidationPipe } from '../../shared/validation/zod-validation.pipe';
import { CurrentAuth } from '../auth/current-auth.decorator';
import type { AuthContext } from '../auth/auth.types';
import { WatchlistService } from './watchlist.service';

@ApiTags('watchlist')
@Controller('watchlist')
export class WatchlistController {
  constructor(private readonly watchlist: WatchlistService) {}

  @Get()
  list(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(watchlistListQuerySchema)) query: WatchlistListQuery,
  ): Promise<WatchlistResponse> {
    return this.watchlist.list(auth.user.id, query);
  }

  @Post()
  create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(watchlistCreateRequestSchema))
    body: WatchlistCreateRequest,
    @Req() request: FastifyRequest,
  ): Promise<WatchlistEntry> {
    return this.watchlist.create(auth.user.id, body, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  @Patch(':id')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(watchlistUpdateRequestSchema))
    body: WatchlistUpdateRequest,
    @Req() request: FastifyRequest,
  ): Promise<WatchlistEntry> {
    return this.watchlist.update(auth.user.id, id, body, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async archive(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.watchlist.archive(auth.user.id, id, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }
}
