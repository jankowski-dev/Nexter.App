import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { and, asc, eq, gte, ilike, inArray, isNull, sql } from 'drizzle-orm';
import {
  aiCandidates,
  assets,
  botEquitySnapshots,
  botEvents,
  botPositions,
  marketQuotes,
  notifications,
  tradingBots,
  type Database,
  type TradingBotRecord,
} from '@nexter/db';
import type { AiBotHealth, AiBotHealthResponse } from '@nexter/contracts';
import { AuditService } from '../../shared/audit/audit.service';
import { DB } from '../../shared/db/db.module';
import { NotificationsService } from '../notifications/notifications.service';
import { evaluateAiBotHealth, type AiHealthCandidate } from './ai-health.helpers';
import {
  AI_HEALTH_NOTIFICATION_COOLDOWN_MS,
  decideAiHealthNotification,
  toAiHealthNotificationState,
  type AiHealthNotificationDecision,
  type AiHealthNotificationState,
} from './ai-health.notifications';

const CHECK_INTERVAL_MS = 5 * 60_000;
const ERROR_LOOKBACK_MS = 24 * 60 * 60_000;

interface BotRow {
  bot: TradingBotRecord;
  candidate: typeof aiCandidates.$inferSelect | null;
}

@Injectable()
export class AiHealthService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(AiHealthService.name);
  private timer: NodeJS.Timeout | null = null;
  private initialTimer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV === 'test') return;

    this.initialTimer = setTimeout(() => {
      void this.monitor();
    }, 30_000);
    this.initialTimer.unref();

    this.timer = setInterval(() => {
      void this.monitor();
    }, CHECK_INTERVAL_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.initialTimer) clearTimeout(this.initialTimer);
    if (this.timer) clearInterval(this.timer);
    this.initialTimer = null;
    this.timer = null;
  }

  async list(userId: string): Promise<AiBotHealthResponse> {
    const rows = await this.loadBots(userId);
    const data = await this.evaluateRows(rows);
    return { data, generatedAt: new Date().toISOString() };
  }

  private async monitor(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const rows = await this.loadBots();
      const health = await this.evaluateRows(rows);
      for (const item of health) {
        const row = rows.find((entry) => entry.bot.id === item.botId);
        if (!row) continue;
        await this.processHealth(row, item);
      }
    } catch (error) {
      this.logger.error(
        `AI health monitor failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.running = false;
    }
  }

  private async loadBots(userId?: string): Promise<BotRow[]> {
    const where = userId
      ? and(
          eq(tradingBots.userId, userId),
          eq(tradingBots.origin, 'ai'),
          isNull(tradingBots.archivedAt),
        )
      : and(eq(tradingBots.origin, 'ai'), isNull(tradingBots.archivedAt));
    return this.db
      .select({ bot: tradingBots, candidate: aiCandidates })
      .from(tradingBots)
      .leftJoin(aiCandidates, eq(tradingBots.aiCandidateId, aiCandidates.id))
      .where(where)
      .orderBy(asc(tradingBots.createdAt));
  }

  private async evaluateRows(rows: BotRow[]): Promise<AiBotHealth[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.bot.id);
    const now = new Date();
    const dayStart = new Date(now);
    dayStart.setUTCHours(0, 0, 0, 0);
    const snapshotWindowStart = new Date(now.getTime() - 48 * 60 * 60_000);

    const [snapshots, errorEvents, positionRows] = await Promise.all([
      this.db
        .select()
        .from(botEquitySnapshots)
        .where(
          and(
            inArray(botEquitySnapshots.botId, ids),
            gte(botEquitySnapshots.capturedAt, snapshotWindowStart),
          ),
        )
        .orderBy(asc(botEquitySnapshots.capturedAt)),
      this.db
        .select({ botId: botEvents.botId })
        .from(botEvents)
        .where(
          and(
            inArray(botEvents.botId, ids),
            gte(botEvents.createdAt, new Date(now.getTime() - ERROR_LOOKBACK_MS)),
            ilike(botEvents.type, '%error%'),
          ),
        ),
      this.db
        .select({
          botId: botPositions.botId,
          assetId: botPositions.assetId,
          avgCostUsd: botPositions.avgCostUsd,
          symbol: assets.symbol,
        })
        .from(botPositions)
        .innerJoin(assets, eq(assets.id, botPositions.assetId))
        .where(inArray(botPositions.botId, ids)),
    ]);

    const positionAssetIds = [...new Set(positionRows.map((position) => position.assetId))];
    const quoteRows =
      positionAssetIds.length > 0
        ? await this.db
            .select({
              assetId: marketQuotes.assetId,
              priceUsd: marketQuotes.priceUsd,
              fetchedAt: marketQuotes.fetchedAt,
            })
            .from(marketQuotes)
            .where(inArray(marketQuotes.assetId, positionAssetIds))
        : [];
    const quotesByAsset = Object.fromEntries(
      quoteRows.map((quote) => [
        quote.assetId,
        { priceUsd: quote.priceUsd, fetchedAt: quote.fetchedAt },
      ]),
    );
    const positionsByBot = new Map<
      string,
      Array<{ assetId: string; symbol: string; avgCostUsd: string }>
    >();
    for (const position of positionRows) {
      const list = positionsByBot.get(position.botId) ?? [];
      list.push({
        assetId: position.assetId,
        symbol: position.symbol,
        avgCostUsd: position.avgCostUsd,
      });
      positionsByBot.set(position.botId, list);
    }

    const snapshotsByBot = new Map<string, typeof snapshots>();
    for (const snapshot of snapshots) {
      const list = snapshotsByBot.get(snapshot.botId) ?? [];
      list.push(snapshot);
      snapshotsByBot.set(snapshot.botId, list);
    }
    const errorBots = new Set(errorEvents.map((row) => row.botId));

    return rows.map(({ bot, candidate }) => {
      const botSnapshots = snapshotsByBot.get(bot.id) ?? [];
      const latest = botSnapshots.at(-1)?.equityUsd ?? bot.cashUsd;
      const firstToday = botSnapshots.find((snapshot) => snapshot.capturedAt >= dayStart);
      const lastBeforeToday = [...botSnapshots]
        .reverse()
        .find((snapshot) => snapshot.capturedAt < dayStart);
      const dailyOpen = firstToday?.equityUsd ?? lastBeforeToday?.equityUsd ?? null;
      const evaluation = evaluateAiBotHealth({
        status: bot.status as 'draft' | 'running' | 'stopped',
        startedAt: bot.startedAt,
        lastTickAt: bot.lastTickAt,
        maxDrawdownPct: bot.maxDrawdownPct,
        maxDailyLossPct: Number(bot.maxDailyLossPct),
        budgetUsd: bot.budgetUsd,
        equityUsd: latest,
        dailyOpenEquityUsd: dailyOpen,
        candidate: candidate
          ? ({ status: candidate.status, metrics: candidate.metrics } satisfies AiHealthCandidate)
          : null,
        strategyParams: bot.strategyParams as Record<string, unknown>,
        positions: positionsByBot.get(bot.id) ?? [],
        quotes: quotesByAsset,
        recentError: errorBots.has(bot.id),
        now,
      });

      return {
        botId: bot.id,
        name: bot.name,
        status: bot.status as 'draft' | 'running' | 'stopped',
        level: evaluation.level,
        reasons: evaluation.reasons,
        candidateId: candidate?.id ?? null,
        candidateStatus: candidate?.status ?? null,
        horizonDays: evaluation.horizonDays,
        startedAt: bot.startedAt?.toISOString() ?? null,
        lastTickAt: bot.lastTickAt?.toISOString() ?? null,
        equityUsd: latest,
        totalPnlPct: evaluation.totalPnlPct,
      };
    });
  }

  private async processHealth(row: BotRow, health: AiBotHealth): Promise<void> {
    const now = new Date();
    const { latest, recent } = await this.loadNotificationState(row.bot.userId, row.bot.id, now);
    const decision = decideAiHealthNotification({
      level: health.level,
      reasons: health.reasons,
      latest,
      recent,
      now,
    });

    if (decision.kind === null) {
      this.logger.debug(
        `AI health notification suppressed for bot ${row.bot.id} (${health.level}: ${decision.signature || 'ok'})`,
      );
      return;
    }

    if (decision.kind === 'recovered') {
      await this.emitRecovery(row, health);
      return;
    }

    await this.emitRecommendation(row, health, decision);
  }

  private async loadNotificationState(
    userId: string,
    botId: string,
    now: Date,
  ): Promise<{ latest: AiHealthNotificationState | null; recent: AiHealthNotificationState[] }> {
    const cooldownStart = new Date(now.getTime() - AI_HEALTH_NOTIFICATION_COOLDOWN_MS);
    const rows = await this.db
      .select({ payload: notifications.payload, createdAt: notifications.createdAt })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.type, 'ai_bot_health'),
          sql`${notifications.payload}->>'botId' = ${botId}`,
          gte(notifications.createdAt, cooldownStart),
        ),
      )
      .orderBy(sql`${notifications.createdAt} desc`);

    const recent = rows
      .map((row) => toAiHealthNotificationState(row.payload, row.createdAt))
      .filter((entry): entry is AiHealthNotificationState => entry !== null);

    if (recent.length > 0) {
      return { latest: recent[0] ?? null, recent };
    }

    const [latestRow] = await this.db
      .select({ payload: notifications.payload, createdAt: notifications.createdAt })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.type, 'ai_bot_health'),
          sql`${notifications.payload}->>'botId' = ${botId}`,
        ),
      )
      .orderBy(sql`${notifications.createdAt} desc`)
      .limit(1);

    return {
      latest: latestRow
        ? toAiHealthNotificationState(latestRow.payload, latestRow.createdAt)
        : null,
      recent: [],
    };
  }

  private async emitRecovery(row: BotRow, health: AiBotHealth): Promise<void> {
    await this.notifications.create({
      userId: row.bot.userId,
      type: 'ai_bot_health',
      title: `ИИ-робот «${row.bot.name}»: здоровье восстановлено`,
      body: 'Инвалидации больше не обнаружены.',
      href: '/portfolio#robots',
      payload: {
        botId: row.bot.id,
        candidateId: health.candidateId,
        level: 'ok',
        signature: 'ok',
        reasons: [],
        newReasons: [],
      },
    });
  }

  private async emitRecommendation(
    row: BotRow,
    health: AiBotHealth,
    decision: AiHealthNotificationDecision,
  ): Promise<void> {
    const isStop = health.level === 'stop';
    await this.notifications.create({
      userId: row.bot.userId,
      type: 'ai_bot_health',
      title: isStop
        ? `ИИ-робот «${row.bot.name}»: рекомендуется остановить`
        : `ИИ-робот «${row.bot.name}»: нужен пересмотр`,
      body: health.reasons.map((reason) => `${reason.label}: ${reason.detail}`).join('\n'),
      href: '/portfolio#robots',
      payload: {
        botId: row.bot.id,
        candidateId: health.candidateId,
        level: health.level,
        signature: decision.signature,
        reasons: decision.reasonCodes,
        newReasons: decision.newReasonCodes,
      },
    });

    await this.audit.log({
      userId: row.bot.userId,
      action: 'ai_trading.health_recommendation',
      entityType: 'trading_bot',
      entityId: row.bot.id,
      after: {
        level: health.level,
        reasons: decision.reasonCodes,
        newReasons: decision.newReasonCodes,
        totalPnlPct: health.totalPnlPct,
      },
    });
  }
}
