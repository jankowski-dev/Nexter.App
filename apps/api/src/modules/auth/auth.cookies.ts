import type { FastifyReply } from 'fastify';
import { env } from '../../shared/config/env';
import { CSRF_COOKIE, SESSION_COOKIE } from './auth.constants';
import type { SessionTokens } from './session.service';

function cookieOptions() {
  return {
    secure: env.NODE_ENV === 'production' || env.NODE_ENV === 'staging',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: env.SESSION_TTL_DAYS * 86_400,
  };
}

export function setAuthCookies(reply: FastifyReply, tokens: SessionTokens): void {
  reply.setCookie(SESSION_COOKIE, tokens.token, {
    ...cookieOptions(),
    httpOnly: true,
  });
  reply.setCookie(CSRF_COOKIE, tokens.csrfToken, {
    ...cookieOptions(),
    httpOnly: false,
  });
}

export function clearAuthCookies(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
  reply.clearCookie(CSRF_COOKIE, { path: '/' });
}
