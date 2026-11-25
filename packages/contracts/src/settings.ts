import { z } from 'zod';
import { AUDIO_MAX_MB_DEFAULT, AUDIO_MAX_MB_MAX, AUDIO_MAX_MB_MIN } from './audio-notes';

export const audioMaxMbSchema = z.number().int().min(AUDIO_MAX_MB_MIN).max(AUDIO_MAX_MB_MAX);

const intRange = (min: number, max: number) => z.number().int().min(min).max(max);
const usdString = z
  .string()
  .trim()
  .max(24)
  .regex(/^\d+(?:\.\d{1,2})?$/, 'Expected a non-negative USD decimal');

export const chartDefaultDaysSchema = z.union([
  z.literal(30),
  z.literal(90),
  z.literal(180),
  z.literal(365),
]);

export const reportPeriodDefaultSchema = z.enum(['30d', '90d', '365d', 'ytd', 'all']);
export const taskDefaultDueTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:MM');

export const settingsInputSchema = z.object({
  includeGasInCostBasis: z.boolean(),
  timezone: z.string().min(1).max(100),
  audioMaxMb: audioMaxMbSchema,

  marketQuoteIntervalSeconds: intRange(30, 3600),
  marketCoinGeckoIntervalSeconds: intRange(60, 86400),
  marketMinLiquidityUsd: usdString,
  chartDefaultDays: chartDefaultDaysSchema,
  chartHistoryRefreshHours: intRange(6, 48),

  swapDefaultSlippageBps: intRange(10, 200),
  swapMaxSlippageBps: intRange(50, 500),
  swapMaxPriceImpactBps: intRange(50, 500),
  swapMaxGasUsd: usdString,
  swapQuoteTtlSeconds: intRange(5, 30),

  botTickIntervalSeconds: intRange(15, 3600),
  botQuoteMaxAgeSeconds: intRange(60, 3600),
  botDefaultBudgetUsd: usdString,
  botDefaultMaxPositions: intRange(1, 20),
  botDefaultPositionSizePct: intRange(1, 100),
  botDefaultFeeBps: intRange(0, 500),
  botDefaultSlippageBps: intRange(0, 500),
  botDefaultDailyLossPct: intRange(0, 100),
  botDefaultCooldownMinutes: intRange(0, 1440),

  taskReminderLeadMinutes: intRange(1, 60),
  taskDefaultDueTime: taskDefaultDueTimeSchema,
  autosaveIntervalSeconds: intRange(5, 60),

  defaultReportPeriod: reportPeriodDefaultSchema,
  dashboardPollSeconds: intRange(5, 300),
  portfolioPollSeconds: intRange(5, 300),
  watchlistPollSeconds: intRange(5, 600),
  reportsPollSeconds: intRange(5, 600),
  notificationsPollSeconds: intRange(5, 600),
  notifyBotStopped: z.boolean(),
  notifyPositionsClosed: z.boolean(),
  notifyTradesClosed: z.boolean(),
  viberNotificationsEnabled: z.boolean(),
  viberTradeClosedEnabled: z.boolean(),
  viberBotStoppedEnabled: z.boolean(),
  viberFrequency: z.enum(['instant', 'hourly', 'daily']),
  viberDigestTime: taskDefaultDueTimeSchema,

  tradeDefaultStopLossPct: intRange(1, 90),
  tradeDefaultTakeProfitPct: intRange(1, 1000),
  tradeDefaultBuyAmountUsd: usdString,
});

export const settingsSchema = settingsInputSchema.extend({
  baseCurrency: z.string(),
  displayCurrency: z.string(),
  taxMethod: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const updateSettingsRequestSchema = settingsInputSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'At least one setting must be provided');

export const settingsInputDefaults = {
  includeGasInCostBasis: true,
  timezone: 'Europe/Minsk',
  audioMaxMb: AUDIO_MAX_MB_DEFAULT,
  marketQuoteIntervalSeconds: 60,
  marketCoinGeckoIntervalSeconds: 600,
  marketMinLiquidityUsd: '25000.00',
  chartDefaultDays: 90 as const,
  chartHistoryRefreshHours: 24,
  swapDefaultSlippageBps: 50,
  swapMaxSlippageBps: 200,
  swapMaxPriceImpactBps: 200,
  swapMaxGasUsd: '5.00',
  swapQuoteTtlSeconds: 15,
  botTickIntervalSeconds: 60,
  botQuoteMaxAgeSeconds: 300,
  botDefaultBudgetUsd: '1000.00',
  botDefaultMaxPositions: 5,
  botDefaultPositionSizePct: 20,
  botDefaultFeeBps: 25,
  botDefaultSlippageBps: 10,
  botDefaultDailyLossPct: 10,
  botDefaultCooldownMinutes: 15,
  taskReminderLeadMinutes: 5,
  taskDefaultDueTime: '12:00',
  autosaveIntervalSeconds: 10,
  defaultReportPeriod: 'all' as const,
  dashboardPollSeconds: 10,
  portfolioPollSeconds: 15,
  watchlistPollSeconds: 30,
  reportsPollSeconds: 30,
  notificationsPollSeconds: 30,
  notifyBotStopped: true,
  notifyPositionsClosed: true,
  notifyTradesClosed: true,
  viberNotificationsEnabled: true,
  viberTradeClosedEnabled: true,
  viberBotStoppedEnabled: true,
  viberFrequency: 'instant' as const,
  viberDigestTime: '20:00',
  tradeDefaultStopLossPct: 10,
  tradeDefaultTakeProfitPct: 20,
  tradeDefaultBuyAmountUsd: '100.00',
} as const;

export type SettingsInput = z.infer<typeof settingsInputSchema>;
export type Settings = z.infer<typeof settingsSchema>;
export type UpdateSettingsRequest = z.infer<typeof updateSettingsRequestSchema>;
export type ChartDefaultDays = z.infer<typeof chartDefaultDaysSchema>;
export type ReportPeriodDefault = z.infer<typeof reportPeriodDefaultSchema>;
