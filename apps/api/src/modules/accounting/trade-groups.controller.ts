import {
  Body,
  Controller,
  Get,
  Headers,
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
  TradeGroupDetail,
  TradeGroupListQuery,
  TradeGroupNotesRequest,
  TradeGroupsResponse,
  TradeGroupSellRequest,
} from '@nexter/contracts';
import {
  tradeGroupListQuerySchema,
  tradeGroupNotesRequestSchema,
  tradeGroupSellRequestSchema,
} from '@nexter/contracts';
import type { FastifyRequest } from 'fastify';
import { ZodValidationPipe } from '../../shared/validation/zod-validation.pipe';
import { CurrentAuth } from '../auth/current-auth.decorator';
import type { AuthContext } from '../auth/auth.types';
import { TradeGroupsService } from './trade-groups.service';

@ApiTags('accounting')
@Controller('trade-groups')
export class TradeGroupsController {
  constructor(private readonly tradeGroups: TradeGroupsService) {}

  @Get()
  list(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(tradeGroupListQuerySchema)) query: TradeGroupListQuery,
  ): Promise<TradeGroupsResponse> {
    return this.tradeGroups.list(auth.user.id, query);
  }

  @Get(':id')
  get(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<TradeGroupDetail> {
    return this.tradeGroups.get(auth.user.id, id);
  }

  @Patch(':id')
  updateNotes(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(tradeGroupNotesRequestSchema))
    body: TradeGroupNotesRequest,
    @Req() request: FastifyRequest,
  ): Promise<TradeGroupDetail> {
    return this.tradeGroups.updateNotes(auth.user.id, id, body, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  @Post(':id/sells')
  @HttpCode(HttpStatus.CREATED)
  sell(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(tradeGroupSellRequestSchema))
    body: TradeGroupSellRequest,
    @Req() request: FastifyRequest,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<TradeGroupDetail> {
    return this.tradeGroups.sell(
      auth.user.id,
      id,
      body,
      {
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      },
      idempotencyKey?.trim().slice(0, 200) || undefined,
    );
  }
}
