import { z } from 'zod';

export const decimalStringSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/, 'Expected a decimal string');

export const positiveDecimalSchema = decimalStringSchema.refine(
  (value) => !value.startsWith('-') && value !== '0' && !/^0(?:\.0+)?$/.test(value),
  'Expected a positive decimal',
);

export const nonNegativeDecimalSchema = decimalStringSchema.refine(
  (value) => !value.startsWith('-'),
  'Expected a non-negative decimal',
);

export const accountTypeSchema = z.enum(['wallet', 'external', 'income', 'expense', 'equity']);
export const transactionTypeSchema = z.enum([
  'trade',
  'transfer',
  'deposit',
  'withdrawal',
  'fee',
  'income',
  'adjustment',
]);
export const transactionSubtypeSchema = z.enum([
  'buy',
  'sell',
  'swap',
  'transfer',
  'deposit',
  'withdrawal',
  'fee',
  'income',
  'adjustment',
]);
export const transactionSourceSchema = z.enum(['manual', 'notion', 'onchain', 'system']);
export const tradeGroupStatusSchema = z.enum(['open', 'partial', 'closed', 'reserve', 'for_sale']);

export const chainSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
});

export const assetSchema = z.object({
  id: z.uuid(),
  chainId: z.uuid(),
  chainCode: z.string(),
  symbol: z.string(),
  name: z.string(),
  decimals: z.number().int(),
  contractAddress: z.string().nullable(),
  coingeckoId: z.string().nullable(),
  isStablecoin: z.boolean(),
  isCashEquivalent: z.boolean(),
  isVerified: z.boolean(),
});

export const accountSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  type: accountTypeSchema,
  chainId: z.uuid().nullable(),
  chainCode: z.string().nullable(),
  isSystem: z.boolean(),
});

export const postingSchema = z.object({
  id: z.uuid(),
  accountId: z.uuid(),
  assetId: z.uuid(),
  amount: z.string(),
  usdValue: z.string(),
});

export const transactionSchema = z.object({
  id: z.uuid(),
  type: transactionTypeSchema,
  subtype: transactionSubtypeSchema,
  source: transactionSourceSchema,
  sourceId: z.string().nullable(),
  tradeGroupId: z.uuid().nullable(),
  occurredAt: z.iso.datetime(),
  notes: z.string().nullable(),
  feesUsd: z.string(),
  postings: z.array(postingSchema),
});

const manualBase = {
  occurredAt: z.iso.datetime().optional(),
  notes: z.string().max(2000).optional(),
};

const feeFields = {
  feeAssetId: z.uuid().optional(),
  feeAmount: positiveDecimalSchema.optional(),
  feeUsdValue: nonNegativeDecimalSchema.optional(),
};

export const manualBuySchema = z.object({
  type: z.literal('buy'),
  accountId: z.uuid(),
  assetId: z.uuid(),
  amount: positiveDecimalSchema,
  quoteAssetId: z.uuid(),
  quoteAmount: positiveDecimalSchema,
  usdValue: positiveDecimalSchema.optional(),
  ...feeFields,
  ...manualBase,
});

export const manualSellSchema = z.object({
  type: z.literal('sell'),
  accountId: z.uuid(),
  assetId: z.uuid(),
  amount: positiveDecimalSchema,
  proceedsAssetId: z.uuid(),
  proceedsAmount: positiveDecimalSchema,
  tradeGroupId: z.uuid().optional(),
  usdValue: positiveDecimalSchema.optional(),
  ...feeFields,
  ...manualBase,
});

export const manualSwapSchema = z.object({
  type: z.literal('swap'),
  accountId: z.uuid(),
  assetInId: z.uuid(),
  amountIn: positiveDecimalSchema,
  assetOutId: z.uuid(),
  amountOut: positiveDecimalSchema,
  usdValueIn: positiveDecimalSchema.optional(),
  usdValueOut: positiveDecimalSchema.optional(),
  ...feeFields,
  ...manualBase,
});

export const manualTransferSchema = z.object({
  type: z.literal('transfer'),
  fromAccountId: z.uuid(),
  toAccountId: z.uuid(),
  assetId: z.uuid(),
  amount: positiveDecimalSchema,
  usdValue: positiveDecimalSchema.optional(),
  ...feeFields,
  ...manualBase,
});

export const manualDepositSchema = z.object({
  type: z.literal('deposit'),
  accountId: z.uuid(),
  assetId: z.uuid(),
  amount: positiveDecimalSchema,
  usdValue: positiveDecimalSchema,
  ...manualBase,
});

