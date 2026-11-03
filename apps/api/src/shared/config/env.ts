import { loadRootEnv } from '@nexter/config';
import { z } from 'zod';

loadRootEnv();

const emptyToUndefined = (value: unknown) => (value === '' ? undefined : value);

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  SENTRY_DSN: z.preprocess(emptyToUndefined, z.url().optional()),
  APP_URL: z.preprocess(emptyToUndefined, z.url().optional()),
  SETUP_TOKEN: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  AUTH_ENCRYPTION_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  TOTP_ISSUER: z.string().min(1).default('Nexter'),
  WEB_DIST_PATH: z.preprocess(emptyToUndefined, z.string().optional()),
  TRUST_PROXY: z.preprocess(emptyToUndefined, z.string().default('false')),
  ENABLE_DOCS: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  VERSION: z.string().default('0.1.0'),
});

export type ParsedEnv = z.infer<typeof envSchema>;

export function parseEnv(raw: Record<string, string | undefined>) {
  const parsed = envSchema.parse(raw);

  if (parsed.NODE_ENV === 'production' || parsed.NODE_ENV === 'staging') {
    if (!parsed.DATABASE_URL) {
      throw new Error('DATABASE_URL is required in production and staging');
    }
    if (!parsed.SETUP_TOKEN) {
      throw new Error('SETUP_TOKEN is required in production and staging');
    }
    if (!parsed.AUTH_ENCRYPTION_KEY) {
      throw new Error('AUTH_ENCRYPTION_KEY is required in production and staging');
    }
    if (!parsed.APP_URL) {
      throw new Error('APP_URL is required in production and staging');
    }
  }

  return {
    ...parsed,
    DATABASE_URL: parsed.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/nexter',
    APP_URL: parsed.APP_URL ?? 'http://localhost:5173',
  };
}

export const env = parseEnv(process.env);
export type Env = typeof env;
