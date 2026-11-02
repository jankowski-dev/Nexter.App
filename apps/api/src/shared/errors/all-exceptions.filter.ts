import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import * as Sentry from '@sentry/node';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const reply = context.getResponse<FastifyReply>();
    const request = context.getRequest<FastifyRequest>();
    const requestId = request.id || randomUUID();

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    let code = status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR';
    let message = status >= 500 ? 'Internal server error' : 'Request failed';
    let details: unknown;

    if (status === HttpStatus.SERVICE_UNAVAILABLE) {
      code = 'SERVICE_UNAVAILABLE';
    }

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

    if (status >= 500) {
      Sentry.captureException(exception);
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
