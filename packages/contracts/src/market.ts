import { z } from 'zod';

export const marketTickerItemSchema = z.object({
  id: z.string().min(1),
  symbol: z.string().min(1),
  name: z.string().min(1),
  priceUsd: z.string(),
  change24hPct: z.string().nullable(),
});

export const marketTickerResponseSchema = z.object({
  items: z.array(marketTickerItemSchema),
});

export type MarketTickerItem = z.infer<typeof marketTickerItemSchema>;
export type MarketTickerResponse = z.infer<typeof marketTickerResponseSchema>;
