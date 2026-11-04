import type { INestApplication } from '@nestjs/common';
import type { FastifyInstance } from 'fastify';
import { createHash, timingSafeEqual } from 'node:crypto';
import { env } from '../../shared/config/env';
import { CSRF_COOKIE, SESSION_COOKIE } from '../auth/auth.constants';
import { SessionService } from '../auth/session.service';

const IMPORT_PREVIEW_PATH = '/api/v1/imports/notion/preview';

function sameToken(left: string, right: string): boolean {
  const leftDigest = createHash('sha256').update(left).digest();
  const rightDigest = createHash('sha256').update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function errorEnvelope(requestId: string, code: string, message: string) {
  return { error: { code, message, requestId } };
}

/**
 * Authenticate the large import body before Fastify parses it.
 *
 * Nest guards run after body parsing, so this hook is the only place where an
 * unauthenticated 10 MiB payload can be rejected before it allocates buffers.
 * It intentionally duplicates the session/CSRF checks for this one route.
 */
export function registerImportAuthHook(app: INestApplication, fastify: FastifyInstance): void {
  const sessions = app.get(SessionService);

  fastify.addHook('onRequest', async (request, reply) => {
    const url = request.url.split('?')[0] ?? '/';

    if (request.method !== 'POST' || url !== IMPORT_PREVIEW_PATH) {
      return;
    }

    const token = request.cookies?.[SESSION_COOKIE];
    const auth = token
      ? await sessions.resolve(token, {
          ip: request.ip,
          userAgent:
            typeof request.headers['user-agent'] === 'string'
              ? request.headers['user-agent']
              : undefined,
        })
      : null;

    if (!auth) {
      await reply
        .code(401)
        .send(errorEnvelope(request.id, 'AUTH_REQUIRED', 'Authentication required'));
      return;
    }

    if (!auth.session.twoFactorVerified) {
      await reply
        .code(403)
        .send(errorEnvelope(request.id, 'TOTP_REQUIRED', 'Two-factor authentication is required'));
      return;
    }

    const origin = request.headers.origin;
    const referer = request.headers.referer;
    let actualOrigin: string | undefined;

    if (typeof origin === 'string') {
      actualOrigin = origin;
    } else if (typeof referer === 'string') {
      try {
        actualOrigin = new URL(referer).origin;
      } catch {
        actualOrigin = undefined;
      }
    }

    if (actualOrigin && actualOrigin !== new URL(env.APP_URL).origin) {
      await reply
        .code(403)
        .send(errorEnvelope(request.id, 'FORBIDDEN', 'Cross-origin request rejected'));
      return;
    }

    const headerToken = request.headers['x-csrf-token'];
    const cookieToken = request.cookies?.[CSRF_COOKIE];

    if (
      typeof headerToken !== 'string' ||
      typeof cookieToken !== 'string' ||
      !sameToken(headerToken, cookieToken) ||
      !sameToken(createHash('sha256').update(headerToken).digest('hex'), auth.session.csrfTokenHash)
    ) {
      await reply
        .code(403)
        .send(errorEnvelope(request.id, 'FORBIDDEN', 'Missing or invalid CSRF token'));
    }
  });
}
