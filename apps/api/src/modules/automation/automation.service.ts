import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { assets, automationRules, automationRuns, chains, type Database } from '@nexter/db';
import {
  automationBuyParamsSchema,
  automationStopLossParamsSchema,
  automationTakeProfitParamsSchema,
  automationTrailingStopParamsSchema,
  type Asset,
  type AutomationRule,
  type AutomationRuleCreateRequest,
  type AutomationRuleUpdateRequest,
  type AutomationRunsResponse,
  type AutomationRulesResponse,
  type AutomationTestResponse,
} from '@nexter/contracts';
import { AuditService } from '../../shared/audit/audit.service';
import { DB } from '../../shared/db/db.module';
import { TradeGroupsService } from '../accounting/trade-groups.service';
import { AutomationEvaluatorService } from './automation-evaluator.service';

interface AutomationMeta {
  ip?: string;
  userAgent?: string;
}

function toAsset(row: {
  assets: typeof assets.$inferSelect;
  chains: typeof chains.$inferSelect;
}): Asset {
  return {
    id: row.assets.id,
    chainId: row.assets.chainId,
    chainCode: row.chains.code,
    symbol: row.assets.symbol,
    name: row.assets.name,
    decimals: row.assets.decimals,
    contractAddress: row.assets.contractAddress,
    coingeckoId: row.assets.coingeckoId,
    logoUrl: row.assets.logoUrl,
    isStablecoin: row.assets.isStablecoin,
    isCashEquivalent: row.assets.isCashEquivalent,
    isVerified: row.assets.isVerified,
  };
}

