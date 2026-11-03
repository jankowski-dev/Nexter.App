import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Price, PricesResponse, SetPriceRequest } from '@nexter/contracts';
import { setPriceRequestSchema } from '@nexter/contracts';
import type { FastifyRequest } from 'fastify';
import { ZodValidationPipe } from '../../shared/validation/zod-validation.pipe';
import { CurrentAuth } from '../auth/current-auth.decorator';
import type { AuthContext } from '../auth/auth.types';
import { PricingService } from './pricing.service';

@ApiTags('accounting')
@Controller('prices')
export class PricesController {
  constructor(private readonly pricing: PricingService) {}

  @Get(':assetId')
  async list(@Param('assetId', new ParseUUIDPipe()) assetId: string): Promise<PricesResponse> {
    return { prices: await this.pricing.list(assetId) };
  }

  @Post(':assetId')
  set(
    @CurrentAuth() auth: AuthContext,
    @Param('assetId', new ParseUUIDPipe()) assetId: string,
    @Body(new ZodValidationPipe(setPriceRequestSchema)) body: SetPriceRequest,
    @Req() request: FastifyRequest,
  ): Promise<Price> {
    return this.pricing.set(auth.user.id, assetId, body, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }
}
