import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { env } from '../../shared/config/env';
import { checkSameOrigin } from '../../shared/security/origin';
import {
  CSRF_COOKIE,
  IS_PUBLIC_METADATA,
  SKIP_CSRF_METADATA,
  SKIP_ORIGIN_METADATA,
} from './auth.constants';
import type { RequestWithAuth } from './auth.types';
import { CryptoService } from './crypto.service';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly crypto: CryptoService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithAuth>();

    if (SAFE_METHODS.has(request.method)) {
      return true;
    }

    const skipOrigin = this.reflector.getAllAndOverride<boolean>(SKIP_ORIGIN_METADATA, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!skipOrigin) this.assertSameOrigin(request);

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_METADATA, [
      context.getHandler(),
      context.getClass(),
    ]);
    const skipCsrf = this.reflector.getAllAndOverride<boolean>(SKIP_CSRF_METADATA, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic || skipCsrf) {
      return true;
    }

    if (!request.auth) {
      throw new UnauthorizedException({
        code: 'AUTH_REQUIRED',
        message: 'Authentication required',
      });
    }

    const headerToken = request.headers['x-csrf-token'];
    const cookieToken = request.cookies?.[CSRF_COOKIE];

    if (typeof headerToken !== 'string' || typeof cookieToken !== 'string') {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Missing CSRF token',
        details: { reason: 'CSRF_MISSING' },
      });
    }

    if (!this.crypto.safeEqual(headerToken, cookieToken)) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'CSRF token mismatch',
        details: { reason: 'CSRF_MISMATCH' },
      });
    }

    if (
      !this.crypto.safeEqual(this.crypto.sha256(headerToken), request.auth.session.csrfTokenHash)
    ) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'CSRF token does not match the session',
        details: { reason: 'CSRF_SESSION_MISMATCH' },
      });
    }

    return true;
  }

  private assertSameOrigin(request: RequestWithAuth): void {
    const result = checkSameOrigin({
      origin: typeof request.headers.origin === 'string' ? request.headers.origin : undefined,
      referer: typeof request.headers.referer === 'string' ? request.headers.referer : undefined,
      expected: new URL(env.APP_URL).origin,
      requireOrigin: env.NODE_ENV === 'production' || env.NODE_ENV === 'staging',
    });

    if (result !== 'ok') {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Cross-origin request rejected',
        details: { reason: result === 'missing' ? 'ORIGIN_MISSING' : 'ORIGIN_MISMATCH' },
      });
    }
  }
}
