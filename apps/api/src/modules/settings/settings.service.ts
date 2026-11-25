import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { settings, type Database } from '@nexter/db';
import {
  clampAudioMaxMb,
  settingsInputDefaults,
  type Settings,
  type SettingsInput,
  type UpdateSettingsRequest,
} from '@nexter/contracts';
import { AuditService } from '../../shared/audit/audit.service';
import { DB } from '../../shared/db/db.module';

interface SettingsMeta {
  ip?: string;
  userAgent?: string;
}

type UsdKey =
  | 'marketMinLiquidityUsd'
  | 'swapMaxGasUsd'
  | 'botDefaultBudgetUsd'
  | 'backtestDefaultCapitalUsd'
  | 'tradeDefaultBuyAmountUsd';

export interface RuntimeSettings extends Omit<SettingsInput, UsdKey> {
  marketMinLiquidityUsd: number;
  swapMaxGasUsd: number;
  botDefaultBudgetUsd: number;
  backtestDefaultCapitalUsd: number;
  tradeDefaultBuyAmountUsd: number;
}

@Injectable()
export class SettingsService {
  private runtimeCache: { value: RuntimeSettings; expiresAt: number } | null = null;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async get(userId: string): Promise<Settings> {
    const [row] = await this.db.select().from(settings).where(eq(settings.userId, userId)).limit(1);

    if (row) return this.toContract(row);

    return this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(settings)
        .values({ userId })
        .onConflictDoNothing()
        .returning();

      if (!created) {
        const [existing] = await tx
          .select()
          .from(settings)
          .where(eq(settings.userId, userId))
          .limit(1);

        if (!existing) throw new Error('Failed to create settings');
        return this.toContract(existing);
      }

      const contract = this.toContract(created);
      await this.audit.log(
        {
          userId,
          action: 'settings.created',
          entityType: 'settings',
          entityId: userId,
          after: contract,
        },
        { executor: tx, strict: true },
      );

      return contract;
    });
  }

  /**
   * Single-owner app: background jobs and bot endpoints have no user session.
   * The 30-second cache avoids a settings query on every market/bot tick.
   */
  async getRuntime(): Promise<RuntimeSettings> {
    const now = Date.now();
    if (this.runtimeCache && this.runtimeCache.expiresAt > now) {
      return this.runtimeCache.value;
    }

    const [row] = await this.db.select().from(settings).limit(1);
    const source = (row ?? {}) as Partial<SettingsInput>;
    const value = this.toRuntime(source);
    this.runtimeCache = { value, expiresAt: now + 30_000 };
    return value;
  }

  async getOwnerAudioMaxMb(): Promise<number> {
    return (await this.getRuntime()).audioMaxMb;
  }

  async update(
    userId: string,
    input: UpdateSettingsRequest,
    meta: SettingsMeta,
  ): Promise<Settings> {
    if (input.timezone !== undefined) {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: input.timezone }).format();
      } catch {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'Invalid timezone',
        });
      }
    }

    const before = await this.get(userId);
    const nextDefaultSlippage = input.swapDefaultSlippageBps ?? before.swapDefaultSlippageBps;
    const nextMaxSlippage = input.swapMaxSlippageBps ?? before.swapMaxSlippageBps;

    if (nextDefaultSlippage > nextMaxSlippage) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Default slippage cannot exceed maximum slippage',
      });
    }

    const patch = Object.fromEntries(
      Object.entries(input).filter(([, value]) => value !== undefined),
    ) as Partial<typeof settings.$inferInsert>;

    await this.db.transaction(async (tx) => {
      await tx
        .update(settings)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(settings.userId, userId));

      await this.audit.log(
        {
          userId,
          action: 'settings.updated',
          entityType: 'settings',
          entityId: userId,
          before,
          after: { ...input, changedKeys: Object.keys(input) },
          ip: meta.ip,
          userAgent: meta.userAgent,
        },
        { executor: tx, strict: true },
      );
    });

    this.runtimeCache = null;
    return this.get(userId);
  }

  private toContract(row: typeof settings.$inferSelect): Settings {
    return {
      baseCurrency: row.baseCurrency,
      displayCurrency: row.displayCurrency,
      taxMethod: row.taxMethod,
      includeGasInCostBasis: row.includeGasInCostBasis,
      timezone: row.timezone,
      audioMaxMb: clampAudioMaxMb(row.audioMaxMb),
      marketQuoteIntervalSeconds: row.marketQuoteIntervalSeconds,
      marketCoinGeckoIntervalSeconds: row.marketCoinGeckoIntervalSeconds,
      marketMinLiquidityUsd: row.marketMinLiquidityUsd,
      chartDefaultDays: row.chartDefaultDays as Settings['chartDefaultDays'],
      chartHistoryRefreshHours: row.chartHistoryRefreshHours,
      swapDefaultSlippageBps: row.swapDefaultSlippageBps,
      swapMaxSlippageBps: row.swapMaxSlippageBps,
      swapMaxPriceImpactBps: row.swapMaxPriceImpactBps,
      swapMaxGasUsd: row.swapMaxGasUsd,
      swapQuoteTtlSeconds: row.swapQuoteTtlSeconds,
      botTickIntervalSeconds: row.botTickIntervalSeconds,
      botQuoteMaxAgeSeconds: row.botQuoteMaxAgeSeconds,
      botDefaultBudgetUsd: row.botDefaultBudgetUsd,
      botDefaultMaxPositions: row.botDefaultMaxPositions,
      botDefaultPositionSizePct: row.botDefaultPositionSizePct,
      botDefaultFeeBps: row.botDefaultFeeBps,
      botDefaultSlippageBps: row.botDefaultSlippageBps,
      botDefaultDailyLossPct: row.botDefaultDailyLossPct,
      botDefaultCooldownMinutes: row.botDefaultCooldownMinutes,
      backtestDefaultCapitalUsd: row.backtestDefaultCapitalUsd,
      backtestDefaultFeeBps: row.backtestDefaultFeeBps,
      backtestDefaultSlippageBps: row.backtestDefaultSlippageBps,
      backtestDefaultDays: row.backtestDefaultDays,
      backtestDefaultStopLoss: row.backtestDefaultStopLoss,
      backtestDefaultTakeProfit: row.backtestDefaultTakeProfit,
      backtestDefaultReinvest: row.backtestDefaultReinvest,
      taskReminderLeadMinutes: row.taskReminderLeadMinutes,
      taskDefaultDueTime: row.taskDefaultDueTime,
      autosaveIntervalSeconds: row.autosaveIntervalSeconds,
      defaultReportPeriod: row.defaultReportPeriod as Settings['defaultReportPeriod'],
      dashboardPollSeconds: row.dashboardPollSeconds,
      portfolioPollSeconds: row.portfolioPollSeconds,
      watchlistPollSeconds: row.watchlistPollSeconds,
      reportsPollSeconds: row.reportsPollSeconds,
      notificationsPollSeconds: row.notificationsPollSeconds,
      notifyBotStopped: row.notifyBotStopped,
      notifyPositionsClosed: row.notifyPositionsClosed,
      notifyTradesClosed: row.notifyTradesClosed,
      viberNotificationsEnabled: row.viberNotificationsEnabled,
      viberTradeClosedEnabled: row.viberTradeClosedEnabled,
      viberBotStoppedEnabled: row.viberBotStoppedEnabled,
      viberFrequency: row.viberFrequency as Settings['viberFrequency'],
      viberDigestTime: row.viberDigestTime,
      tradeDefaultStopLossPct: row.tradeDefaultStopLossPct,
      tradeDefaultTakeProfitPct: row.tradeDefaultTakeProfitPct,
      tradeDefaultBuyAmountUsd: row.tradeDefaultBuyAmountUsd,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toRuntime(source: Partial<SettingsInput>): RuntimeSettings {
    const get = <K extends keyof SettingsInput>(key: K): SettingsInput[K] =>
      source[key] ?? settingsInputDefaults[key];

    return {
      includeGasInCostBasis: get('includeGasInCostBasis'),
      timezone: get('timezone'),
      audioMaxMb: clampAudioMaxMb(get('audioMaxMb')),
      marketQuoteIntervalSeconds: get('marketQuoteIntervalSeconds'),
      marketCoinGeckoIntervalSeconds: get('marketCoinGeckoIntervalSeconds'),
      marketMinLiquidityUsd: Number(get('marketMinLiquidityUsd')),
      chartDefaultDays: get('chartDefaultDays'),
      chartHistoryRefreshHours: get('chartHistoryRefreshHours'),
      swapDefaultSlippageBps: get('swapDefaultSlippageBps'),
      swapMaxSlippageBps: get('swapMaxSlippageBps'),
      swapMaxPriceImpactBps: get('swapMaxPriceImpactBps'),
      swapMaxGasUsd: Number(get('swapMaxGasUsd')),
      swapQuoteTtlSeconds: get('swapQuoteTtlSeconds'),
      botTickIntervalSeconds: get('botTickIntervalSeconds'),
      botQuoteMaxAgeSeconds: get('botQuoteMaxAgeSeconds'),
      botDefaultBudgetUsd: Number(get('botDefaultBudgetUsd')),
      botDefaultMaxPositions: get('botDefaultMaxPositions'),
      botDefaultPositionSizePct: get('botDefaultPositionSizePct'),
      botDefaultFeeBps: get('botDefaultFeeBps'),
      botDefaultSlippageBps: get('botDefaultSlippageBps'),
      botDefaultDailyLossPct: get('botDefaultDailyLossPct'),
      botDefaultCooldownMinutes: get('botDefaultCooldownMinutes'),
      backtestDefaultCapitalUsd: Number(get('backtestDefaultCapitalUsd')),
      backtestDefaultFeeBps: get('backtestDefaultFeeBps'),
      backtestDefaultSlippageBps: get('backtestDefaultSlippageBps'),
      backtestDefaultDays: get('backtestDefaultDays'),
      backtestDefaultStopLoss: get('backtestDefaultStopLoss'),
      backtestDefaultTakeProfit: get('backtestDefaultTakeProfit'),
      backtestDefaultReinvest: get('backtestDefaultReinvest'),
      taskReminderLeadMinutes: get('taskReminderLeadMinutes'),
      taskDefaultDueTime: get('taskDefaultDueTime'),
      autosaveIntervalSeconds: get('autosaveIntervalSeconds'),
      defaultReportPeriod: get('defaultReportPeriod'),
      dashboardPollSeconds: get('dashboardPollSeconds'),
      portfolioPollSeconds: get('portfolioPollSeconds'),
      watchlistPollSeconds: get('watchlistPollSeconds'),
      reportsPollSeconds: get('reportsPollSeconds'),
      notificationsPollSeconds: get('notificationsPollSeconds'),
      notifyBotStopped: get('notifyBotStopped'),
      notifyPositionsClosed: get('notifyPositionsClosed'),
      notifyTradesClosed: get('notifyTradesClosed'),
      viberNotificationsEnabled: get('viberNotificationsEnabled'),
      viberTradeClosedEnabled: get('viberTradeClosedEnabled'),
      viberBotStoppedEnabled: get('viberBotStoppedEnabled'),
      viberFrequency: get('viberFrequency'),
      viberDigestTime: get('viberDigestTime'),
      tradeDefaultStopLossPct: get('tradeDefaultStopLossPct'),
      tradeDefaultTakeProfitPct: get('tradeDefaultTakeProfitPct'),
      tradeDefaultBuyAmountUsd: Number(get('tradeDefaultBuyAmountUsd')),
    };
  }
}