export const manualWithdrawalSchema = z.object({
  type: z.literal('withdrawal'),
  accountId: z.uuid(),
  assetId: z.uuid(),
  amount: positiveDecimalSchema,
  usdValue: positiveDecimalSchema,
  ...manualBase,
});

export const manualIncomeSchema = z.object({
  type: z.literal('income'),
  accountId: z.uuid(),
  assetId: z.uuid(),
  amount: positiveDecimalSchema,
  usdValue: positiveDecimalSchema,
  ...manualBase,
});

export const manualAdjustmentSchema = z.object({
  type: z.literal('adjustment'),
  accountId: z.uuid(),
  assetId: z.uuid(),
  amount: positiveDecimalSchema,
  usdValue: positiveDecimalSchema,
  reason: z.string().min(1).max(1000),
  ...manualBase,
});

export const manualTransactionRequestSchema = z.discriminatedUnion('type', [
  manualBuySchema,
  manualSellSchema,
  manualSwapSchema,
  manualTransferSchema,
  manualDepositSchema,
  manualWithdrawalSchema,
  manualIncomeSchema,
  manualAdjustmentSchema,
]);

export const manualTransactionResponseSchema = z.object({
  transaction: transactionSchema,
});

export const transactionsResponseSchema = z.object({
  transactions: z.array(transactionSchema),
});

export const accountsResponseSchema = z.object({
  accounts: z.array(accountSchema),
});

export const assetsResponseSchema = z.object({
  assets: z.array(assetSchema),
});

export const setPriceRequestSchema = z.object({
  priceUsd: nonNegativeDecimalSchema,
  observedAt: z.iso.datetime().optional(),
});

export const priceSchema = z.object({
  id: z.uuid(),
  assetId: z.uuid(),
  priceUsd: z.string(),
  observedAt: z.iso.datetime(),
  source: z.string(),
});

export const pricesResponseSchema = z.object({
  prices: z.array(priceSchema),
});

export const positionSchema = z.object({
  asset: assetSchema,
  amount: z.string(),
  priceUsd: z.string().nullable(),
  valueUsd: z.string().nullable(),
  costBasisUsd: z.string(),
  unrealizedPnlUsd: z.string().nullable(),
  isCashEquivalent: z.boolean(),
});

export const positionsResponseSchema = z.object({
  positions: z.array(positionSchema),
  cashUsd: z.string(),
  positionsValueUsd: z.string(),
  equityUsd: z.string(),
  missingPrices: z.array(z.string()),
});

export const dashboardSummarySchema = z.object({
  cashUsd: z.string(),
  positionsValueUsd: z.string(),
  equityUsd: z.string(),
  netDepositsUsd: z.string(),
  incomeUsd: z.string(),
  adjustmentsUsd: z.string(),
  feesUsd: z.string(),
  realizedPnlUsd: z.string(),
  unrealizedPnlUsd: z.string(),
  totalPnlUsd: z.string(),
  missingPrices: z.array(z.string()),
});

export type DecimalString = z.infer<typeof decimalStringSchema>;
export type AccountType = z.infer<typeof accountTypeSchema>;
export type TransactionType = z.infer<typeof transactionTypeSchema>;
export type TransactionSubtype = z.infer<typeof transactionSubtypeSchema>;
export type TransactionSource = z.infer<typeof transactionSourceSchema>;
export type TradeGroupStatus = z.infer<typeof tradeGroupStatusSchema>;
export type Chain = z.infer<typeof chainSchema>;
export type Asset = z.infer<typeof assetSchema>;
export type Account = z.infer<typeof accountSchema>;
export type Posting = z.infer<typeof postingSchema>;
export type Transaction = z.infer<typeof transactionSchema>;
export type ManualTransactionRequest = z.infer<typeof manualTransactionRequestSchema>;
export type ManualTransactionResponse = z.infer<typeof manualTransactionResponseSchema>;
export type TransactionsResponse = z.infer<typeof transactionsResponseSchema>;
export type AccountsResponse = z.infer<typeof accountsResponseSchema>;
export type AssetsResponse = z.infer<typeof assetsResponseSchema>;
export type SetPriceRequest = z.infer<typeof setPriceRequestSchema>;
export type Price = z.infer<typeof priceSchema>;
export type PricesResponse = z.infer<typeof pricesResponseSchema>;
export type Position = z.infer<typeof positionSchema>;
export type PositionsResponse = z.infer<typeof positionsResponseSchema>;
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;
