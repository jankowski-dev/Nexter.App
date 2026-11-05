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
  ApprovalBuildRequest,
  ApprovalBuildResponse,
  ApprovalSubmittedRequest,
  ApprovalsQuery,
  ApprovalsResponse,
  SwapBuildRequest,
  SwapBuildResponse,
  SwapConfigResponse,
  SwapOrderDetail,
  SwapOrdersQuery,
  SwapOrdersResponse,
  SwapQuoteRequest,
  SwapSubmitRequest,
  TokenApproval,
} from '@nexter/contracts';
import {
  approvalBuildRequestSchema,
  approvalSubmittedRequestSchema,
  approvalsQuerySchema,
  swapBuildRequestSchema,
  swapOrdersQuerySchema,
  swapQuoteRequestSchema,
  swapSubmitRequestSchema,
} from '@nexter/contracts';
import type { FastifyRequest } from 'fastify';
import { ZodValidationPipe } from '../../shared/validation/zod-validation.pipe';
import { CurrentAuth } from '../auth/current-auth.decorator';
import type { AuthContext } from '../auth/auth.types';
import { ApprovalService } from './approval.service';
import { SwapService } from './swap.service';

@ApiTags('swap')
@Controller('swap')
export class SwapController {
  constructor(
    private readonly swaps: SwapService,
    private readonly approvals: ApprovalService,
  ) {}

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
    return this.swaps.build(auth, body, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  @Post('orders/:id/ready')
  @HttpCode(HttpStatus.OK)
  ready(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: FastifyRequest,
  ): Promise<SwapBuildResponse> {
    return this.swaps.ready(auth, id, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  @Post('orders/:id/signing')
  @HttpCode(HttpStatus.OK)
  signing(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: FastifyRequest,
  ): Promise<SwapOrderDetail> {
    return this.swaps.signing(auth, id, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  @Post('orders/:id/signing/cancel')
  @HttpCode(HttpStatus.OK)
  cancelSigning(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: FastifyRequest,
  ): Promise<SwapOrderDetail> {
    return this.swaps.cancelSigning(auth, id, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  @Post('orders/:id/submitted')
  @HttpCode(HttpStatus.OK)
  submit(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(swapSubmitRequestSchema)) body: SwapSubmitRequest,
    @Req() request: FastifyRequest,
  ): Promise<SwapOrderDetail> {
    return this.swaps.submit(auth, id, body, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  @Get('approvals')
  approvalsList(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(approvalsQuerySchema)) query: ApprovalsQuery,
  ): Promise<ApprovalsResponse> {
    return this.approvals.list(auth.user.id, query);
  }

  @Post('approvals/build')
  @HttpCode(HttpStatus.CREATED)
  approvalBuild(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(approvalBuildRequestSchema))
    body: ApprovalBuildRequest,
    @Req() request: FastifyRequest,
  ): Promise<ApprovalBuildResponse> {
    return this.approvals.build(auth, body.orderId, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  @Post('approvals/:id/submitted')
  @HttpCode(HttpStatus.OK)
  approvalSubmitted(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(approvalSubmittedRequestSchema))
    body: ApprovalSubmittedRequest,
    @Req() request: FastifyRequest,
  ): Promise<TokenApproval> {
    return this.approvals.submitted(auth.user.id, id, body.txHash, {
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
