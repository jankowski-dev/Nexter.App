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

/**
 * Owner-facing feature availability. `enabled` mirrors `SANDBOX_ENABLED`;
 * the web app hides the navigation and shows a neutral disabled state when it
 * is false. The status endpoint stays reachable while the flag is off.
 */
export const sandboxStatusSchema = z.object({
  enabled: z.boolean(),
  version: z.string().min(1).max(80),
});
export type SandboxStatus = z.infer<typeof sandboxStatusSchema>;

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

/** Decimal string used for sandbox money fields (no exponent, no grouping). */
const sandboxDecimalSchema = z.string().regex(/^-?\d+(\.\d+)?$/, 'Ожидается десятичное число');
/** Non-negative decimal string for settings that the decision engine rejects if negative. */
const sandboxNonNegativeDecimalSchema = z
  .string()
  .regex(/^\d+(\.\d+)?$/, 'Ожидается неотрицательное десятичное число');
const sandboxPositiveUsdSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/, 'Ожидается положительная сумма USD')
  .refine((value) => Number(value) > 0, 'Сумма должна быть больше нуля');

const sandboxBpsSchema = z.number().int().min(0).max(9_999);
const sandboxPctSchema = z.number().min(0).max(100);

export const sandboxPaperSettingsSchema = z
  .object({
    feeBps: sandboxBpsSchema,
    slippageBps: sandboxBpsSchema,
    liquidityCapPct: z.number().gt(0).max(100),
    maxPendingBars: z.number().int().min(1).max(24),
    cooldownHoursAfterStop: z.number().min(0).max(720),
    counterfactualHorizonHours: z.number().gt(0).max(720),
  })
  .strict();
export type SandboxPaperSettings = z.infer<typeof sandboxPaperSettingsSchema>;

const sandboxPositiveInteger = z.number().int().positive();
const sandboxNonNegativeNumber = z.number().min(0);

export const sandboxRegimeSettingsSchema = z
  .object({
    fastHours: sandboxPositiveInteger,
    slowHours: sandboxPositiveInteger,
    longHours: sandboxPositiveInteger,
    atrPeriod: sandboxPositiveInteger,
    rangeWindowHours: sandboxPositiveInteger,
    liquidityWindowHours: sandboxPositiveInteger,
    trendSpreadPct: sandboxNonNegativeNumber,
    trendMaxAtrPct: sandboxNonNegativeNumber,
    rangeSpreadPct: sandboxNonNegativeNumber,
    rangeMaxAtrPct: sandboxNonNegativeNumber,
    crashDrawdownPct: sandboxNonNegativeNumber,
    crashAtrPct: sandboxNonNegativeNumber,
    recoveryConfirmBars: sandboxPositiveInteger,
    regimeDwellBars: sandboxPositiveInteger,
    minLiquidityUsd: sandboxNonNegativeDecimalSchema,
    /**
     * Optional research mode. Missing means the legacy volume gate so old
     * settings keep their exact hash and report identity.
     */
    liquidityMode: z.enum(['volume', 'execution', 'ignored']).optional(),
  })
  .strict();

export const sandboxStrategySettingsSchema = z
  .object({
    trendPullback: z
      .object({
        fastPeriod: sandboxPositiveInteger,
        slowPeriod: sandboxPositiveInteger,
        pullbackPct: sandboxNonNegativeNumber,
        atrStopMult: z.number().positive(),
        trailActivationPct: sandboxNonNegativeNumber,
        trailPct: sandboxNonNegativeNumber,
        /**
         * Optional research breakout fallback. Missing means disabled so old
         * settings keep their exact hash and report identity.
         */
        breakout: z
          .object({
            enabled: z.boolean(),
            lookbackHours: sandboxPositiveInteger,
            minVolumeRatio: z.number().positive(),
            maxAtrPct: sandboxNonNegativeNumber,
          })
          .strict()
          .optional(),
      })
      .strict(),
    rangeReversion: z
      .object({
        lookback: sandboxPositiveInteger,
        bandAtrMult: sandboxNonNegativeNumber,
        stopAtrMult: z.number().positive(),
      })
      .strict(),
    recovery: z
      .object({
        fastPeriod: sandboxPositiveInteger,
        confirmBars: sandboxPositiveInteger,
        stopPct: z.number().positive(),
        riskWeight: z.number().gt(0).max(1),
      })
      .strict(),
  })
  .strict();

export const sandboxDecisionSettingsSchema = z
  .object({
    timeframe: z.literal(SANDBOX_TIMEFRAME),
    maxPositions: z.number().int().min(0).max(50),
    maxTokenExposurePct: sandboxPctSchema,
    maxStrategyExposurePct: sandboxPctSchema,
    cashBufferPct: sandboxPctSchema,
    dailyLossLimitPct: sandboxPctSchema,
    maxDrawdownPct: sandboxPctSchema,
    perTradeRiskPct: sandboxPctSchema,
    minOrderUsd: sandboxNonNegativeDecimalSchema,
    liquidityCapPct: z.number().gt(0).max(100),
    defaultStopPct: z.number().gt(0).max(100),
    regime: sandboxRegimeSettingsSchema,
    strategies: sandboxStrategySettingsSchema,
  })
  .strict();
