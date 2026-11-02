import * as Sentry from '@sentry/node';
import { PgBoss } from 'pg-boss';
import { env } from './config.js';
import { logger } from './logger.js';

async function main(): Promise<void> {
  if (env.SENTRY_DSN) {
    Sentry.init({
      dsn: env.SENTRY_DSN,
      environment: env.NODE_ENV,
      tracesSampleRate: 0.1,
    });
  }

  const boss = new PgBoss({
    connectionString: env.DATABASE_URL,
  });

  boss.on('error', (error) => {
    logger.error({ error }, 'pg-boss error');
    Sentry.captureException(error);
  });

  await boss.start();
  logger.info('Nexter worker started');

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutting down worker');
    await boss.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  logger.fatal({ error }, 'Worker failed to start');
  Sentry.captureException(error);
  process.exit(1);
});
