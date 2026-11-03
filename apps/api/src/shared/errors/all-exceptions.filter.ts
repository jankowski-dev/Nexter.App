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
      Sentry.captureException(exception);
      this.logger.error(
        exception instanceof Error ? exception.message : 'Unhandled exception',
        exception instanceof Error ? exception.stack : undefined,
      );
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
