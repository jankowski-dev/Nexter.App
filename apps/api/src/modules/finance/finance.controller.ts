import {
  Body,
  Controller,
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
  FinanceAccountCreateRequest,
  FinanceAccountUpdateRequest,
  FinanceAccountsResponse,
  FinanceCategoryCreateRequest,
  FinanceCategoryUpdateRequest,
  FinanceCategoriesResponse,
  FinanceCreditDrawdownRequest,
  FinanceCreditDrawdownResponse,
  FinanceImport,
  FinanceImportRequest,
  FinanceImportsResponse,
  FinanceJournalResponse,
  FinanceListQuery,
  FinanceSummary,
  FinanceSummaryQuery,
  FinanceTransactionCreateRequest,
  FinanceTransactionUpdateRequest,
  FinanceTransactionsResponse,
  FinanceTransferCreateRequest,
  FinanceTransfersResponse,
  FinanceTransferUpdateRequest,
} from '@nexter/contracts';
import {
  financeAccountCreateRequestSchema,
  financeAccountUpdateRequestSchema,
  financeCategoryCreateRequestSchema,
  financeCategoryUpdateRequestSchema,
  financeCreditDrawdownRequestSchema,
  financeImportRequestSchema,
  financeListQuerySchema,
  financeSummaryQuerySchema,
  financeTransactionCreateRequestSchema,
  financeTransactionUpdateRequestSchema,
  financeTransferCreateRequestSchema,
  financeTransferUpdateRequestSchema,
} from '@nexter/contracts';
import type { FastifyRequest } from 'fastify';
import { ZodValidationPipe } from '../../shared/validation/zod-validation.pipe';
import { CurrentAuth } from '../auth/current-auth.decorator';
import type { AuthContext } from '../auth/auth.types';
import { FinanceImportService } from './finance-import.service';
import { FinanceService } from './finance.service';

function meta(request: FastifyRequest) {
  return {
    ip: request.ip,
    userAgent: request.headers['user-agent'],
  };
}

@ApiTags('finance')
@Controller('finance')
export class FinanceController {
  constructor(
    private readonly finance: FinanceService,
    private readonly financeImport: FinanceImportService,
  ) {}

  @Get('accounts')
  accounts(@CurrentAuth() auth: AuthContext): Promise<FinanceAccountsResponse> {
    return this.finance.listAccounts(auth.user.id);
  }

  @Post('accounts')
  createAccount(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(financeAccountCreateRequestSchema))
    body: FinanceAccountCreateRequest,
    @Req() request: FastifyRequest,
  ) {
    return this.finance.createAccount(auth.user.id, body, meta(request));
  }

  @Patch('accounts/:id')
  updateAccount(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(financeAccountUpdateRequestSchema))
    body: FinanceAccountUpdateRequest,
    @Req() request: FastifyRequest,
  ) {
    return this.finance.updateAccount(auth.user.id, id, body, meta(request));
  }

  @Get('categories')
  categories(@CurrentAuth() auth: AuthContext): Promise<FinanceCategoriesResponse> {
    return this.finance.listCategories(auth.user.id);
  }

  @Post('categories')
  createCategory(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(financeCategoryCreateRequestSchema))
    body: FinanceCategoryCreateRequest,
    @Req() request: FastifyRequest,
  ) {
    return this.finance.createCategory(auth.user.id, body, meta(request));
  }

  @Patch('categories/:id')
  updateCategory(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(financeCategoryUpdateRequestSchema))
    body: FinanceCategoryUpdateRequest,
    @Req() request: FastifyRequest,
  ) {
    return this.finance.updateCategory(auth.user.id, id, body, meta(request));
  }

  @Get('transactions')
  transactions(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(financeListQuerySchema)) query: FinanceListQuery,
  ): Promise<FinanceTransactionsResponse> {
    return this.finance.listTransactions(auth.user.id, query);
  }

  @Post('transactions')
  createTransaction(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(financeTransactionCreateRequestSchema))
    body: FinanceTransactionCreateRequest,
    @Req() request: FastifyRequest,
  ) {
    return this.finance.createTransaction(auth.user.id, body, meta(request));
  }

  @Patch('transactions/:id')
  updateTransaction(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(financeTransactionUpdateRequestSchema))
    body: FinanceTransactionUpdateRequest,
    @Req() request: FastifyRequest,
  ) {
    return this.finance.updateTransaction(auth.user.id, id, body, meta(request));
  }

  @Get('transfers')
  transfers(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(financeListQuerySchema)) query: FinanceListQuery,
  ): Promise<FinanceTransfersResponse> {
    return this.finance.listTransfers(auth.user.id, query);
  }

  @Post('transfers')
  createTransfer(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(financeTransferCreateRequestSchema))
    body: FinanceTransferCreateRequest,
    @Req() request: FastifyRequest,
  ) {
    return this.finance.createTransfer(auth.user.id, body, meta(request));
  }

  @Patch('transfers/:id')
  updateTransfer(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(financeTransferUpdateRequestSchema))
    body: FinanceTransferUpdateRequest,
    @Req() request: FastifyRequest,
  ) {
    return this.finance.updateTransfer(auth.user.id, id, body, meta(request));
  }

  @Get('journal')
  journal(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(financeListQuerySchema)) query: FinanceListQuery,
  ): Promise<FinanceJournalResponse> {
    return this.finance.journal(auth.user.id, query);
  }

  @Get('summary')
  summary(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(financeSummaryQuerySchema)) query: FinanceSummaryQuery,
  ): Promise<FinanceSummary> {
    return this.finance.summary(auth.user.id, query);
  }

  @Post('credits/drawdown')
  creditDrawdown(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(financeCreditDrawdownRequestSchema))
    body: FinanceCreditDrawdownRequest,
    @Req() request: FastifyRequest,
  ): Promise<FinanceCreditDrawdownResponse> {
    return this.finance.creditDrawdown(auth.user.id, body, meta(request));
  }

  @Get('imports')
  imports(@CurrentAuth() auth: AuthContext): Promise<FinanceImportsResponse> {
    return this.financeImport.list(auth.user.id);
  }

  @Post('import/preview')
  importPreview(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(financeImportRequestSchema)) body: FinanceImportRequest,
    @Req() request: FastifyRequest,
  ): Promise<FinanceImport> {
    return this.financeImport.preview(auth.user.id, body, meta(request));
  }

  @Post('import/:id/commit')
  importCommit(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: FastifyRequest,
  ): Promise<FinanceImport> {
    return this.financeImport.commit(auth.user.id, id, meta(request));
  }

  @Post('import/:id/rollback')
  importRollback(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: FastifyRequest,
  ): Promise<FinanceImport> {
    return this.financeImport.rollback(auth.user.id, id, meta(request));
  }
}
