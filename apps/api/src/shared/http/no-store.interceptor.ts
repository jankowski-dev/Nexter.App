import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Observable } from 'rxjs';
import { apiCacheControl } from './cache-control';

@Injectable()
export class NoStoreInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const reply = context.switchToHttp().getResponse<FastifyReply>();

    const cacheControl = apiCacheControl(request.url);
    if (cacheControl) {
      void reply.header('Cache-Control', cacheControl);
    }

    return next.handle();
  }
}
