import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1).default('postgres://postgres:postgres@localhost:5432/nexter'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  SENTRY_DSN: z.preprocess((value) => (value === '' ? undefined : value), z.url().optional()),
  APP_URL: z.url().default('http://localhost:5173'),
  SETUP_TOKEN: z.string().min(1).optional(),
  WEB_DIST_PATH: z.string().optional(),
  ENABLE_DOCS: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  VERSION: z.string().default('0.1.0'),
});

export const env = envSchema.parse(process.env);
export type Env = typeof env;