export type SandboxDecisionSettings = z.infer<typeof sandboxDecisionSettingsSchema>;

/**
 * Frozen run configuration persisted in `sandbox_runs.settings`.
 *
 * `tokenKeys` is the universe snapshot and `settings`/`paper` are the Stage
 * 1B/1C defaults frozen at start; no owner edit is allowed while running.
 */
function uniqueTokenKeys(value: { tokenKeys: string[] }): boolean {
  return new Set(value.tokenKeys).size === value.tokenKeys.length;
}

export const sandboxRunConfigSchema = z
  .object({
    tokenKeys: z.array(sandboxTokenKeySchema).min(1).max(50),
    seed: z.number().int().min(0).max(2_147_483_647),
    settings: sandboxDecisionSettingsSchema,
    paper: sandboxPaperSettingsSchema,
  })
  .strict()
  .refine(uniqueTokenKeys, {
    path: ['tokenKeys'],
    message: 'Ключи токенов не должны повторяться',
  });
export type SandboxRunConfig = z.infer<typeof sandboxRunConfigSchema>;

export const sandboxRunCreateRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    initialCapitalUsd: sandboxPositiveUsdSchema,
    tokenKeys: z.array(sandboxTokenKeySchema).min(1).max(50),
    settings: sandboxDecisionSettingsSchema.optional(),
    paper: sandboxPaperSettingsSchema.optional(),
  })
  .strict()
  .refine(uniqueTokenKeys, {
    path: ['tokenKeys'],
    message: 'Ключи токенов не должны повторяться',
  });
export type SandboxRunCreateRequest = z.infer<typeof sandboxRunCreateRequestSchema>;

export const sandboxRunUpdateRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    initialCapitalUsd: sandboxPositiveUsdSchema.optional(),
    tokenKeys: z.array(sandboxTokenKeySchema).min(1).max(50).optional(),
    settings: sandboxDecisionSettingsSchema.optional(),
    paper: sandboxPaperSettingsSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Нужно передать хотя бы одно поле')
  .refine(
    (value) => value.tokenKeys === undefined || uniqueTokenKeys({ tokenKeys: value.tokenKeys }),
    {
      path: ['tokenKeys'],
      message: 'Ключи токенов не должны повторяться',
    },
  );
export type SandboxRunUpdateRequest = z.infer<typeof sandboxRunUpdateRequestSchema>;

/**
 * Start confirmation. A partial warmup may start only when the owner explicitly
 * accepts the reduced regime confidence; a missing series never starts.
 */
export const sandboxRunStartRequestSchema = z
  .object({
    allowPartial: z.boolean().optional(),
  })
  .strict()
  .default({});
export type SandboxRunStartRequest = z.infer<typeof sandboxRunStartRequestSchema>;

export const sandboxRunStatusSchema = z.enum(['draft', 'running', 'paused', 'stopped', 'failed']);
export type SandboxRunStatus = z.infer<typeof sandboxRunStatusSchema>;

export const sandboxRunTokenSchema = z.object({
  tokenKey: z.string().min(1).max(80),
  symbol: z.string().min(1).max(40),
  chain: sandboxChainSchema,
  contractAddress: z.string().nullable(),
  enabled: z.boolean(),
});
export type SandboxRunToken = z.infer<typeof sandboxRunTokenSchema>;

export const sandboxRunSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(80),
  status: sandboxRunStatusSchema,
  initialCapitalUsd: sandboxDecimalSchema,
  cashUsd: sandboxDecimalSchema,
  equityUsd: sandboxDecimalSchema,
  peakEquityUsd: sandboxDecimalSchema,
  dayStartEquityUsd: sandboxDecimalSchema,
  tokenKeys: z.array(z.string().min(1).max(80)).min(1).max(50),
  tokens: z.array(sandboxRunTokenSchema),
  settings: sandboxDecisionSettingsSchema,
  paper: sandboxPaperSettingsSchema,
  lastBarClose: z.iso.datetime().nullable(),
  lastTickAt: z.iso.datetime().nullable(),
  error: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  startedAt: z.iso.datetime().nullable(),
  pausedAt: z.iso.datetime().nullable(),
  stoppedAt: z.iso.datetime().nullable(),
  archivedAt: z.iso.datetime().nullable(),
});
export type SandboxRun = z.infer<typeof sandboxRunSchema>;

/**
 * Execution mode of the Stage 2 sandbox. Live paper fills use real market data
 * and virtual money only: no wallet, key, signing or real order is involved.
 */
export const SANDBOX_EXECUTION_MODE = 'live-paper' as const;
export const sandboxExecutionModeSchema = z.literal(SANDBOX_EXECUTION_MODE);
export type SandboxExecutionMode = z.infer<typeof sandboxExecutionModeSchema>;

/** Display scales returned by the read API (Postgres numeric is normalized first). */
export const SANDBOX_USD_SCALE = 2;
export const SANDBOX_UNITS_SCALE = 8;
export const SANDBOX_PERCENT_SCALE = 2;
export const SANDBOX_PERCENT_FINE_SCALE = 4;

const sandboxReadTimestampSchema = z.iso.datetime();

