import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_METADATA, SESSION_COOKIE } from './auth.constants';
import type { RequestWithAuth } from './auth.types';
import { SessionService } from './session.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_METADATA, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    const token = request.cookies?.[SESSION_COOKIE];

    if (!token) {
      throw new UnauthorizedException({
        code: 'AUTH_REQUIRED',
        message: 'Authentication required',
      });
    }

    const userAgent = request.headers['user-agent'];
    const auth = await this.sessions.resolve(token, {
      ip: request.ip,
      userAgent: typeof userAgent === 'string' ? userAgent : undefined,
    });

    if (!auth) {
      throw new UnauthorizedException({
        code: 'AUTH_REQUIRED',
        message: 'Session is invalid or expired',
      });
    }

    request.auth = auth;
    return true;
  }
}
