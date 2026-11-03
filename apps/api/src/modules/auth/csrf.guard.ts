import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { env } from '../../shared/config/env';
import { CSRF_COOKIE, IS_PUBLIC_METADATA, SKIP_CSRF_METADATA } from './auth.constants';
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

    this.assertSameOrigin(request);

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
    const origin = request.headers.origin;
    const referer = request.headers.referer;
    const expected = new URL(env.APP_URL).origin;

    let actual: string | undefined;

    if (typeof origin === 'string') {
      actual = origin;
    } else if (typeof referer === 'string') {
      try {
        actual = new URL(referer).origin;
      } catch {
        actual = undefined;
      }
    }

    if (actual && actual !== expected) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Cross-origin request rejected',
        details: { reason: 'ORIGIN_MISMATCH' },
      });
    }
  }
}