export const sandboxRunSummarySchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(80),
  status: sandboxRunStatusSchema,
  initialCapitalUsd: sandboxDecimalSchema,
  cashUsd: sandboxDecimalSchema,
  equityUsd: sandboxDecimalSchema,
  peakEquityUsd: sandboxDecimalSchema,
  /** `(equity / initialCapital - 1) * 100`, two decimals. */
  returnPct: sandboxDecimalSchema,
  /** `(peakEquity - equity) / peakEquity * 100`, four decimals, never negative. */
  drawdownPct: sandboxDecimalSchema,
  tokenCount: z.number().int().nonnegative(),
  lastBarClose: sandboxReadTimestampSchema.nullable(),
  lastTickAt: sandboxReadTimestampSchema.nullable(),
  startedAt: sandboxReadTimestampSchema.nullable(),
  stoppedAt: sandboxReadTimestampSchema.nullable(),
  archivedAt: sandboxReadTimestampSchema.nullable(),
  error: z.string().nullable(),
  createdAt: sandboxReadTimestampSchema,
  updatedAt: sandboxReadTimestampSchema,
});
export type SandboxRunSummary = z.infer<typeof sandboxRunSummarySchema>;

export const sandboxRunDetailSchema = sandboxRunSchema.extend({
  executionMode: sandboxExecutionModeSchema,
  openPositions: z.number().int().nonnegative(),
  openTrades: z.number().int().nonnegative(),
  closedTrades: z.number().int().nonnegative(),
  intents: z.number().int().nonnegative(),
  pendingIntents: z.number().int().nonnegative(),
  equityPoints: z.number().int().nonnegative(),
  ledgerEntries: z.number().int().nonnegative(),
  /** Number of persisted events; the next event receives this sequence. */
  eventCount: z.number().int().nonnegative(),
  eventHash: z.string().regex(/^[0-9a-f]{64}$/),
});
export type SandboxRunDetail = z.infer<typeof sandboxRunDetailSchema>;

/**
 * One open position. Closed positions are delete-free zero tombstones in
 * `sandbox_positions`; the API omits them and the trade journal keeps history.
 */
export const sandboxPositionSchema = z.object({
  tokenId: z.string().min(1).max(80),
  strategyKey: z.string().min(1).max(40),
  strategyVersion: z.number().int().positive(),
  amount: sandboxDecimalSchema,
  avgCostUsd: sandboxDecimalSchema,
  costBasisUsd: sandboxDecimalSchema,
  marketPriceUsd: sandboxDecimalSchema,
  marketValueUsd: sandboxDecimalSchema,
  openedAt: sandboxReadTimestampSchema,
  stopLossPct: sandboxDecimalSchema.nullable(),
  takeProfitPct: sandboxDecimalSchema.nullable(),
  entryIntentId: z.string().min(1).max(200),
  feesPaidUsd: sandboxDecimalSchema,
  updatedAt: sandboxReadTimestampSchema,
});
export type SandboxPosition = z.infer<typeof sandboxPositionSchema>;

export const sandboxTradeSchema = z.object({
  tradeId: z.string().min(1).max(200),
  tokenId: z.string().min(1).max(80),
  strategyKey: z.string().min(1).max(40),
  strategyVersion: z.number().int().positive(),
  entryAt: sandboxReadTimestampSchema,
  entryPriceUsd: sandboxDecimalSchema,
  entryAmount: sandboxDecimalSchema,
  entryNotionalUsd: sandboxDecimalSchema,
  entryFeeUsd: sandboxDecimalSchema,
  entryCostBasisUsd: sandboxDecimalSchema,
  entryIntentId: z.string().min(1).max(200).nullable(),
  exitAt: sandboxReadTimestampSchema.nullable(),
  exitPriceUsd: sandboxDecimalSchema.nullable(),
  exitAmount: sandboxDecimalSchema,
  exitNotionalUsd: sandboxDecimalSchema,
  exitFeeUsd: sandboxDecimalSchema,
  exitReasonCode: z.string().min(1).max(80).nullable(),
  exitIntentId: z.string().min(1).max(200).nullable(),
  realizedPnlUsd: sandboxDecimalSchema,
  status: z.enum(['open', 'closed']),
  updatedAt: sandboxReadTimestampSchema,
});
export type SandboxTrade = z.infer<typeof sandboxTradeSchema>;

export const sandboxIntentStatusSchema = z.enum([
  'pending',
  'filled',
  'partial',
  'rejected',
  'expired',
]);
export type SandboxIntentStatus = z.infer<typeof sandboxIntentStatusSchema>;

export const sandboxIntentSchema = z.object({
  intentId: z.string().min(1).max(200),
  tokenId: z.string().min(1).max(80),
  side: z.enum(['buy', 'sell']),
  strategyKey: z.string().min(1).max(40),
  strategyVersion: z.number().int().positive(),
  status: sandboxIntentStatusSchema,
  requestedUsd: sandboxDecimalSchema.nullable(),
  requestedAmount: sandboxDecimalSchema.nullable(),
  filledUsd: sandboxDecimalSchema,
  filledAmount: sandboxDecimalSchema,
  priceUsd: sandboxDecimalSchema.nullable(),
  stopLossPct: sandboxDecimalSchema.nullable(),
  takeProfitPct: sandboxDecimalSchema.nullable(),
  feeUsd: sandboxDecimalSchema,
  reasonCode: z.string().min(1).max(80),
  strategyReasonCode: z.string().min(1).max(80).nullable(),
  reasonText: z.string().max(2_000),
  decisionTime: sandboxReadTimestampSchema,
  fillTime: sandboxReadTimestampSchema.nullable(),
});
export type SandboxIntent = z.infer<typeof sandboxIntentSchema>;

