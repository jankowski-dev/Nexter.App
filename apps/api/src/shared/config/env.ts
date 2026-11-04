import { loadRootEnv } from '@nexter/config';
import { z } from 'zod';

loadRootEnv();

const emptyToUndefined = (value: unknown) => (value === '' ? undefined : value);

export function isValidAuthEncryptionKey(value: string): boolean {
  if (/^[0-9a-f]{64}$/i.test(value)) {
    return true;
  }

  return Buffer.from(value, 'base64').length === 32;
}

function decodeAuthEncryptionKey(value: string): Buffer {
  return /^[0-9a-f]{64}$/i.test(value) ? Buffer.from(value, 'hex') : Buffer.from(value, 'base64');
}

function isWeakAuthEncryptionKey(value: string): boolean {
  const bytes = decodeAuthEncryptionKey(value);

  if (bytes.length !== 32) return true;

  return bytes.every((byte) => byte === bytes[0]);
}

const authEncryptionKeySchema = z
  .string()
  .min(1)
  .refine(
    isValidAuthEncryptionKey,
    'AUTH_ENCRYPTION_KEY must be 32 bytes as base64 or 64 hex chars',
  );

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  SENTRY_DSN: z.preprocess(emptyToUndefined, z.url().optional()),
  APP_URL: z.preprocess(emptyToUndefined, z.url().optional()),
  SETUP_TOKEN: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  AUTH_ENCRYPTION_KEY: z.preprocess(emptyToUndefined, authEncryptionKeySchema.optional()),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  TOTP_ISSUER: z.string().min(1).default('Nexter'),
  WEB_DIST_PATH: z.preprocess(emptyToUndefined, z.string().optional()),
  TRUST_PROXY: z.preprocess(emptyToUndefined, z.string().default('false')),
  ENABLE_DOCS: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  SWAP_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  SWAP_KILL_SWITCH: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  SWAP_QUOTE_TTL_SECONDS: z.coerce.number().int().min(5).max(30).default(15),
  SWAP_DEFAULT_SLIPPAGE_BPS: z.coerce.number().int().min(1).max(200).default(50),
  SWAP_MAX_SLIPPAGE_BPS: z.coerce.number().int().min(1).max(200).default(200),
  SWAP_MAX_PRICE_IMPACT_BPS: z.coerce.number().int().min(1).max(1000).default(200),
  SWAP_BUILD_DEADLINE_SECONDS: z.coerce.number().int().min(30).max(300).default(300),
  SWAP_WALLET_ALLOWLIST: z.preprocess(emptyToUndefined, z.string().optional()),
  SWAP_ROUTER_ALLOWLIST: z.preprocess(emptyToUndefined, z.string().optional()),
  SWAP_SELECTOR_ALLOWLIST: z.preprocess(emptyToUndefined, z.string().optional()),
  KYBERSWAP_BASE_URL: z.preprocess(emptyToUndefined, z.url().optional()),
  KYBERSWAP_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  KYBERSWAP_CLIENT_ID: z.string().min(1).default('nexter'),
  BSC_RPC_URL: z.preprocess(emptyToUndefined, z.url().optional()),
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
    if (
      parsed.SETUP_TOKEN.length < 32 ||
      ['test-setup-token', 'change-me'].includes(parsed.SETUP_TOKEN)
    ) {
      throw new Error('SETUP_TOKEN must be at least 32 characters and not a known test value');
    }
    if (isWeakAuthEncryptionKey(parsed.AUTH_ENCRYPTION_KEY)) {
      throw new Error('AUTH_ENCRYPTION_KEY must not be a single repeated byte');
    }
    if (parsed.TRUST_PROXY === 'true') {
      throw new Error('TRUST_PROXY=true is unsafe; use the exact proxy CIDR or a hop count');
    }
    if (/^\d+$/.test(parsed.TRUST_PROXY) && Number(parsed.TRUST_PROXY) > 10) {
      throw new Error('TRUST_PROXY hop count must be between 0 and 10');
    }
    if (new URL(parsed.APP_URL).protocol !== 'https:') {
      throw new Error('APP_URL must use HTTPS in production and staging');
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
