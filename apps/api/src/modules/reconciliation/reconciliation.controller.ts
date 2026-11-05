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
  ReconciliationAddress,
  ReconciliationAddressCreate,
  ReconciliationIndexerStatusResponse,
  ReconciliationRun,
  ReconciliationRunRequest,
  ReconciliationRunsQuery,
} from '@nexter/contracts';
import {
  reconciliationAddressCreateSchema,
  reconciliationRunsQuerySchema,
  reconciliationRunRequestSchema,
} from '@nexter/contracts';
import type { FastifyRequest } from 'fastify';
import { ZodValidationPipe } from '../../shared/validation/zod-validation.pipe';
import { CurrentAuth } from '../auth/current-auth.decorator';
import type { AuthContext } from '../auth/auth.types';
import { ReconciliationService } from './reconciliation.service';

@ApiTags('reconciliation')
@Controller('reconciliation')
export class ReconciliationController {
  constructor(private readonly reconciliation: ReconciliationService) {}

  @Get('addresses')
  async addresses(@CurrentAuth() auth: AuthContext): Promise<{ data: ReconciliationAddress[] }> {
    return { data: await this.reconciliation.addresses(auth.user.id) };
  }

  @Post('addresses')
  @HttpCode(HttpStatus.CREATED)
  addAddress(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(reconciliationAddressCreateSchema))
    body: ReconciliationAddressCreate,
    @Req() request: FastifyRequest,
  ): Promise<ReconciliationAddress> {
    return this.reconciliation.addAddress(auth.user.id, body, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  @Get('runs')
  async runs(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(reconciliationRunsQuerySchema)) query: ReconciliationRunsQuery,
  ): Promise<{ data: ReconciliationRun[] }> {
    return { data: await this.reconciliation.listRuns(auth.user.id, query) };
  }

  @Get('runs/:id')
  run(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ReconciliationRun> {
    return this.reconciliation.getRun(auth.user.id, id);
  }

  @Post('run')
  @HttpCode(HttpStatus.CREATED)
  runNow(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(reconciliationRunRequestSchema)) body: ReconciliationRunRequest,
    @Req() request: FastifyRequest,
  ): Promise<ReconciliationRun> {
    return this.reconciliation.run(auth.user.id, body, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  @Get('indexer')
  async indexer(@CurrentAuth() auth: AuthContext): Promise<ReconciliationIndexerStatusResponse> {
    return { data: await this.reconciliation.indexerStatus(auth.user.id) };
  }
}
