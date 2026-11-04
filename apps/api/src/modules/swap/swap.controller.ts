import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type {
  SwapBuildRequest,
  SwapBuildResponse,
  SwapConfigResponse,
  SwapOrderDetail,
  SwapOrdersQuery,
  SwapOrdersResponse,
  SwapQuoteRequest,
} from '@nexter/contracts';
import {
  swapBuildRequestSchema,
  swapOrdersQuerySchema,
  swapQuoteRequestSchema,
} from '@nexter/contracts';
import type { FastifyRequest } from 'fastify';
import { ZodValidationPipe } from '../../shared/validation/zod-validation.pipe';
import { CurrentAuth } from '../auth/current-auth.decorator';
import type { AuthContext } from '../auth/auth.types';
import { SwapService } from './swap.service';

@ApiTags('swap')
@Controller('swap')
export class SwapController {
  constructor(private readonly swaps: SwapService) {}

  @Get('config')
  config(): SwapConfigResponse {
    return this.swaps.config();
  }

  @Post('quote')
  @HttpCode(HttpStatus.CREATED)
  quote(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(swapQuoteRequestSchema)) body: SwapQuoteRequest,
    @Req() request: FastifyRequest,
  ): Promise<SwapOrderDetail> {
    return this.swaps.quote(auth.user.id, body, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  @Post('build')
  @HttpCode(HttpStatus.CREATED)
  build(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(swapBuildRequestSchema)) body: SwapBuildRequest,
    @Req() request: FastifyRequest,
  ): Promise<SwapBuildResponse> {
    return this.swaps.build(auth.user.id, body, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  @Get('orders')
  list(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(swapOrdersQuerySchema)) query: SwapOrdersQuery,
  ): Promise<SwapOrdersResponse> {
    return this.swaps.list(auth.user.id, query);
  }

  @Get('orders/:id')
  get(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<SwapOrderDetail> {
    return this.swaps.get(auth.user.id, id);
  }

  @Post('orders/:id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: FastifyRequest,
  ): Promise<SwapOrderDetail> {
    return this.swaps.cancel(auth.user.id, id, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }
}