@Injectable()
export class AutomationService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly tradeGroups: TradeGroupsService,
    private readonly evaluator: AutomationEvaluatorService,
  ) {}

  async list(userId: string): Promise<AutomationRulesResponse> {
    const rows = await this.db
      .select({ rule: automationRules, asset: assets, chain: chains })
      .from(automationRules)
      .innerJoin(assets, eq(assets.id, automationRules.assetId))
      .innerJoin(chains, eq(chains.id, assets.chainId))
      .where(eq(automationRules.userId, userId))
      .orderBy(desc(automationRules.createdAt));

    return {
      rules: rows.map((row) =>
        this.toContract(row.rule, toAsset({ assets: row.asset, chains: row.chain })),
      ),
    };
  }

  async create(
    userId: string,
    input: AutomationRuleCreateRequest,
    meta: AutomationMeta,
  ): Promise<AutomationRule> {
    const [assetRow] = await this.db
      .select({ assets: assets, chains: chains })
      .from(assets)
      .innerJoin(chains, eq(chains.id, assets.chainId))
      .where(eq(assets.id, input.assetId))
      .limit(1);

    if (!assetRow) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Asset not found' });
    }

    await this.assertRuleInput(userId, input.kind, input.assetId, input.tradeGroupId ?? null);

    const [created] = await this.db
      .insert(automationRules)
      .values({
        userId,
        name: input.name,
        kind: input.kind,
        assetId: input.assetId,
        tradeGroupId: input.kind === 'buy' ? null : input.tradeGroupId,
        status: 'draft',
        executionMode: input.executionMode,
        params: input.params,
        maxOrderUsd: input.maxOrderUsd ?? null,
        cooldownMinutes: input.cooldownMinutes,
      })
      .returning();

    if (!created) throw new Error('Failed to create automation rule');

    await this.audit.log(
      {
        userId,
        action: 'automation.rule_created',
        entityType: 'automation_rule',
        entityId: created.id,
        after: {
          name: created.name,
          kind: created.kind,
          assetId: created.assetId,
          tradeGroupId: created.tradeGroupId,
          executionMode: created.executionMode,
          params: created.params,
          maxOrderUsd: created.maxOrderUsd,
          cooldownMinutes: created.cooldownMinutes,
        },
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
      { strict: true },
    );

    return this.toContract(created, toAsset(assetRow));
  }

  async update(
    userId: string,
    id: string,
    input: AutomationRuleUpdateRequest,
    meta: AutomationMeta,
  ): Promise<AutomationRule> {
    const existing = await this.requireRule(userId, id);

    if (input.params !== undefined) {
      this.parseParams(existing.kind, input.params);
    }

    if (input.status === 'armed') {
      await this.assertRuleInput(userId, existing.kind, existing.assetId, existing.tradeGroupId);
    }

    const [updated] = await this.db
      .update(automationRules)
      .set({
        name: input.name ?? existing.name,
        status: input.status ?? existing.status,
        executionMode: input.executionMode ?? existing.executionMode,
        params: input.params ?? existing.params,
        maxOrderUsd: input.maxOrderUsd !== undefined ? input.maxOrderUsd : existing.maxOrderUsd,
        cooldownMinutes: input.cooldownMinutes ?? existing.cooldownMinutes,
        updatedAt: new Date(),
      })
      .where(and(eq(automationRules.id, id), eq(automationRules.userId, userId)))
      .returning();

    if (!updated) throw new Error('Failed to update automation rule');

    await this.audit.log(
      {
        userId,
        action: 'automation.rule_updated',
        entityType: 'automation_rule',
        entityId: id,
        before: existing,
        after: input,
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
      { strict: true },
    );

    const [assetRow] = await this.db
      .select({ assets: assets, chains: chains })
      .from(assets)
      .innerJoin(chains, eq(chains.id, assets.chainId))
      .where(eq(assets.id, updated.assetId))
      .limit(1);

    if (!assetRow) throw new Error('Automation asset not found');
    return this.toContract(updated, toAsset(assetRow));
  }

  async pauseAll(userId: string, meta: AutomationMeta): Promise<AutomationRulesResponse> {
    await this.db
      .update(automationRules)
      .set({ status: 'paused', updatedAt: new Date() })
      .where(and(eq(automationRules.userId, userId), eq(automationRules.status, 'armed')));

    await this.audit.log(
      {
        userId,
        action: 'automation.rules_paused',
        entityType: 'automation_rule',
        entityId: userId,
        after: { status: 'paused' },
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
      { strict: true },
    );

    return this.list(userId);
  }

  async runs(userId: string, limit = 50): Promise<AutomationRunsResponse> {
    const rows = await this.db
      .select({ run: automationRuns, ruleName: automationRules.name })
      .from(automationRuns)
      .innerJoin(automationRules, eq(automationRules.id, automationRuns.ruleId))
      .where(eq(automationRuns.userId, userId))
      .orderBy(desc(automationRuns.createdAt))
      .limit(Math.min(Math.max(limit, 1), 200));

    return {
      runs: rows.map((row) => ({
        id: row.run.id,
        ruleId: row.run.ruleId,
        ruleName: row.ruleName,
        status: row.run.status as AutomationRunsResponse['runs'][number]['status'],
        triggerKey: row.run.triggerKey,
        reason: row.run.reason,
        triggerPriceUsd: row.run.triggerPriceUsd,
        amount: row.run.amount,
        usdValue: row.run.usdValue,
        tradeGroupId: row.run.tradeGroupId,
        createdAt: row.run.createdAt.toISOString(),
      })),
    };
  }

  async test(userId: string, id: string): Promise<AutomationTestResponse> {
    const rule = await this.requireRule(userId, id);
    const evaluation = await this.evaluator.evaluate(rule);
    return {
      status: evaluation.status,
      reason: evaluation.reason,
      triggerPriceUsd: evaluation.triggerPriceUsd,
      amount: evaluation.amount,
      usdValue: evaluation.usdValue,
    };
  }

  private async requireRule(
    userId: string,
    id: string,
  ): Promise<typeof automationRules.$inferSelect> {
    const [rule] = await this.db
      .select()
      .from(automationRules)
      .where(and(eq(automationRules.id, id), eq(automationRules.userId, userId)))
      .limit(1);

    if (!rule) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Automation rule not found' });
    }
    return rule;
  }

  private async assertRuleInput(
    userId: string,
    kind: string,
    assetId: string,
    tradeGroupId: string | null,
  ): Promise<void> {
    if (kind === 'buy') {
      if (tradeGroupId) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'Buy rules cannot be attached to a trade group',
        });
      }
      return;
    }

    if (!tradeGroupId) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Close rules require a trade group',
      });
    }

    let detail;
    try {
      detail = await this.tradeGroups.get(userId, tradeGroupId);
    } catch {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Trade group not found',
      });
    }

    if (detail.group.asset.id !== assetId) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Trade group asset does not match the rule asset',
      });
    }
    if (detail.group.status === 'closed') {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'Trade group is already closed',
      });
    }
  }

  private parseParams(kind: string, params: Record<string, unknown>): void {
    const schema =
      kind === 'buy'
        ? automationBuyParamsSchema
        : kind === 'stop_loss'
          ? automationStopLossParamsSchema
          : kind === 'take_profit'
            ? automationTakeProfitParamsSchema
            : automationTrailingStopParamsSchema;
    const parsed = schema.safeParse(params);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Invalid automation parameters',
        details: parsed.error.issues,
      });
    }
  }

  private toContract(rule: typeof automationRules.$inferSelect, asset: Asset): AutomationRule {
    return {
      id: rule.id,
      name: rule.name,
      kind: rule.kind as AutomationRule['kind'],
      asset,
      tradeGroupId: rule.tradeGroupId,
      status: rule.status as AutomationRule['status'],
      executionMode: rule.executionMode as AutomationRule['executionMode'],
      params: rule.params,
      maxOrderUsd: rule.maxOrderUsd,
      cooldownMinutes: rule.cooldownMinutes,
      lastTriggeredAt: rule.lastTriggeredAt?.toISOString() ?? null,
      triggerCount: rule.triggerCount,
      createdAt: rule.createdAt.toISOString(),
      updatedAt: rule.updatedAt.toISOString(),
    };
  }
}
