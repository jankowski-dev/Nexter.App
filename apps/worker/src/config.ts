import { loadRootEnv } from '@nexter/config';
import { z } from 'zod';

loadRootEnv();

const emptyToUndefined = (value: unknown) => (value === '' ? undefined : value);

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  DATABASE_URL: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  SENTRY_DSN: z.preprocess(emptyToUndefined, z.url().optional()),
});

export type ParsedEnv = z.infer<typeof envSchema>;

export function parseEnv(raw: Record<string, string | undefined>) {
  const parsed = envSchema.parse(raw);

  if ((parsed.NODE_ENV === 'production' || parsed.NODE_ENV === 'staging') && !parsed.DATABASE_URL) {
    throw new Error('DATABASE_URL is required in production and staging');
  }

  return {
    ...parsed,
    DATABASE_URL: parsed.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/nexter',
  };
}

export const env = parseEnv(process.env);
