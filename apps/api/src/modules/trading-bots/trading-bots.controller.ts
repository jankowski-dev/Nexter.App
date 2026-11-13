import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type {
  BotCreateRequest,
  BotDetailResponse,
  BotEquityResponse,
  BotEventsResponse,
  BotSignalsResponse,
  BotStrategiesResponse,
  BotTradesResponse,
  BotUpdateRequest,
  TradingBotsResponse,
} from '@nexter/contracts';
import {
  botCreateRequestSchema,
  botHistoryQuerySchema,
  botListQuerySchema,
  botUpdateRequestSchema,
} from '@nexter/contracts';
import type { FastifyRequest } from 'fastify';
import { ZodValidationPipe } from '../../shared/validation/zod-validation.pipe';
import { CurrentAuth } from '../auth/current-auth.decorator';
import type { AuthContext } from '../auth/auth.types';
import { TradingBotsService } from './trading-bots.service';

function meta(request: FastifyRequest) {
  return { ip: request.ip, userAgent: request.headers['user-agent'] };
}

@ApiTags('trading-bots')
@Controller('trading-bots')
export class TradingBotsController {
  constructor(private readonly bots: TradingBotsService) {}

  @Get('strategies')
  strategies(): Promise<BotStrategiesResponse> {
    return this.bots.listStrategies();
  }

  @Get('bots')
  list(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(botListQuerySchema)) query: { includeArchived: boolean },
  ): Promise<TradingBotsResponse> {
    return this.bots.listBots(auth.user.id, query.includeArchived);
  }

  @Post('bots')
  create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(botCreateRequestSchema)) body: BotCreateRequest,
    @Req() request: FastifyRequest,
  ): Promise<BotDetailResponse> {
    return this.bots.createBot(auth.user.id, body, meta(request));
  }

  @Get('bots/:id')
  get(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<BotDetailResponse> {
    return this.bots.getBot(auth.user.id, id);
  }

  @Patch('bots/:id')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(botUpdateRequestSchema)) body: BotUpdateRequest,
    @Req() request: FastifyRequest,
  ): Promise<BotDetailResponse> {
    return this.bots.updateBot(auth.user.id, id, body, meta(request));
  }

  @Post('bots/:id/start')
  start(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: FastifyRequest,
  ): Promise<BotDetailResponse> {
    return this.bots.startBot(auth.user.id, id, meta(request));
  }

  @Post('bots/:id/stop')
  stop(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: FastifyRequest,
  ): Promise<BotDetailResponse> {
    return this.bots.stopBot(auth.user.id, id, meta(request));
  }

  @Post('bots/:id/reset')
  reset(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: FastifyRequest,
  ): Promise<BotDetailResponse> {
    return this.bots.resetBot(auth.user.id, id, meta(request));
  }

  @Post('bots/:id/close-positions')
  closePositions(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: FastifyRequest,
  ): Promise<BotDetailResponse> {
    return this.bots.closePositions(auth.user.id, id, meta(request));
  }

  @Delete('bots/:id')
  archive(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    return this.bots.archiveBot(auth.user.id, id, meta(request));
  }

  @Get('bots/:id/trades')
  trades(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query(new ZodValidationPipe(botHistoryQuerySchema)) query: { limit: number; offset: number },
  ): Promise<BotTradesResponse> {
    return this.bots.trades(auth.user.id, id, query.limit, query.offset);
  }

  @Get('bots/:id/events')
  events(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query(new ZodValidationPipe(botHistoryQuerySchema)) query: { limit: number; offset: number },
  ): Promise<BotEventsResponse> {
    return this.bots.events(auth.user.id, id, query.limit, query.offset);
  }

  @Get('bots/:id/equity')
  equity(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query(new ZodValidationPipe(botHistoryQuerySchema)) query: { limit: number; offset: number },
  ): Promise<BotEquityResponse> {
    return this.bots.equity(auth.user.id, id, query.limit, query.offset);
  }

  @Get('bots/:id/signals')
  signals(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<BotSignalsResponse> {
    return this.bots.signals(auth.user.id, id);
  }
}
