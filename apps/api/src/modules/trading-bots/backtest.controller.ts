import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type {
  BotBacktestListQuery,
  BotBacktestPreviewRequest,
  BotBacktestPreviewResponse,
  BotBacktestRequest,
  BotBacktestRun,
  BotBacktestsResponse,
} from '@nexter/contracts';
import {
  botBacktestListQuerySchema,
  botBacktestPreviewRequestSchema,
  botBacktestRequestSchema,
} from '@nexter/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodValidationPipe } from '../../shared/validation/zod-validation.pipe';
import { CurrentAuth } from '../auth/current-auth.decorator';
import type { AuthContext } from '../auth/auth.types';
import { BacktestService } from './backtest/backtest.service';

function meta(request: FastifyRequest) {
  return { ip: request.ip, userAgent: request.headers['user-agent'] };
}

@ApiTags('trading-bots')
@Controller('trading-bots/backtests')
export class BacktestController {
  constructor(private readonly backtests: BacktestService) {}

  @Post('preview')
  preview(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(botBacktestPreviewRequestSchema)) body: BotBacktestPreviewRequest,
  ): Promise<BotBacktestPreviewResponse> {
    return this.backtests.preview(auth.user.id, body.assetId, body.days);
  }

  @Post()
  run(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(botBacktestRequestSchema)) body: BotBacktestRequest,
    @Req() request: FastifyRequest,
  ): Promise<BotBacktestRun> {
    return this.backtests.run(auth.user.id, body, meta(request));
  }

  @Get()
  list(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(botBacktestListQuerySchema)) query: BotBacktestListQuery,
  ): Promise<BotBacktestsResponse> {
    return this.backtests.list(auth.user.id, query);
  }

  @Get(':id')
  get(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<BotBacktestRun> {
    return this.backtests.get(auth.user.id, id);
  }

  @Get(':id/report.pdf')
  async report(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const { buffer, filename } = await this.backtests.report(auth.user.id, id);
    reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', `attachment; filename="${filename}"`)
      .header('cache-control', 'no-store')
      .send(buffer);
  }
}