const sandboxEventDecisionSchema = z.object({
  action: z.enum(['buy', 'sell', 'hold', 'block', 'noop']),
  sizeUsd: sandboxDecimalSchema.nullable(),
  reasonCode: z.string().min(1).max(80),
  reasonText: z.string().max(2_000),
});

const sandboxEventAlternativeSchema = z.object({
  action: z.enum(['buy', 'sell', 'hold', 'block', 'noop']),
  reasonCode: z.string().min(1).max(80),
  whyNot: z.string().max(2_000),
});

const sandboxEventRiskCheckSchema = z.object({
  name: z.string().min(1).max(120),
  value: z.string().max(120),
  limit: z.string().max(120),
  passed: z.boolean(),
});

/**
 * One journal event. Canonical hashing metadata (`prevHash`, `hash`) and the
 * decision/why-not/risk-check payloads are exposed; the raw state before/after
 * and `inputs` blobs stay out of the read API to keep the journal bounded.
 */
export const sandboxEventSchema = z.object({
  seq: z.number().int().nonnegative(),
  clockTime: sandboxReadTimestampSchema,
  module: z.enum([
    'run',
    'data',
    'clock',
    'regime',
    'strategy',
    'portfolio',
    'risk',
    'execution',
    'ledger',
    'manual',
  ]),
  eventType: z.string().min(1).max(120),
  severity: z.enum(['debug', 'info', 'warn', 'error', 'decision']),
  tokenId: z.string().min(1).max(80).nullable(),
  strategyId: z.string().min(1).max(120).nullable(),
  regime: z.string().min(1).max(40).nullable(),
  decision: sandboxEventDecisionSchema.nullable(),
  alternatives: z.array(sandboxEventAlternativeSchema),
  riskChecks: z.array(sandboxEventRiskCheckSchema),
  dataSnapshotId: z.string().min(1).max(200),
  configVersion: z.string().min(1).max(200),
  seed: z.number().int(),
  correlationId: z.string().min(1).max(200).nullable(),
  reasonCode: z.string().min(1).max(80).nullable(),
  reasonText: z.string().max(2_000).nullable(),
  recordedAt: sandboxReadTimestampSchema,
  prevHash: z.string().regex(/^[0-9a-f]{64}$/),
  hash: z.string().regex(/^[0-9a-f]{64}$/),
});
export type SandboxEvent = z.infer<typeof sandboxEventSchema>;

export const sandboxEquityPointSchema = z.object({
  clockTime: sandboxReadTimestampSchema,
  equityUsd: sandboxDecimalSchema,
  cashUsd: sandboxDecimalSchema,
  positionsValueUsd: sandboxDecimalSchema,
  drawdownPct: sandboxDecimalSchema,
});
export type SandboxEquityPoint = z.infer<typeof sandboxEquityPointSchema>;

export const sandboxRunsQuerySchema = z.object({
  status: sandboxRunStatusSchema.optional(),
  includeArchived: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => value === true || value === 'true')
    .default(false),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});
export type SandboxRunsQuery = z.infer<typeof sandboxRunsQuerySchema>;

export const sandboxPageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});
export type SandboxPageQuery = z.infer<typeof sandboxPageQuerySchema>;

export const sandboxEquityQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(2_000).default(500),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});
export type SandboxEquityQuery = z.infer<typeof sandboxEquityQuerySchema>;

export const sandboxEventsQuerySchema = z.object({
  /** Exclusive lower bound: return events with `seq > afterSeq`. */
  afterSeq: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(1_000).default(200),
});
export type SandboxEventsQuery = z.infer<typeof sandboxEventsQuerySchema>;

