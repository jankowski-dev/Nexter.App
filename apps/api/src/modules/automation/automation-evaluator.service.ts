import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { automationRuns, automationRuleState, automationRules, type Database } from '@nexter/db';
import {
  automationBuyParamsSchema,
  automationStopLossParamsSchema,
  automationTakeProfitParamsSchema,
  automationTrailingStopParamsSchema,
  type AutomationRuleKind,
} from '@nexter/contracts';
import Decimal from 'decimal.js';
import { DB } from '../../shared/db/db.module';
import { MarketQuoteService } from '../market-data/market-quote.service';
import { SettingsService } from '../settings/settings.service';
import { TradeGroupsService } from '../accounting/trade-groups.service';

export interface AutomationEvaluation {
  status: 'would_execute' | 'skipped';
  reason: string;
  triggerKey: string;
  triggerPriceUsd: string | null;
  amount: string | null;
  usdValue: string | null;
  tradeGroupId: string | null;
  highWaterUsd: string | null;
}

type RuleRecord = typeof automationRules.$inferSelect;

function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

function pct(value: Decimal): string {
  return `${value.gte(0) ? '+' : ''}${value.toFixed(2)}%`;
}

@Injectable()
export class AutomationEvaluatorService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly settings: SettingsService,
    private readonly quotes: MarketQuoteService,
    private readonly tradeGroups: TradeGroupsService,
  ) {}

  async evaluate(rule: RuleRecord): Promise<AutomationEvaluation> {
    const base: AutomationEvaluation = {
      status: 'skipped',
      reason: 'Условие не выполнено',
      triggerKey: `${rule.id}:${rule.kind}:${utcDay()}`,
      triggerPriceUsd: null,
      amount: null,
      usdValue: null,
      tradeGroupId: rule.tradeGroupId,
      highWaterUsd: null,
    };

    const runtime = await this.settings.getRuntime();
    if (!runtime.automationEnabled) {
      return { ...base, reason: 'Автоматизация выключена в настройках' };
    }

    const quotes = await this.quotes.getQuotes([rule.assetId]);
    const quote = quotes.get(rule.assetId);
    if (!quote) {
      return { ...base, reason: 'Нет котировки' };
    }
    if (Date.now() - quote.fetchedAt.getTime() > runtime.botQuoteMaxAgeSeconds * 1000) {
      return { ...base, reason: 'Котировка устарела' };
    }
    const price = new Decimal(quote.priceUsd);
    if (!price.isFinite() || price.lte(0)) {
      return { ...base, reason: 'Некорректная котировка' };
    }

    if (rule.lastTriggeredAt) {
      const elapsed = Date.now() - rule.lastTriggeredAt.getTime();
      if (elapsed < rule.cooldownMinutes * 60_000) {
        return {
          ...base,
          triggerPriceUsd: price.toFixed(18),
          reason: 'Пауза между срабатываниями',
        };
      }
    }

    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    const [usage] = await this.db
      .select({
        count: sql<number>`count(*)::int`,
        total: sql<string>`coalesce(sum(${automationRuns.usdValue}), 0)::text`,
      })
      .from(automationRuns)
      .where(
        and(
          eq(automationRuns.userId, rule.userId),
          gte(automationRuns.createdAt, dayStart),
          inArray(automationRuns.status, ['would_execute', 'proposed']),
        ),
      );

    if ((usage?.count ?? 0) >= runtime.automationMaxActionsPerDay) {
      return {
        ...base,
        triggerPriceUsd: price.toFixed(18),
        reason: 'Дневной лимит срабатываний',
      };
    }

    const [state] = await this.db
      .select()
      .from(automationRuleState)
      .where(eq(automationRuleState.ruleId, rule.id))
      .limit(1);

    const stateHigh = state?.highWaterUsd ? new Decimal(state.highWaterUsd) : null;

    if (rule.kind === 'buy') {
      return this.evaluateBuy(rule, price, runtime, usage?.total ?? '0', stateHigh);
    }

    return this.evaluateClose(rule, price, stateHigh);
  }

  private async evaluateBuy(
    rule: RuleRecord,
    price: Decimal,
    runtime: Awaited<ReturnType<SettingsService['getRuntime']>>,
    dailyTotal: string,
    stateHigh: Decimal | null,
  ): Promise<AutomationEvaluation> {
    const parsed = automationBuyParamsSchema.safeParse(rule.params);
    if (!parsed.success) {
      return this.skip(rule, price, 'Некорректные параметры правила');
    }
    const params = parsed.data;

    let highWater = stateHigh && stateHigh.gt(price) ? stateHigh : price;
    let condition = false;
    let reason = 'Условие не выполнено';

    if (params.target === 'price_below' && params.thresholdUsd) {
      const threshold = new Decimal(params.thresholdUsd);
      condition = price.lte(threshold);
      reason = condition
        ? `Цена ${price.toFixed(8)} ниже порога ${threshold.toFixed(8)}`
        : `Цена ${price.toFixed(8)} выше порога ${threshold.toFixed(8)}`;
    } else if (params.target === 'drop_from_high' && params.dropPct !== undefined) {
      highWater = highWater.gt(price) ? highWater : price;
      const drop = highWater.minus(price).div(highWater).times(100);
      condition = drop.gte(params.dropPct);
      reason = condition
        ? `Падение ${drop.toFixed(2)}% от максимума ${highWater.toFixed(8)}`
        : `Падение ${drop.toFixed(2)}% меньше ${params.dropPct}%`;
    }

    if (!condition) {
      return {
        ...this.skip(rule, price, reason),
        highWaterUsd: highWater.toFixed(18),
      };
    }
    if (params.maxPriceUsd && price.gt(params.maxPriceUsd)) {
      return {
        ...this.skip(rule, price, `Цена выше защитного максимума ${params.maxPriceUsd}`),
        highWaterUsd: highWater.toFixed(18),
      };
    }

    const requested = new Decimal(params.amountUsd);
    const perOrder = rule.maxOrderUsd
      ? new Decimal(rule.maxOrderUsd)
      : new Decimal(runtime.automationMaxOrderUsd);
    const dailyRemaining = new Decimal(runtime.automationMaxDailyUsd).minus(
      new Decimal(dailyTotal),
    );
    const usdValue = Decimal.min(requested, perOrder, dailyRemaining);

    if (!usdValue.isFinite() || usdValue.lt(1)) {
      return {
        ...this.skip(rule, price, 'Дневной лимит суммы автоматизации исчерпан'),
        highWaterUsd: highWater.toFixed(18),
      };
    }

    const amount = usdValue.div(price);
    return {
      status: 'would_execute',
      reason: `${reason}. Купить на ${usdValue.toFixed(2)} USD`,
      triggerKey: `${rule.id}:buy:${utcDay()}`,
      triggerPriceUsd: price.toFixed(18),
      amount: amount.toFixed(18),
      usdValue: usdValue.toFixed(2),
      tradeGroupId: null,
      highWaterUsd: highWater.toFixed(18),
    };
  }

  private async evaluateClose(
    rule: RuleRecord,
    price: Decimal,
    stateHigh: Decimal | null,
  ): Promise<AutomationEvaluation> {
    if (!rule.tradeGroupId) {
      return this.skip(rule, price, 'Правило не привязано к сделке');
    }

    let detail;
    try {
      detail = await this.tradeGroups.get(rule.userId, rule.tradeGroupId);
    } catch {
      return this.skip(rule, price, 'Сделка не найдена');
    }

    const group = detail.group;
    if (group.status === 'closed') {
      return this.skip(rule, price, 'Сделка уже закрыта');
    }
    if (group.asset.id !== rule.assetId) {
      return this.skip(rule, price, 'Актив правила не совпадает со сделкой');
    }

    const remaining = new Decimal(group.remainingAmount);
    const cost = new Decimal(group.remainingCostBasisUsd);
    if (remaining.lte(0) || cost.lte(0)) {
      return this.skip(rule, price, 'В сделке не осталось актива');
    }
    const average = cost.div(remaining);
    const pnlPct = price.div(average).minus(1).times(100);

    if (rule.kind === 'stop_loss') {
      const parsed = automationStopLossParamsSchema.safeParse(rule.params);
      if (!parsed.success) return this.skip(rule, price, 'Некорректные параметры стоп-лосса');
      if (pnlPct.gt(-parsed.data.stopLossPct)) {
        return this.skip(rule, price, `Просадка ${pct(pnlPct)} не достигла стоп-лосса`);
      }
      return this.closeProposal(rule, price, remaining, 'stop_loss', 100, pnlPct);
    }

    if (rule.kind === 'take_profit') {
      const parsed = automationTakeProfitParamsSchema.safeParse(rule.params);
      if (!parsed.success) return this.skip(rule, price, 'Некорректные параметры тейк-профита');
      if (pnlPct.lt(parsed.data.takeProfitPct)) {
        return this.skip(rule, price, `Рост ${pct(pnlPct)} не достиг тейк-профита`);
      }
      return this.closeProposal(
        rule,
        price,
        remaining,
        'take_profit',
        parsed.data.partialPct ?? 100,
        pnlPct,
      );
    }

    if (rule.kind === 'trailing_stop') {
      const parsed = automationTrailingStopParamsSchema.safeParse(rule.params);
      if (!parsed.success) return this.skip(rule, price, 'Некорректные параметры трейлинга');
      const highWater = stateHigh && stateHigh.gt(price) ? stateHigh : price;
      const activation = parsed.data.activationPct ?? 0;
      const activated = highWater.gte(average.times(1 + activation / 100));
      if (!activated) {
        return {
          ...this.skip(rule, price, 'Трейлинг ещё не активирован'),
          highWaterUsd: highWater.toFixed(18),
        };
      }
      const drawdown = highWater.minus(price).div(highWater).times(100);
      if (drawdown.lt(parsed.data.trailPct)) {
        return {
          ...this.skip(
            rule,
            price,
            `Откат ${drawdown.toFixed(2)}% меньше ${parsed.data.trailPct}%`,
          ),
          highWaterUsd: highWater.toFixed(18),
        };
      }
      const result = this.closeProposal(rule, price, remaining, 'trailing_stop', 100, pnlPct);
      return { ...result, highWaterUsd: highWater.toFixed(18) };
    }

    return this.skip(rule, price, 'Неизвестный тип правила');
  }

  private closeProposal(
    rule: RuleRecord,
    price: Decimal,
    remaining: Decimal,
    kind: AutomationRuleKind,
    closePct: number,
    pnlPct: Decimal,
  ): AutomationEvaluation {
    const amount = remaining.times(closePct).div(100);
    const usdValue = amount.times(price);
    const label =
      kind === 'stop_loss' ? 'Стоп-лосс' : kind === 'take_profit' ? 'Тейк-профит' : 'Трейлинг-стоп';
    return {
      status: 'would_execute',
      reason: `${label}: ${pct(pnlPct)} к средней цене. Закрыть ${closePct}% (${amount.toFixed(8)}).`,
      triggerKey: `${rule.id}:${kind}:${utcDay()}`,
      triggerPriceUsd: price.toFixed(18),
      amount: amount.toFixed(18),
      usdValue: usdValue.toFixed(2),
      tradeGroupId: rule.tradeGroupId,
      highWaterUsd: null,
    };
  }

  private skip(rule: RuleRecord, price: Decimal, reason: string): AutomationEvaluation {
    return {
      status: 'skipped',
      reason,
      triggerKey: `${rule.id}:${rule.kind}:${utcDay()}`,
      triggerPriceUsd: price.toFixed(18),
      amount: null,
      usdValue: null,
      tradeGroupId: rule.tradeGroupId,
      highWaterUsd: null,
    };
  }
}
