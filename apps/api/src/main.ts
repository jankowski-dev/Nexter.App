import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import compress from '@fastify/compress';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import * as Sentry from '@sentry/node';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { env } from './shared/config/env';
import { AllExceptionsFilter } from './shared/errors/all-exceptions.filter';

async function bootstrap(): Promise<void> {
  if (env.SENTRY_DSN) {
    Sentry.init({
      dsn: env.SENTRY_DSN,
      environment: env.NODE_ENV,
      tracesSampleRate: 0.1,
    });
  }

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: true }),
    { bufferLogs: true },
  );

  app.useLogger(app.get(Logger));

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
      },
    },
  });
  await app.register(compress as any);
  await app.register(cookie as any);

  app.setGlobalPrefix('api/v1', { exclude: ['health', 'ready'] });
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();

  const webDistPath = env.WEB_DIST_PATH ?? join(__dirname, '..', 'public');
  const indexPath = join(webDistPath, 'index.html');

  if (existsSync(indexPath)) {
    const fastify = app.getHttpAdapter().getInstance();

    await app.register(fastifyStatic as any, {
      root: webDistPath,
      prefix: '/',
    });

    fastify.setNotFoundHandler((request, reply) => {
      if (
        request.url.startsWith('/api/') ||
        request.url === '/health' ||
        request.url === '/ready'
      ) {
        void reply.code(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'Not found',
            requestId: request.id,
          },
        });
        return;
      }

      void (reply as any).sendFile('index.html');
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
