import { z } from 'zod';
import { positiveDecimalSchema } from './accounting';
import { pageMetaSchema } from './pagination';

export const swapStatusSchema = z.enum([
  'QUOTED',
  'BUILT',
  'APPROVAL_REQUIRED',
  'READY',
  'AWAITING_SIGNATURE',
  'SUBMITTED',
  'PENDING',
  'CONFIRMED',
  'FAILED',
  'REPLACED',
  'DROPPED',
  'EXPIRED',
  'CANCELLED',
]);

export const swapChainCodeSchema = z.literal('bsc');

export const swapTokenSchema = z.object({
  symbol: z.string(),
  name: z.string(),
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  decimals: z.number().int().min(0).max(36),
  native: z.boolean(),
});

export const swapChainConfigSchema = z.object({
  code: swapChainCodeSchema,
  chainId: z.number().int().positive(),
  name: z.string(),
  tokens: z.array(swapTokenSchema),
});

export const swapConfigResponseSchema = z.object({
  enabled: z.boolean(),
  killSwitch: z.boolean(),
  providerConfigured: z.boolean(),
  providerMode: z.enum(['gateway', 'fallback']),
  rpcConfigured: z.boolean(),
  walletAllowlistConfigured: z.boolean(),
  chains: z.array(swapChainConfigSchema),
  quoteTtlSeconds: z.number().int().positive(),
  maxPriceImpactBps: z.number().int().nonnegative(),
  defaultSlippageBps: z.number().int().positive(),
  maxSlippageBps: z.number().int().positive(),
});

export const swapQuoteRequestSchema = z
  .object({
    chain: swapChainCodeSchema,
    tokenIn: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    tokenOut: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    amountIn: positiveDecimalSchema,
    slippageBps: z.number().int().min(1).max(200).optional(),
    walletAddress: z
      .string()
      .regex(/^0x[0-9a-fA-F]{40}$/)
      .optional(),
  })
  .refine((value) => value.tokenIn.toLowerCase() !== value.tokenOut.toLowerCase(), {
    message: 'tokenIn and tokenOut must differ',
    path: ['tokenOut'],
  });

export const swapOrderSummarySchema = z.object({
  id: z.uuid(),
  chain: swapChainCodeSchema,
  walletAddress: z.string().nullable(),
  tokenIn: swapTokenSchema,
  tokenOut: swapTokenSchema,
  amountIn: z.string(),
  amountOut: z.string(),
  amountInUsd: z.string().nullable(),
  amountOutUsd: z.string().nullable(),
  minOut: z.string(),
  slippageBps: z.number().int(),
  priceImpactBps: z.number().int().nullable(),
  gasUsd: z.string().nullable(),
  routeId: z.string().nullable(),
  status: swapStatusSchema,
  quoteExpiresAt: z.iso.datetime(),
  builtAt: z.iso.datetime().nullable(),
  cancelledAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});

export const swapOrderDetailSchema = swapOrderSummarySchema.extend({
  routerAddress: z.string().nullable(),
  calldata: z.string().nullable(),
  transactionValue: z.string().nullable(),
  gasEstimate: z.string().nullable(),
  errors: z.array(z.string()),
  events: z.array(
    z.object({
      id: z.uuid(),
      type: z.string(),
      payload: z.unknown(),
      createdAt: z.iso.datetime(),
    }),
  ),
});

export const swapOrdersQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).optional(),
  status: swapStatusSchema.optional(),
});

export const swapOrdersResponseSchema = z.object({
  data: z.array(swapOrderSummarySchema),
  page: pageMetaSchema,
});

export const swapBuildRequestSchema = z.object({
  orderId: z.uuid(),
  walletAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
});

export const swapBuildResponseSchema = swapOrderDetailSchema.extend({
  simulation: z
    .object({
      success: z.boolean(),
      revertReason: z.string().nullable(),
      gasEstimate: z.string().nullable(),
    })
    .nullable(),
  validation: z.array(
    z.object({
      check: z.string(),
      passed: z.boolean(),
      detail: z.string().nullable(),
    }),
  ),
});

export type SwapStatus = z.infer<typeof swapStatusSchema>;
export type SwapToken = z.infer<typeof swapTokenSchema>;
export type SwapChainConfig = z.infer<typeof swapChainConfigSchema>;
export type SwapConfigResponse = z.infer<typeof swapConfigResponseSchema>;
export type SwapQuoteRequest = z.infer<typeof swapQuoteRequestSchema>;
export type SwapOrderSummary = z.infer<typeof swapOrderSummarySchema>;
export type SwapOrderDetail = z.infer<typeof swapOrderDetailSchema>;
export type SwapOrdersQuery = z.infer<typeof swapOrdersQuerySchema>;
export type SwapOrdersResponse = z.infer<typeof swapOrdersResponseSchema>;
export type SwapBuildRequest = z.infer<typeof swapBuildRequestSchema>;
export type SwapBuildResponse = z.infer<typeof swapBuildResponseSchema>;
