import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import {
  pendingOrderCreateRequestSchema,
  pendingOrderUpdateRequestSchema,
  type PendingOrder,
  type PendingOrderCreateRequest,
  type PendingOrderUpdateRequest,
  type PendingOrdersResponse,
} from '@nexter/contracts';
import { ZodValidationPipe } from '../../shared/validation/zod-validation.pipe';
import { CurrentAuth } from '../auth/current-auth.decorator';
import type { AuthContext } from '../auth/auth.types';
import { PendingOrdersService } from './pending-orders.service';

@ApiTags('pending-orders')
@Controller('pending-orders')
export class PendingOrdersController {
  constructor(private readonly orders: PendingOrdersService) {}

  @Get()
  list(@CurrentAuth() auth: AuthContext): Promise<PendingOrdersResponse> {
    return this.orders.list(auth.user.id);
  }

  @Post()
  create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(pendingOrderCreateRequestSchema))
    body: PendingOrderCreateRequest,
    @Req() request: FastifyRequest,
  ): Promise<PendingOrder> {
    return this.orders.create(auth.user.id, body, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  @Patch(':id')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(pendingOrderUpdateRequestSchema))
    body: PendingOrderUpdateRequest,
    @Req() request: FastifyRequest,
  ): Promise<PendingOrder> {
    return this.orders.update(auth.user.id, id, body, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }
}