export const sandboxRunsResponseSchema = z.object({
  runs: z.array(sandboxRunSummarySchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
});
export type SandboxRunsResponse = z.infer<typeof sandboxRunsResponseSchema>;

export const sandboxPositionsResponseSchema = z.object({
  positions: z.array(sandboxPositionSchema),
});
export type SandboxPositionsResponse = z.infer<typeof sandboxPositionsResponseSchema>;

export const sandboxTradesResponseSchema = z.object({
  trades: z.array(sandboxTradeSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
});
export type SandboxTradesResponse = z.infer<typeof sandboxTradesResponseSchema>;

export const sandboxIntentsResponseSchema = z.object({
  intents: z.array(sandboxIntentSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
});
export type SandboxIntentsResponse = z.infer<typeof sandboxIntentsResponseSchema>;

export const sandboxEventsResponseSchema = z.object({
  events: z.array(sandboxEventSchema),
  hasMore: z.boolean(),
  nextAfterSeq: z.number().int().nonnegative().nullable(),
});
export type SandboxEventsResponse = z.infer<typeof sandboxEventsResponseSchema>;

export const sandboxEquityResponseSchema = z.object({
  points: z.array(sandboxEquityPointSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
});
export type SandboxEquityResponse = z.infer<typeof sandboxEquityResponseSchema>;

export const sandboxRunCountsSchema = z.object({
  total: z.number().int().nonnegative(),
  draft: z.number().int().nonnegative(),
  running: z.number().int().nonnegative(),
  paused: z.number().int().nonnegative(),
  stopped: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  archived: z.number().int().nonnegative(),
});
export type SandboxRunCounts = z.infer<typeof sandboxRunCountsSchema>;

export const sandboxUniverseHealthSchema = z.object({
  tokens: z.number().int().nonnegative(),
  enabledTokens: z.number().int().nonnegative(),
  staleTokens: z.array(z.string().min(1).max(80)),
  lastCandleAt: sandboxReadTimestampSchema.nullable(),
});
export type SandboxUniverseHealth = z.infer<typeof sandboxUniverseHealthSchema>;

export const sandboxOverviewSchema = z.object({
  enabled: z.boolean(),
  executionMode: sandboxExecutionModeSchema,
  runs: sandboxRunCountsSchema,
  /** Running, non-archived runs, newest first (bounded by the read service). */
  activeRuns: z.array(sandboxRunSummarySchema),
  lastTickAt: sandboxReadTimestampSchema.nullable(),
  universe: sandboxUniverseHealthSchema,
});
export type SandboxOverview = z.infer<typeof sandboxOverviewSchema>;

/*
 * Report contract.
 *
 * The JSON mirrors the deterministic Stage 1C `RunReport` (numeric epoch-ms
 * timestamps, 8-decimal units, 2-decimal USD/percent) and wraps it with the
 * Stage 2 `executionMode` label. Keeping the wrapper at the API level preserves
 * the core report type and its `reportHash`.
 */
const sandboxReportTimestampSchema = z.number().int().nonnegative();
const sandboxReportDecimalSchema = sandboxDecimalSchema;
const sandboxReportTimestampNullableSchema = sandboxReportTimestampSchema.nullable();
const sandboxReportDecimalNullableSchema = sandboxReportDecimalSchema.nullable();

export const sandboxReportConfigSchema = z.object({
  runId: z.string().min(1),
  seed: z.number().int(),
  timeframe: z.string().min(1),
  tokenIds: z.array(z.string().min(1)),
  initialCapitalUsd: sandboxReportDecimalSchema,
  feeBps: z.number(),
  slippageBps: z.number(),
  liquidityCapPct: z.number(),
  maxPendingBars: z.number().int(),
  cooldownHoursAfterStop: z.number(),
  counterfactualHorizonHours: z.number(),
});
export type SandboxReportConfig = z.infer<typeof sandboxReportConfigSchema>;

export const sandboxReportPeriodSchema = z.object({
  firstBar: sandboxReportTimestampSchema,
  lastBar: sandboxReportTimestampSchema,
  bars: z.number().int().nonnegative(),
  tokens: z.array(z.string().min(1)),
});
export type SandboxReportPeriod = z.infer<typeof sandboxReportPeriodSchema>;

export const sandboxReportStrategyMetricSchema = z.object({
  strategyKey: z.string().min(1),
  tradeCount: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  realizedPnlUsd: sandboxReportDecimalSchema,
  winRatePct: sandboxReportDecimalNullableSchema,
});
export type SandboxReportStrategyMetric = z.infer<typeof sandboxReportStrategyMetricSchema>;

export const sandboxReportTokenMetricSchema = z.object({
  tokenId: z.string().min(1),
  tradeCount: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  realizedPnlUsd: sandboxReportDecimalSchema,
  winRatePct: sandboxReportDecimalNullableSchema,
});
export type SandboxReportTokenMetric = z.infer<typeof sandboxReportTokenMetricSchema>;

export const sandboxReportMetricsSchema = z.object({
  initialCapitalUsd: sandboxReportDecimalSchema,
  finalEquityUsd: sandboxReportDecimalSchema,
  totalReturnPct: sandboxReportDecimalSchema,
  maxDrawdownPct: sandboxReportDecimalSchema,
  peakEquityUsd: sandboxReportDecimalSchema,
  finalCashUsd: sandboxReportDecimalSchema,
  finalPositionsValueUsd: sandboxReportDecimalSchema,
  realizedPnlUsd: sandboxReportDecimalSchema,
  unrealizedPnlUsd: sandboxReportDecimalSchema,
  feesPaidUsd: sandboxReportDecimalSchema,
  tradeCount: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  winRatePct: sandboxReportDecimalNullableSchema,
  profitFactor: sandboxReportDecimalNullableSchema,
  averageWinUsd: sandboxReportDecimalNullableSchema,
  averageLossUsd: sandboxReportDecimalNullableSchema,
  timeInMarketPct: sandboxReportDecimalSchema,
  averageExposurePct: sandboxReportDecimalSchema,
  perStrategy: z.array(sandboxReportStrategyMetricSchema),
  perToken: z.array(sandboxReportTokenMetricSchema),
});
export type SandboxReportMetrics = z.infer<typeof sandboxReportMetricsSchema>;

export const sandboxReportEquityPointSchema = z.object({
  clockTime: sandboxReportTimestampSchema,
  equityUsd: sandboxReportDecimalSchema,
  cashUsd: sandboxReportDecimalSchema,
  positionsValueUsd: sandboxReportDecimalSchema,
  drawdownPct: sandboxReportDecimalSchema,
});
export type SandboxReportEquityPoint = z.infer<typeof sandboxReportEquityPointSchema>;

export const sandboxReportPositionSchema = z.object({
  tokenId: z.string().min(1),
  strategyKey: z.string().min(1),
  strategyVersion: z.number().int().positive(),
  amount: sandboxReportDecimalSchema,
  avgCostUsd: sandboxReportDecimalSchema,
  marketPriceUsd: sandboxReportDecimalSchema,
  marketValueUsd: sandboxReportDecimalSchema,
  openedAt: sandboxReportTimestampSchema,
  stopLossPct: sandboxReportDecimalNullableSchema,
  takeProfitPct: sandboxReportDecimalNullableSchema,
});
export type SandboxReportPosition = z.infer<typeof sandboxReportPositionSchema>;

export const sandboxReportTradeSchema = z.object({
  tradeId: z.string().min(1),
  tokenId: z.string().min(1),
  strategyKey: z.string().min(1),
  strategyVersion: z.number().int().positive(),
  entryAt: sandboxReportTimestampSchema,
  entryPriceUsd: sandboxReportDecimalSchema,
  entryAmount: sandboxReportDecimalSchema,
  entryNotionalUsd: sandboxReportDecimalSchema,
  entryFeeUsd: sandboxReportDecimalSchema,
  entryCostBasisUsd: sandboxReportDecimalSchema,
  entryIntentId: z.string().min(1),
  exitAt: sandboxReportTimestampNullableSchema,
  exitPriceUsd: sandboxReportDecimalNullableSchema,
  exitAmount: sandboxReportDecimalSchema,
  exitNotionalUsd: sandboxReportDecimalSchema,
  exitFeeUsd: sandboxReportDecimalSchema,
  exitReasonCode: z.string().min(1).nullable(),
  exitIntentId: z.string().min(1).nullable(),
  realizedPnlUsd: sandboxReportDecimalSchema,
  status: z.enum(['open', 'closed']),
});
export type SandboxReportTrade = z.infer<typeof sandboxReportTradeSchema>;

export const sandboxReportIntentSchema = z.object({
  intentId: z.string().min(1),
  tokenId: z.string().min(1),
  side: z.enum(['buy', 'sell']),
  strategyKey: z.string().min(1),
  strategyVersion: z.number().int().positive(),
  status: z.enum(['filled', 'partial', 'rejected', 'expired']),
  requestedUsd: sandboxReportDecimalNullableSchema,
  requestedAmount: sandboxReportDecimalNullableSchema,
  filledUsd: sandboxReportDecimalSchema,
  filledAmount: sandboxReportDecimalSchema,
  priceUsd: sandboxReportDecimalNullableSchema,
  feeUsd: sandboxReportDecimalSchema,
  reasonCode: z.string().min(1),
  strategyReasonCode: z.string().min(1),
  reasonText: z.string(),
  decisionTime: sandboxReportTimestampSchema,
  fillTime: sandboxReportTimestampNullableSchema,
});
export type SandboxReportIntent = z.infer<typeof sandboxReportIntentSchema>;

export const sandboxReportCounterfactualSchema = z.object({
  tokenId: z.string().min(1),
  decisionTime: sandboxReportTimestampSchema,
  reasonCode: z.string().min(1),
  entryAt: sandboxReportTimestampNullableSchema,
  entryPriceUsd: sandboxReportDecimalNullableSchema,
  exitAt: sandboxReportTimestampNullableSchema,
  exitPriceUsd: sandboxReportDecimalNullableSchema,
  returnPct: sandboxReportDecimalNullableSchema,
  outcome: z.enum(['missed_opportunity', 'bad_save', 'neutral', 'insufficient_data']),
  hindsight: z.literal(true),
  usedForDecisions: z.literal(false),
});
export type SandboxReportCounterfactual = z.infer<typeof sandboxReportCounterfactualSchema>;

export const sandboxRunReportSchema = z.object({
  paperVersion: z.string().min(1),
  runId: z.uuid(),
  seed: z.number().int(),
  configVersion: z.string().min(1),
  dataSnapshotId: z.string().min(1),
  settingsVersion: z.string().min(1),
  config: sandboxReportConfigSchema,
  period: sandboxReportPeriodSchema,
  metrics: sandboxReportMetricsSchema,
  equityCurve: z.array(sandboxReportEquityPointSchema),
  positions: z.array(sandboxReportPositionSchema),
  trades: z.array(sandboxReportTradeSchema),
  intentJournal: z.array(sandboxReportIntentSchema),
  counterfactuals: z.array(sandboxReportCounterfactualSchema),
  eventCount: z.number().int().nonnegative(),
  eventHash: z.string().regex(/^[0-9a-f]{64}$/),
  ledgerEntries: z.number().int().nonnegative(),
  reconciliationOk: z.boolean(),
  reconciliationChecks: z.array(z.string()),
  reportHash: z.string().regex(/^[0-9a-f]{64}$/),
});
export type SandboxRunReport = z.infer<typeof sandboxRunReportSchema>;

export const sandboxReportResponseSchema = z.object({
  executionMode: sandboxExecutionModeSchema,
  report: sandboxRunReportSchema,
  /** Pending intents are live-only and are excluded from `report.intentJournal`. */
  pendingIntents: z.number().int().nonnegative(),
  /** Explicit notes about intentional omissions and report identity. */
  notes: z.array(z.string()),
});
export type SandboxReportResponse = z.infer<typeof sandboxReportResponseSchema>;

/*
 * Historical replay contracts (Stage 2.1).
 *
 * A replay is a bounded, deterministic paper run over the owner's stored 1h
 * `sandbox_candles`. `fromTime` is the first evaluation candle **open** and
 * `toTime` the last evaluation candle **close**; prefix candles are lookback
 * history and are not part of the reported period.
 */
export const sandboxReplayStatusSchema = z.enum([
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
]);
export type SandboxReplayStatus = z.infer<typeof sandboxReplayStatusSchema>;

export const sandboxReplayPeriodSchema = z.union([z.literal(30), z.literal(90), z.literal(180)]);
export type SandboxReplayPeriod = z.infer<typeof sandboxReplayPeriodSchema>;

export const sandboxReplayCreateRequestSchema = z
  .object({
    name: z.string().min(1).max(80),
    tokenKeys: z.array(sandboxTokenKeySchema).min(1).max(3),
    periodDays: sandboxReplayPeriodSchema,
    initialCapitalUsd: sandboxPositiveUsdSchema,
    seed: z.number().int().min(0).max(2_147_483_647).optional(),
    settings: sandboxDecisionSettingsSchema.optional(),
    paper: sandboxPaperSettingsSchema.optional(),
    allowPartial: z.boolean().optional().default(false),
  })
  .strict()
  .refine(uniqueTokenKeys, {
    path: ['tokenKeys'],
    message: 'Ключи токенов не должны повторяться',
  });
export type SandboxReplayCreateRequest = z.infer<typeof sandboxReplayCreateRequestSchema>;

export const sandboxReplayPreflightRequestSchema = z
  .object({
    tokenKeys: z.array(sandboxTokenKeySchema).min(1).max(3),
    periodDays: sandboxReplayPeriodSchema,
    allowPartial: z.boolean().optional().default(false),
  })
  .strict()
  .refine(uniqueTokenKeys, {
    path: ['tokenKeys'],
    message: 'Ключи токенов не должны повторяться',
  });
export type SandboxReplayPreflightRequest = z.infer<typeof sandboxReplayPreflightRequestSchema>;

export const sandboxReplayCoverageSchema = z.object({
  tokenKey: z.string().min(1),
  fromTime: z.iso.datetime(),
  toTime: z.iso.datetime(),
  available: z.number().int().nonnegative(),
  required: z.number().int().positive(),
  prefixBars: z.number().int().nonnegative(),
  gaps: z.number().int().nonnegative(),
  synthetic: z.boolean(),
  stale: z.boolean(),
  status: sandboxCoverageStatusSchema,
  warning: z.string().nullable(),
});
export type SandboxReplayCoverage = z.infer<typeof sandboxReplayCoverageSchema>;

export const sandboxReplayPreflightResponseSchema = z.object({
  fromTime: z.iso.datetime(),
  toTime: z.iso.datetime(),
  status: sandboxCoverageStatusSchema,
  warnings: z.array(z.string()),
  coverage: z.array(sandboxReplayCoverageSchema),
});
export type SandboxReplayPreflightResponse = z.infer<typeof sandboxReplayPreflightResponseSchema>;

export const sandboxReplayListQuerySchema = z.object({
  status: sandboxReplayStatusSchema.optional(),
  includeArchived: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => value === true || value === 'true')
    .default(false),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});
export type SandboxReplayListQuery = z.infer<typeof sandboxReplayListQuerySchema>;

export const sandboxReplaySummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  status: sandboxReplayStatusSchema,
  tokenKeys: z.array(z.string()),
  periodDays: z.number().int(),
  fromTime: z.iso.datetime(),
  toTime: z.iso.datetime(),
  initialCapitalUsd: sandboxDecimalSchema,
  finalEquityUsd: sandboxDecimalSchema.nullable(),
  returnPct: sandboxDecimalSchema.nullable(),
  maxDrawdownPct: sandboxDecimalSchema.nullable(),
  reportHash: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable(),
  error: z.string().nullable(),
  queuedAt: z.iso.datetime(),
  startedAt: z.iso.datetime().nullable(),
  finishedAt: z.iso.datetime().nullable(),
  archivedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type SandboxReplaySummary = z.infer<typeof sandboxReplaySummarySchema>;

export const sandboxReplayDetailSchema = sandboxReplaySummarySchema.extend({
  settings: sandboxDecisionSettingsSchema,
  paper: sandboxPaperSettingsSchema,
  seed: z.number().int(),
  eventCount: z.number().int().nullable(),
  eventHash: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable(),
  dataSnapshotId: z.string().nullable(),
  candleSnapshotHash: z.string().nullable(),
});
export type SandboxReplayDetail = z.infer<typeof sandboxReplayDetailSchema>;

export const sandboxReplayListResponseSchema = z.object({
  replays: z.array(sandboxReplaySummarySchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
});
export type SandboxReplayListResponse = z.infer<typeof sandboxReplayListResponseSchema>;

/** Execution label of a historical replay (the core report hash is unchanged). */
export const SANDBOX_HISTORICAL_EXECUTION_MODE = 'historical-paper' as const;
export type SandboxHistoricalExecutionMode = typeof SANDBOX_HISTORICAL_EXECUTION_MODE;

export const sandboxReplayReportIdentitySchema = z.object({
  reportHash: z.string().regex(/^[0-9a-f]{64}$/),
  eventHash: z.string().regex(/^[0-9a-f]{64}$/),
  eventCount: z.number().int().nonnegative(),
  dataSnapshotId: z.string().min(1),
  candleSnapshotHash: z.string().regex(/^[0-9a-f]{64}$/),
  configVersion: z.string().min(1),
  settingsVersion: z.string().min(1),
  seed: z.number().int(),
});
export type SandboxReplayReportIdentity = z.infer<typeof sandboxReplayReportIdentitySchema>;

export const sandboxReplayReportResponseSchema = z.object({
  executionMode: z.literal(SANDBOX_HISTORICAL_EXECUTION_MODE),
  report: sandboxRunReportSchema,
  notes: z.array(z.string()),
  identity: sandboxReplayReportIdentitySchema,
});
export type SandboxReplayReportResponse = z.infer<typeof sandboxReplayReportResponseSchema>;

export const sandboxReplayChartActionKindSchema = z.enum([
  'buy',
  'sell',
  'reject',
  'expire',
  'counterfactual',
]);
export type SandboxReplayChartActionKind = z.infer<typeof sandboxReplayChartActionKindSchema>;

export const sandboxReplayChartCandleSchema = z.object({
  time: z.number().int().nonnegative(),
  openUsd: sandboxReportDecimalSchema,
  highUsd: sandboxReportDecimalSchema,
  lowUsd: sandboxReportDecimalSchema,
  closeUsd: sandboxReportDecimalSchema,
});
export type SandboxReplayChartCandle = z.infer<typeof sandboxReplayChartCandleSchema>;

export const sandboxReplayChartTokenSchema = z.object({
  tokenId: z.string().min(1),
  candles: z.array(sandboxReplayChartCandleSchema),
});
export type SandboxReplayChartToken = z.infer<typeof sandboxReplayChartTokenSchema>;

export const sandboxReplayChartActionSchema = z.object({
  id: z.string().min(1),
  tokenId: z.string().min(1),
  time: z.number().int().nonnegative(),
  kind: sandboxReplayChartActionKindSchema,
  priceUsd: sandboxReportDecimalNullableSchema,
  amountUsd: sandboxReportDecimalSchema,
  pnlUsd: sandboxReportDecimalNullableSchema,
  reasonCode: z.string().min(1),
  reasonText: z.string(),
  intentId: z.string().nullable(),
  tradeId: z.string().nullable(),
});
export type SandboxReplayChartAction = z.infer<typeof sandboxReplayChartActionSchema>;

export const sandboxReplayChartResponseSchema = z.object({
  replayId: z.uuid(),
  tokens: z.array(sandboxReplayChartTokenSchema),
  actions: z.array(sandboxReplayChartActionSchema),
  note: z.string(),
});
export type SandboxReplayChartResponse = z.infer<typeof sandboxReplayChartResponseSchema>;

export const sandboxReplayDecisionActionSchema = z.enum(['buy', 'sell', 'hold', 'block', 'noop']);
export type SandboxReplayDecisionAction = z.infer<typeof sandboxReplayDecisionActionSchema>;

export const sandboxReplayDecisionSchema = z.object({
  time: z.number().int().nonnegative(),
  tokenId: z.string().min(1),
  strategyKey: z.string(),
  action: sandboxReplayDecisionActionSchema,
  sizeUsd: sandboxReportDecimalNullableSchema,
  reasonCode: z.string().min(1),
  reasonText: z.string(),
});
export type SandboxReplayDecision = z.infer<typeof sandboxReplayDecisionSchema>;

export const sandboxReplayDecisionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().nonnegative().default(0),
  tokenId: z.string().min(1).optional(),
});
export type SandboxReplayDecisionsQuery = z.infer<typeof sandboxReplayDecisionsQuerySchema>;

export const sandboxReplayDecisionsResponseSchema = z.object({
  items: z.array(sandboxReplayDecisionSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
});
export type SandboxReplayDecisionsResponse = z.infer<typeof sandboxReplayDecisionsResponseSchema>;

export const sandboxTokenCandidateSchema = z.object({
  assetId: z.uuid(),
  tokenKey: z.string().min(1).max(80),
  symbol: z.string().min(1).max(40),
  name: z.string().min(1).max(80),
  chain: z.string().min(1),
  contractAddress: z.string().nullable(),
  eligible: z.boolean(),
  reason: z.string().nullable(),
});
export type SandboxTokenCandidate = z.infer<typeof sandboxTokenCandidateSchema>;

export const sandboxTokenCandidatesResponseSchema = z.object({
  candidates: z.array(sandboxTokenCandidateSchema),
});
export type SandboxTokenCandidatesResponse = z.infer<typeof sandboxTokenCandidatesResponseSchema>;
