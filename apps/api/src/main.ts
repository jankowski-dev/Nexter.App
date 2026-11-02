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
import { env } from './shared/config/env';
import { AllExceptionsFilter } from './shared/errors/all-exceptions.filter';
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

  const trustProxy =
    env.TRUST_PROXY === 'false' ? false : env.TRUST_PROXY === 'true' ? true : env.TRUST_PROXY;

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy }),
    { bufferLogs: true },
  );

  app.useLogger(app.get(Logger));

  const fastify = app.getHttpAdapter().getInstance();

  fastify.addHook('onSend', (_request, reply, payload, done) => {
    void reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    done(null, payload);
  });

  await app.register(helmet as any, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        fontSrc: ["'self'", 'https:', 'data:'],
        imgSrc: ["'self'", 'data:', 'https:'],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    xFrameOptions: { action: 'deny' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  });
  await app.register(cookie as any);

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

  if (env.ENABLE_DOCS && env.NODE_ENV !== 'production') {
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
  console.error(error);
  process.exit(1);
});
