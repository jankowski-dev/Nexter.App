import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  DATABASE_URL: z.string().min(1).optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  SENTRY_DSN: z.preprocess((value) => (value === '' ? undefined : value), z.url().optional()),
});

const parsed = envSchema.parse(process.env);

if ((parsed.NODE_ENV === 'production' || parsed.NODE_ENV === 'staging') && !parsed.DATABASE_URL) {
  throw new Error('DATABASE_URL is required in production and staging');
}

export const env = {
  ...parsed,
  DATABASE_URL: parsed.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/nexter',
};
