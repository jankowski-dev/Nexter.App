import { createParamDecorator, type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { RequestWithAuth } from './auth.types';

export const CurrentAuth = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<RequestWithAuth>();

  if (!request.auth) {
    throw new UnauthorizedException({
      code: 'AUTH_REQUIRED',
      message: 'Authentication required',
    });
  }

  return request.auth;
});
