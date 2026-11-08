// The API image serves the built SPA from apps/web/dist. Keep apps/web/** and
// packages/** in the Railway API watch patterns, otherwise frontend-only merges
// are reported as "No deployment needed" and production keeps the old bundle.
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import * as Sentry from '@sentry/node';
import type { FastifyReply } from 'fastify';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { registerImportAuthHook } from './modules/imports/import-auth.hook';
import { registerNotionImportBodyParser } from './modules/imports/import-body-parser';
import { env } from './shared/config/env';
import { parseTrustProxy } from './shared/config/trust-proxy';
import { AllExceptionsFilter } from './shared/errors/all-exceptions.filter';
import { safeErrorForTelemetry } from './shared/errors/safe-error';
import { CONTENT_SECURITY_POLICY, HELMET_CSP_DIRECTIVES } from './shared/security/csp';
import { scrubSentryBreadcrumb, scrubSentryEvent } from './shared/security/sentry';

async function bootstrap(): Promise<void> {
  if (env.SENTRY_DSN) {
    Sentry.init({
      dsn: env.SENTRY_DSN,
      environment: env.NODE_ENV,
      tracesSampleRate: 0.1,
      beforeSend: (event) => scrubSentryEvent(event) as typeof event,
      beforeBreadcrumb: scrubSentryBreadcrumb,
    });
  }

  const trustProxy = parseTrustProxy(env.TRUST_PROXY);

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy }),
    { bufferLogs: true },
  );

  app.useLogger(app.get(Logger));

  const fastify = app.getHttpAdapter().getInstance();

  registerNotionImportBodyParser(fastify);

  fastify.addHook('onSend', (request, reply, payload, done) => {
    void reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

    if (request.url.startsWith('/api/v1/')) {
      void reply.header('Cache-Control', 'no-store');
    }

    done(null, payload);
  });

  interface RateBucket {
    count: number;
    resetAt: number;
  }

  const rateBuckets = new Map<string, RateBucket>();

  fastify.addHook('onRequest', async (request, reply) => {
    const now = Date.now();
    const url = request.url.split('?')[0] ?? '/';
    const isMutation = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
    const isAuthAttempt =
      url === '/api/v1/auth/login' ||
      url.startsWith('/api/v1/auth/2fa/') ||
      url.startsWith('/api/v1/auth/recovery/');
    const max = isAuthAttempt ? (env.NODE_ENV === 'test' ? 100 : 10) : isMutation ? 60 : 300;
    const bucketKey = `${request.ip}:${isAuthAttempt ? 'auth' : isMutation ? 'mutation' : 'read'}`;
    let bucket = rateBuckets.get(bucketKey);

    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + 60_000 };
      rateBuckets.set(bucketKey, bucket);
    }

    bucket.count += 1;

    if (bucket.count > max) {
      reply.header('retry-after', Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)));
      reply.header('cache-control', 'no-store');
      reply.header('x-frame-options', 'DENY');
      reply.header('x-content-type-options', 'nosniff');
      reply.header('referrer-policy', 'strict-origin-when-cross-origin');
      reply.header('permissions-policy', 'camera=(), microphone=(), geolocation=()');
      reply.header('strict-transport-security', 'max-age=15552000; includeSubDomains');
      reply.header('content-security-policy', CONTENT_SECURITY_POLICY);
      await reply.code(429).send({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests. Try again later.',
          requestId: request.id,
        },
      });
      return;
    }

    if (rateBuckets.size > 10_000) {
      for (const [key, value] of rateBuckets) {
        if (value.resetAt <= now) {
          rateBuckets.delete(key);
        }
      }
    }
  });

  await app.register(helmet as any, {
    contentSecurityPolicy: {
      directives: HELMET_CSP_DIRECTIVES,
    },
    xFrameOptions: { action: 'deny' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  });
  await app.register(cookie as any);
  registerImportAuthHook(app, fastify);

  app.setGlobalPrefix('api/v1', { exclude: ['health', 'ready'] });
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();

  const webDistPath = resolve(env.WEB_DIST_PATH ?? join(__dirname, '..', 'public'));
  const hasWebBuild = existsSync(join(webDistPath, 'index.html'));

  if (hasWebBuild) {
    fastify.addHook('onRequest', (request, _reply, done) => {
      const url = request.url.split('?')[0] ?? '/';
      const isAsset = extname(url) !== '';

      if (
        (request.method === 'GET' || request.method === 'HEAD') &&
        !url.startsWith('/api/') &&
        url !== '/health' &&
        url !== '/ready' &&
        !isAsset
      ) {
        request.raw.url = '/index.html';
      }

      done();
    });

    await app.register(fastifyStatic as any, {
      root: webDistPath,
      prefix: '/',
      cacheControl: true,
      maxAge: '1y',
      immutable: true,
      setHeaders: (reply: FastifyReply, filePath: string) => {
        if (filePath.endsWith('index.html')) {
          void reply.header('Cache-Control', 'no-cache');
        }
      },
    });
  }

  if (env.ENABLE_DOCS && (env.NODE_ENV === 'development' || env.NODE_ENV === 'test')) {
    const config = new DocumentBuilder()
      .setTitle('Nexter API')
      .setDescription('Private personal finance API')
      .setVersion(env.VERSION)
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
}

bootstrap().catch((error) => {
  const safe = safeErrorForTelemetry(error);
  console.error(safe.message);
  process.exit(1);
});
