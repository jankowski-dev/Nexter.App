import { z } from 'zod';

/** The sandbox universe is 1h only during Stage 2. */
export const SANDBOX_TIMEFRAME = '1h' as const;
export const SANDBOX_TIMEFRAME_MS = 3_600_000;

/** Warmup history required before a run can start: 180 days of 1h candles. */
export const SANDBOX_WARMUP_DAYS = 180;
export const SANDBOX_REQUIRED_CANDLES = SANDBOX_WARMUP_DAYS * 24;

/** A closed 1h bar is stale when its close is older than one more bar. */
export const SANDBOX_STALE_AFTER_MS = SANDBOX_TIMEFRAME_MS;

const EVM_KEY_PATTERN = /^(bsc|ethereum):(0x[0-9a-fA-F]{40})$/;
const BINANCE_KEY_PATTERN = /^binance:([A-Z0-9]{2,20}USDT)$/;

export const sandboxChainSchema = z.enum(['bsc', 'ethereum', 'binance']);
export type SandboxChain = z.infer<typeof sandboxChainSchema>;

export const sandboxCoverageStatusSchema = z.enum(['ok', 'partial', 'missing']);
export type SandboxCoverageStatus = z.infer<typeof sandboxCoverageStatusSchema>;

/**
 * Provider key of a sandbox token.
 * - `bsc:<0x address>`
 * - `ethereum:<0x address>`
 * - `binance:<PAIR>USDT`
 */
export const sandboxTokenKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine((value) => parseSandboxTokenKey(value) !== null, 'Некорректный ключ токена');

export interface ParsedSandboxTokenKey {
  chain: SandboxChain;
  /** Canonical identifier: lowercase EVM address or uppercase Binance pair. */
  identifier: string;
  contractAddress: string | null;
  /** Base asset for a Binance pair (`BTCUSDT` -> `BTC`); null for EVM tokens. */
  baseSymbol: string | null;
}

/** Parses a sandbox provider key; returns null for an unsupported chain or shape. */
export function parseSandboxTokenKey(raw: string): ParsedSandboxTokenKey | null {
  const value = raw.trim();
  const evm = EVM_KEY_PATTERN.exec(value);
  if (evm) {
    const address = (evm[2] as string).toLowerCase();
    return {
      chain: evm[1] as 'bsc' | 'ethereum',
      identifier: address,
      contractAddress: address,
      baseSymbol: null,
    };
  }

  const binance = BINANCE_KEY_PATTERN.exec(value);
  if (binance) {
    const pair = binance[1] as string;
    return {
      chain: 'binance',
      identifier: pair,
      contractAddress: null,
      baseSymbol: pair.slice(0, -'USDT'.length),
    };
  }

  return null;
}

/**
 * Canonicalizes case-insensitive user input: lowercase EVM chain/address and
 * uppercase Binance pair. Returns null for an unsupported key so the service
 * can reject it with a domain error.
 */
export function normalizeSandboxTokenKey(raw: string): string | null {
  const value = raw.trim();
  const evm = /^(bsc|ethereum):(0x[0-9a-fA-F]{40})$/i.exec(value);
  if (evm) return `${(evm[1] as string).toLowerCase()}:${(evm[2] as string).toLowerCase()}`;

  const binance = /^binance:([a-z0-9]{2,20}usdt)$/i.exec(value);
  if (binance) return `binance:${(binance[1] as string).toUpperCase()}`;

  return null;
}

const evmAddressSchema = z
  .string()
  .trim()
  .regex(/^0x[0-9a-fA-F]{40}$/, 'Некорректный адрес контракта');

const coingeckoIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'Некорректный CoinGecko id');

export const sandboxTokenSchema = z.object({
  id: z.uuid(),
  tokenKey: z.string().min(1).max(80),
  symbol: z.string().min(1).max(40),
  name: z.string().min(1).max(80),
  chain: sandboxChainSchema,
  contractAddress: z.string().nullable(),
  coingeckoId: z.string().nullable(),
  enabled: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type SandboxToken = z.infer<typeof sandboxTokenSchema>;

export const sandboxTokenCreateRequestSchema = z
  .object({
    tokenKey: sandboxTokenKeySchema,
    symbol: z.string().trim().min(1).max(40),
    name: z.string().trim().min(1).max(80),
    contractAddress: evmAddressSchema.nullable().optional(),
    coingeckoId: coingeckoIdSchema.nullable().optional(),
    enabled: z.boolean().optional(),
  })
  .superRefine((value, context) => {
    const parsed = parseSandboxTokenKey(value.tokenKey);
    if (!parsed) return;

    if (value.contractAddress && parsed.contractAddress) {
      if (value.contractAddress.toLowerCase() !== parsed.contractAddress) {
        context.addIssue({
          code: 'custom',
          path: ['contractAddress'],
          message: 'Адрес контракта не совпадает с ключом токена',
        });
      }
      return;
    }

    if (value.contractAddress && !parsed.contractAddress) {
      context.addIssue({
        code: 'custom',
        path: ['contractAddress'],
        message: 'Пары Binance не имеют адреса контракта',
      });
    }
  });
export type SandboxTokenCreateRequest = z.infer<typeof sandboxTokenCreateRequestSchema>;

export const sandboxTokenUpdateRequestSchema = z
  .object({
    symbol: z.string().trim().min(1).max(40).optional(),
    name: z.string().trim().min(1).max(80).optional(),
    coingeckoId: coingeckoIdSchema.nullable().optional(),
    enabled: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one field must be provided');
export type SandboxTokenUpdateRequest = z.infer<typeof sandboxTokenUpdateRequestSchema>;

export const sandboxTokensResponseSchema = z.object({
  tokens: z.array(sandboxTokenSchema),
});
export type SandboxTokensResponse = z.infer<typeof sandboxTokensResponseSchema>;

export const sandboxCoverageSchema = z.object({
  tokenKey: z.string().min(1).max(80),
  timeframe: z.literal(SANDBOX_TIMEFRAME),
  available: z.number().int().nonnegative(),
  required: z.number().int().positive(),
  firstOpenTime: z.iso.datetime().nullable(),
  lastOpenTime: z.iso.datetime().nullable(),
  gaps: z.number().int().nonnegative(),
  synthetic: z.boolean(),
  stale: z.boolean(),
  status: sandboxCoverageStatusSchema,
  warning: z.string().nullable(),
});
export type SandboxCoverage = z.infer<typeof sandboxCoverageSchema>;

export const sandboxCoverageQuerySchema = z.object({
  tokenKey: sandboxTokenKeySchema.optional(),
});
export type SandboxCoverageQuery = z.infer<typeof sandboxCoverageQuerySchema>;

export const sandboxCoverageResponseSchema = z.object({
  tokens: z.array(sandboxCoverageSchema),
});
export type SandboxCoverageResponse = z.infer<typeof sandboxCoverageResponseSchema>;

export const sandboxTokenRefreshResponseSchema = z.object({
  token: sandboxTokenSchema,
  coverage: sandboxCoverageSchema,
  fetched: z.number().int().nonnegative(),
});
export type SandboxTokenRefreshResponse = z.infer<typeof sandboxTokenRefreshResponseSchema>;
