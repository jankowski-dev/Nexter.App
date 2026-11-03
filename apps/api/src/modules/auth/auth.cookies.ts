import type { FastifyReply } from 'fastify';
import { env } from '../../shared/config/env';
import { CSRF_COOKIE, SESSION_COOKIE } from './auth.constants';
import type { SessionTokens } from './session.service';

function cookieOptions() {
  return authCookieOptions(env.NODE_ENV, env.SESSION_TTL_DAYS);
}

export function authCookieOptions(nodeEnv: string, ttlDays: number) {
  return {
    secure: nodeEnv === 'production' || nodeEnv === 'staging',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: ttlDays * 86_400,
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
