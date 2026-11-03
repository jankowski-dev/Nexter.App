import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ALLOW_PENDING_2FA_METADATA, IS_PUBLIC_METADATA } from './auth.constants';
import type { RequestWithAuth } from './auth.types';

@Injectable()
export class TwoFactorGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_METADATA, [
      context.getHandler(),
      context.getClass(),
    ]);
    const allowPending = this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_2FA_METADATA, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic || allowPending) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithAuth>();

    if (!request.auth?.session.twoFactorVerified) {
      throw new ForbiddenException({
        code: 'TOTP_REQUIRED',
        message: 'Two-factor authentication is required',
      });
    }

    return true;
  }
}
