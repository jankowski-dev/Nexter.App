import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type {
  ManualTransactionRequest,
  ManualTransactionResponse,
  Transaction,
  TransactionsListQuery,
  TransactionsPageResponse,
} from '@nexter/contracts';
import { manualTransactionRequestSchema, transactionsListQuerySchema } from '@nexter/contracts';
import type { FastifyRequest } from 'fastify';
import { ZodValidationPipe } from '../../shared/validation/zod-validation.pipe';
import { CurrentAuth } from '../auth/current-auth.decorator';
import type { AuthContext } from '../auth/auth.types';
import { LedgerService } from './ledger.service';

@ApiTags('accounting')
@Controller('transactions')
export class TransactionsController {
  constructor(private readonly ledger: LedgerService) {}

  @Get()
  list(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(transactionsListQuerySchema))
    query: TransactionsListQuery,
  ): Promise<TransactionsPageResponse> {
    return this.ledger.list(auth.user.id, query);
  }

  @Get(':id')
  get(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<Transaction> {
    return this.ledger.get(auth.user.id, id);
  }

  @Post()
  create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(manualTransactionRequestSchema))
    body: ManualTransactionRequest,
    @Req() request: FastifyRequest,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<ManualTransactionResponse> {
    return this.ledger.createManual(
      auth.user.id,
      body,
      {
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      },
      idempotencyKey?.slice(0, 200),
    );
  }
}
