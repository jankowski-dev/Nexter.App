import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CSRF_COOKIE, IS_PUBLIC_KEY, SKIP_CSRF_KEY } from './auth.constants';
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

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const skipCsrf = this.reflector.getAllAndOverride<boolean>(SKIP_CSRF_KEY, [
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
        code: 'CSRF_INVALID',
        message: 'Missing CSRF token',
      });
    }

    if (!this.crypto.safeEqual(headerToken, cookieToken)) {
      throw new ForbiddenException({
        code: 'CSRF_INVALID',
        message: 'CSRF token mismatch',
      });
    }

    if (
      !this.crypto.safeEqual(this.crypto.sha256(headerToken), request.auth.session.csrfTokenHash)
    ) {
      throw new ForbiddenException({
        code: 'CSRF_INVALID',
        message: 'CSRF token does not match the session',
      });
    }

    return true;
  }
}
