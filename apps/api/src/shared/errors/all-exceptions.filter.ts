import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import * as Sentry from '@sentry/node';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { safeErrorForTelemetry } from './safe-error';

const statusCodes: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'VALIDATION_ERROR',
  [HttpStatus.UNAUTHORIZED]: 'AUTH_REQUIRED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'VALIDATION_ERROR',
  [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMITED',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'INTERNAL_ERROR',
};

const contractCodes = new Set([
  'AUTH_REQUIRED',
  'INVALID_CREDENTIALS',
  'TOTP_REQUIRED',
  'TOTP_INVALID',
  'FORBIDDEN',
  'RATE_LIMITED',
  'VALIDATION_ERROR',
  'CONFLICT',
  'NOT_FOUND',
  'INSUFFICIENT_LOTS',
  'NEGATIVE_BALANCE',
  'IMPORT_PARSE_ERROR',
  'IMPORT_MAPPING_ERROR',
  'IMPORT_RECONCILIATION_FAILED',
  'IMPORT_CONFLICT',
  'SWAP_DISABLED',
  'SWAP_CHAIN_UNSUPPORTED',
  'SWAP_TOKEN_NOT_ALLOWED',
  'SWAP_QUOTE_FAILED',
  'SWAP_PROVIDER_ERROR',
  'SWAP_PROVIDER_UNAVAILABLE',
  'SWAP_RATE_LIMITED',
  'SWAP_VALIDATION_FAILED',
  'SWAP_PRICE_IMPACT_TOO_HIGH',
  'SWAP_STATE_INVALID',
  'SWAP_WALLET_NOT_ALLOWED',
  'SWAP_SELECTOR_NOT_CONFIGURED',
  'SWAP_BUILD_FAILED',
  'SWAP_SIMULATION_FAILED',
  'SWAP_STEP_UP_REQUIRED',
  'SWAP_APPROVAL_NOT_REQUIRED',
  'SWAP_APPROVAL_EXPIRED',
  'SWAP_RPC_NOT_CONFIGURED',
  'INTERNAL_ERROR',
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function contractCodeForStatus(status: number): string {
  if (status === HttpStatus.UNAUTHORIZED) return 'INVALID_CREDENTIALS';
  if (status === HttpStatus.FORBIDDEN) return 'FORBIDDEN';
  if (status === HttpStatus.NOT_FOUND) return 'NOT_FOUND';
  if (status === HttpStatus.CONFLICT) return 'CONFLICT';
  if (status === HttpStatus.TOO_MANY_REQUESTS) return 'RATE_LIMITED';
  if (status >= 500) return 'INTERNAL_ERROR';
  return 'VALIDATION_ERROR';
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const reply = context.getResponse<FastifyReply>();
    const request = context.getRequest<FastifyRequest>();
    const requestId = request.id || randomUUID();

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    let code = statusCodes[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR');
    let message = status >= 500 ? 'Internal server error' : 'Request failed';
    let details: unknown;

    if (exception instanceof HttpException) {
      const response = exception.getResponse();

      if (typeof response === 'string') {
        message = response;
      } else if (response && typeof response === 'object') {
        const record = response as Record<string, unknown>;

        if (typeof record.code === 'string') {
          code = record.code;
        }

        if (typeof record.message === 'string') {
          message = record.message;
        } else if (Array.isArray(record.message)) {
          code = 'VALIDATION_ERROR';
          message = 'Validation failed';
          details = record.message;
        }

        if (record.details !== undefined) {
          details = record.details;
        }
      }
    }

    if (!contractCodes.has(code)) {
      const reason = code;
      code = contractCodeForStatus(status);
      details = {
        ...(isPlainObject(details) ? details : {}),
        reason:
          isPlainObject(details) && typeof details.reason === 'string' ? details.reason : reason,
        ...(isPlainObject(details) || details === undefined ? {} : { originalDetails: details }),
      };
    }

    if (status >= 500) {
      const safe = safeErrorForTelemetry(exception);
      const expected = new Set([
        'SWAP_DISABLED',
        'SWAP_PROVIDER_UNAVAILABLE',
        'SWAP_QUOTE_FAILED',
        'SWAP_BUILD_FAILED',
        'SWAP_RATE_LIMITED',
        'SWAP_SELECTOR_NOT_CONFIGURED',
      ]);

      if (expected.has(code)) {
        this.logger.warn(safe.message);
      } else {
        Sentry.captureException(safe);
        this.logger.error(safe.message, safe.stack);
      }
    }

    if (request.url.startsWith('/api/v1/auth/')) {
      void reply.header('Cache-Control', 'no-store');
    }

    void reply.status(status).header('x-request-id', requestId).send({
      error: {
        code,
        message,
        details,
        requestId,
      },
    });
  }
}
