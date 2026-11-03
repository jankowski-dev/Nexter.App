import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type {
  ManualTransactionRequest,
  ManualTransactionResponse,
  Transaction,
  TransactionsResponse,
} from '@nexter/contracts';
import { manualTransactionRequestSchema } from '@nexter/contracts';
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
  async list(@CurrentAuth() auth: AuthContext): Promise<TransactionsResponse> {
    return { transactions: await this.ledger.list(auth.user.id) };
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
