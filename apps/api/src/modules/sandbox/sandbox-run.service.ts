import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  normalizeSandboxTokenKey,
  type SandboxRun,
  type SandboxRunCreateRequest,
  type SandboxRunStartRequest,
  type SandboxRunUpdateRequest,
} from '@nexter/contracts';
import {
  createLedger,
  DEFAULT_PAPER_SETTINGS,
  DEFAULT_SETTINGS,
  Reason,
  type OrderIntent,
  type PaperRunSettings,
  type SandboxDecisionSettings,
} from '@nexter/sandbox-core';
import Decimal from 'decimal.js';
import { AuditService } from '../../shared/audit/audit.service';
import { SandboxDataService } from './sandbox-data.service';
import { SandboxRepository, type SandboxTokenRecord } from './sandbox.repository';
import { SandboxTokensService, type SandboxAuditMeta } from './sandbox-tokens.service';
import {
  resolveSandboxRunConfig,
  type SandboxRunSnapshot,
  type SandboxRunStatus,
  type SandboxRunnerConfig,
} from './sandbox.types';

/**
 * Owner-facing run lifecycle and controls.
 *
 * A run starts as an editable draft with no token snapshot or state. Start is
 * the only transition that freezes the token/config snapshot, initializes the
 * ledger and an empty engine state and flips the status to running in one
 * transaction. Running runs expose pause/resume/stop and one manual close; no
 * manual buy, add or override exists anywhere in this service.
 */
@Injectable()
export class SandboxRunService {
  private readonly logger = new Logger(SandboxRunService.name);

  constructor(
    private readonly repository: SandboxRepository,
    private readonly tokens: SandboxTokensService,
    private readonly data: SandboxDataService,
    private readonly audit: AuditService,
  ) {}

  async create(
    userId: string,
    input: SandboxRunCreateRequest,
    meta: SandboxAuditMeta,
  ): Promise<SandboxRun> {
    const tokenKeys = normalizeTokenKeys(input.tokenKeys);
    await this.requireUniverse(userId, tokenKeys, false);

    const initialCapitalUsd = normalizeCapital(input.initialCapitalUsd);
    const settings = input.settings ?? DEFAULT_SETTINGS;
    const paper = effectivePaper(settings, input.paper ?? DEFAULT_PAPER_SETTINGS);
    const config = runConfig(tokenKeys, settings, paper);

    const runId = await this.repository.createRun({
      userId,
      name: input.name,
      initialCapitalUsd,
      settings: config as unknown as Record<string, unknown>,
    });
    const run = await this.requireRun(userId, runId);

    await this.audit.log({
      userId,
      action: 'sandbox.run_created',
      entityType: 'sandbox_run',
      entityId: runId,
      after: {
        name: run.name,
        status: run.status,
        initialCapitalUsd: run.initialCapitalUsd,
        tokenKeys,
      },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return toRunContract(run);
  }

  async updateDraft(
    userId: string,
    runId: string,
    input: SandboxRunUpdateRequest,
    meta: SandboxAuditMeta,
  ): Promise<SandboxRun> {
    const run = await this.requireRun(userId, runId);
    if (run.status !== 'draft') {
      throw new ConflictException({
        code: 'SANDBOX_RUN_NOT_DRAFT',
        message: 'Only a draft run can be edited',
      });
    }

    const current = resolveSandboxRunConfig(
      run.settings,
      run.tokens.map((token) => token.tokenKey),
    );
    const tokenKeys =
      input.tokenKeys === undefined ? [...current.tokenKeys] : normalizeTokenKeys(input.tokenKeys);
    if (input.tokenKeys !== undefined) {
      await this.requireUniverse(userId, tokenKeys, false);
    }

    const settings = input.settings ?? current.settings;
    const paper = effectivePaper(settings, input.paper ?? current.paper);
    const initialCapitalUsd =
      input.initialCapitalUsd === undefined
        ? normalizeCapital(run.initialCapitalUsd)
        : normalizeCapital(input.initialCapitalUsd);
    const config = runConfig(tokenKeys, settings, paper);

    const updated = await this.repository.updateDraftRun(userId, runId, {
      name: input.name,
      initialCapitalUsd,
      settings: config as unknown as Record<string, unknown>,
    });
    if (!updated) {
      throw new ConflictException({
        code: 'SANDBOX_RUN_STATE_CHANGED',
        message: 'The run is no longer an editable draft',
      });
    }

    const after = await this.requireRun(userId, runId);
    await this.audit.log({
      userId,
      action: 'sandbox.run_updated',
      entityType: 'sandbox_run',
      entityId: runId,
      before: {
        name: run.name,
        status: run.status,
        initialCapitalUsd: run.initialCapitalUsd,
        tokenKeys: current.tokenKeys,
      },
      after: {
        name: after.name,
        status: after.status,
        initialCapitalUsd: after.initialCapitalUsd,
        tokenKeys,
      },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return toRunContract(after);
  }

  async start(
    userId: string,
    runId: string,
    input: SandboxRunStartRequest,
    meta: SandboxAuditMeta,
    now: Date = new Date(),
  ): Promise<SandboxRun> {
    const run = await this.requireRun(userId, runId);
    if (run.status !== 'draft') {
      throw new ConflictException({
        code: 'SANDBOX_RUN_NOT_DRAFT',
        message: 'Only a draft run can be started',
      });
    }

    const config = resolveSandboxRunConfig(
      run.settings,
      run.tokens.map((token) => token.tokenKey),
    );
    if (config.tokenKeys.length === 0) {
      throw new BadRequestException({
        code: 'SANDBOX_RUN_NO_TOKENS',
        message: 'A sandbox run needs at least one token',
      });
    }

    const universe = await this.requireUniverse(userId, [...config.tokenKeys], true);
    // Design §5.2: warm up the run tokens before start. Provider failures are
    // logged and still subject to the coverage gate below, so an already-covered
    // token is not blocked by a transient refresh error.
    await this.warmupTokens(universe, config.tokenKeys, now);
    const preflight = await this.tokens.preflight(userId, [...config.tokenKeys], now);
    if (preflight.status === 'missing') {
      throw new ConflictException({
        code: 'SANDBOX_COVERAGE_MISSING',
        message: 'Недостаточно данных для запуска',
        details: preflight.warnings,
      });
    }
    if (preflight.status === 'partial' && input.allowPartial !== true) {
      throw new ConflictException({
        code: 'SANDBOX_COVERAGE_PARTIAL',
        message: 'История неполная; запуск требует явного подтверждения',
        details: preflight.warnings,
      });
    }

    const initialCapitalUsd = normalizeCapital(run.initialCapitalUsd);
    const ledger = createLedger(initialCapitalUsd);
    const started = await this.repository.startRun(userId, runId, {
      config: config as unknown as Record<string, unknown>,
      initialCapitalUsd,
      engineState: { tokens: {} },
      ledgerState: ledger as unknown as Record<string, unknown>,
      tokens: config.tokenKeys.map((tokenKey) => snapshotToken(universe.get(tokenKey), tokenKey)),
    });
    if (!started) {
      throw new ConflictException({
        code: 'SANDBOX_RUN_STATE_CHANGED',
        message: 'The run could not be started from its current state',
      });
    }

    const after = await this.requireRun(userId, runId);
    await this.audit.log({
      userId,
      action: 'sandbox.run_started',
      entityType: 'sandbox_run',
      entityId: runId,
      before: { status: run.status },
      after: {
        status: after.status,
        initialCapitalUsd,
        tokenKeys: config.tokenKeys,
        coverageStatus: preflight.status,
        warnings: preflight.warnings,
        executionMode: 'live-paper',
      },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return toRunContract(after);
  }

  async pause(userId: string, runId: string, meta: SandboxAuditMeta): Promise<SandboxRun> {
    const run = await this.requireRun(userId, runId);
    if (run.status !== 'running') {
      throw new ConflictException({
        code: 'SANDBOX_RUN_NOT_RUNNING',
        message: 'Only a running run can be paused',
      });
    }

    const now = new Date();
    const paused = await this.repository.transitionRun(userId, runId, ['running'], {
      status: 'paused',
      pausedAt: now,
    });
    if (!paused) throw stateChanged('pause');

    await this.auditTransition(userId, runId, 'sandbox.run_paused', run.status, 'paused', meta);
    return toRunContract(await this.requireRun(userId, runId));
  }

  async resume(userId: string, runId: string, meta: SandboxAuditMeta): Promise<SandboxRun> {
    const run = await this.requireRun(userId, runId);
    if (run.status !== 'paused') {
      throw new ConflictException({
        code: 'SANDBOX_RUN_NOT_PAUSED',
        message: 'Only a paused run can be resumed',
      });
    }

    const resumed = await this.repository.transitionRun(userId, runId, ['paused'], {
      status: 'running',
      pausedAt: null,
    });
    if (!resumed) throw stateChanged('resume');

    await this.auditTransition(userId, runId, 'sandbox.run_resumed', run.status, 'running', meta);
    return toRunContract(await this.requireRun(userId, runId));
  }

  async stop(userId: string, runId: string, meta: SandboxAuditMeta): Promise<SandboxRun> {
    const run = await this.requireRun(userId, runId);
    if (run.status !== 'running' && run.status !== 'paused') {
      throw new ConflictException({
        code: 'SANDBOX_RUN_NOT_ACTIVE',
        message: 'Only a running or paused run can be stopped',
      });
    }

    const now = new Date();
    const stopped = await this.repository.transitionRunAndExpire(
      userId,
      runId,
      ['running', 'paused'],
      {
        status: 'stopped',
        stoppedAt: now,
        pausedAt: null,
      },
      'Run stopped before the pending intent could fill',
      now,
    );
    if (!stopped) throw stateChanged('stop');

    await this.auditTransition(userId, runId, 'sandbox.run_stopped', run.status, 'stopped', meta, {
      expiredIntents: stopped.expiredIntents,
    });
    return toRunContract(await this.requireRun(userId, runId));
  }

  async archive(userId: string, runId: string, meta: SandboxAuditMeta): Promise<SandboxRun> {
    const run = await this.requireRun(userId, runId);
    if (run.status !== 'stopped' && run.status !== 'failed') {
      throw new ConflictException({
        code: 'SANDBOX_RUN_NOT_TERMINAL',
        message: 'Only a stopped or failed run can be archived',
      });
    }

    const archived = await this.repository.archiveRunAndExpire(
      userId,
      runId,
      'Run archived before the pending intent could fill',
    );
    if (!archived) throw stateChanged('archive');

    await this.audit.log({
      userId,
      action: 'sandbox.run_archived',
      entityType: 'sandbox_run',
      entityId: runId,
      before: { status: run.status, archivedAt: null },
      after: {
        status: run.status,
        archivedAt: archived.archivedAt.toISOString(),
        expiredIntents: archived.expiredIntents,
      },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    const archivedRun = await this.repository.loadRun(runId);
    if (!archivedRun || archivedRun.userId !== userId) {
      throw new NotFoundException({
        code: 'SANDBOX_RUN_NOT_FOUND',
        message: 'Sandbox run not found',
      });
    }
    return toRunContract(archivedRun);
  }

  /**
   * Queues one manual close. The next live tick emits the sell at the live
   * quote; there is deliberately no manual buy/add/override.
   */
  async requestClose(
    userId: string,
    runId: string,
    rawTokenId: string,
    meta: SandboxAuditMeta,
  ): Promise<SandboxRun> {
    const run = await this.requireRun(userId, runId);
    if (run.status !== 'running') {
      throw new ConflictException({
        code: 'SANDBOX_RUN_NOT_RUNNING',
        message: 'A trade can only be closed while the run is running',
      });
    }

    const tokenId = normalizeSandboxTokenKey(rawTokenId);
    if (!tokenId || !run.tokens.some((token) => token.tokenKey === tokenId)) {
      throw new NotFoundException({
        code: 'SANDBOX_RUN_TOKEN_NOT_FOUND',
        message: 'The token is not part of this run',
      });
    }

    const position = run.ledgerState?.positions[tokenId];
    if (!position || !new Decimal(position.amount).greaterThan(0)) {
      throw new ConflictException({
        code: 'SANDBOX_POSITION_NOT_FOUND',
        message: 'There is no open position for this token',
      });
    }
    if (await this.repository.hasPendingSell(runId, tokenId)) {
      throw new ConflictException({
        code: 'SANDBOX_CLOSE_ALREADY_PENDING',
        message: 'A close for this token is already queued',
      });
    }

    const intent: OrderIntent = {
      intentId: `sandbox:${runId}:${tokenId}:manual:${randomUUID()}`,
      tokenId,
      side: 'sell',
      strategyKey: position.strategyKey,
      strategyVersion: position.strategyVersion,
      reasonCode: Reason.MANUAL_CLOSE,
      sizeUsd: '0.00',
      amount: position.amount,
      stopLossPct: null,
      takeProfitPct: null,
      decisionPriceUsd: '0.00000000',
      clockTime: Date.now(),
    };
    const inserted = await this.repository.insertManualCloseIntent(runId, intent);
    if (!inserted) {
      throw new ConflictException({
        code: 'SANDBOX_CLOSE_ALREADY_PENDING',
        message: 'A close for this token is already queued',
      });
    }

    await this.audit.log({
      userId,
      action: 'sandbox.trade_close_requested',
      entityType: 'sandbox_run',
      entityId: runId,
      after: {
        tokenId,
        intentId: intent.intentId,
        amount: position.amount,
        reasonCode: Reason.MANUAL_CLOSE,
      },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return toRunContract(await this.requireRun(userId, runId));
  }

  private async requireRun(userId: string, runId: string): Promise<SandboxRunSnapshot> {
    const run = await this.repository.loadRun(runId);
    if (!run || run.userId !== userId || run.archivedAt !== null) {
      throw new NotFoundException({
        code: 'SANDBOX_RUN_NOT_FOUND',
        message: 'Sandbox run not found',
      });
    }
    return run;
  }

  private async warmupTokens(
    universe: Map<string, SandboxTokenRecord>,
    tokenKeys: readonly string[],
    now: Date,
  ): Promise<void> {
    for (const tokenKey of tokenKeys) {
      const token = universe.get(tokenKey);
      if (token === undefined) continue;
      try {
        await this.data.refreshToken(token, { now });
      } catch (error) {
        this.logger.warn(
          `Sandbox start warmup failed for ${tokenKey}: ` +
            `${error instanceof Error ? error.message : 'unknown'}`,
        );
      }
    }
  }

  private async requireUniverse(
    userId: string,
    tokenKeys: readonly string[],
    requireEnabled: boolean,
  ): Promise<Map<string, SandboxTokenRecord>> {
    const tokens = await this.repository.listTokens(userId);
    const byKey = new Map(tokens.map((token) => [token.tokenKey, token]));
    const missing = tokenKeys.filter((key) => !byKey.has(key));
    if (missing.length > 0) {
      throw new BadRequestException({
        code: 'SANDBOX_TOKEN_NOT_FOUND',
        message: 'Некоторые токены отсутствуют в песочнице',
        details: missing,
      });
    }
    if (requireEnabled) {
      const disabled = tokenKeys.filter((key) => byKey.get(key)?.enabled !== true);
      if (disabled.length > 0) {
        throw new BadRequestException({
          code: 'SANDBOX_TOKEN_DISABLED',
          message: 'Некоторые токены отключены в песочнице',
          details: disabled,
        });
      }
    }
    return byKey;
  }

  private async auditTransition(
    userId: string,
    runId: string,
    action: string,
    before: SandboxRunStatus,
    after: SandboxRunStatus,
    meta: SandboxAuditMeta,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    await this.audit.log({
      userId,
      action,
      entityType: 'sandbox_run',
      entityId: runId,
      before: { status: before },
      after: { status: after, ...extra },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  }
}

function stateChanged(action: string): ConflictException {
  return new ConflictException({
    code: 'SANDBOX_RUN_STATE_CHANGED',
    message: `The run state changed before it could ${action}`,
  });
}

function normalizeTokenKeys(tokenKeys: readonly string[]): string[] {
  const normalized = tokenKeys.map((key) => normalizeSandboxTokenKey(key) ?? key);
  return [...new Set(normalized)];
}

function normalizeCapital(value: string): string {
  const parsed = new Decimal(value);
  if (!parsed.greaterThan(0)) {
    throw new BadRequestException({
      code: 'SANDBOX_RUN_CAPITAL_INVALID',
      message: 'Initial capital must be positive',
    });
  }
  return parsed.toFixed(2);
}

function effectivePaper(
  settings: SandboxDecisionSettings,
  paper: PaperRunSettings,
): PaperRunSettings {
  // `ignored` is an explicit research mode: no volume gate and no practical
  // per-bar cap. Persist the effective 100% cap so the frozen config and its
  // version describe what actually executed.
  return settings.regime.liquidityMode === 'ignored' ? { ...paper, liquidityCapPct: 100 } : paper;
}

function runConfig(
  tokenKeys: readonly string[],
  settings: SandboxDecisionSettings,
  paper: PaperRunSettings,
): SandboxRunnerConfig {
  return { tokenKeys: [...tokenKeys], seed: 1, settings, paper };
}

function snapshotToken(token: SandboxTokenRecord | undefined, tokenKey: string) {
  return {
    tokenKey,
    symbol: token?.symbol ?? tokenKey,
    chain: token?.chain ?? tokenKey.split(':')[0] ?? 'bsc',
    contractAddress: token?.contractAddress ?? null,
    enabled: token?.enabled ?? true,
  };
}

/** Converts one loaded run to the owner-facing lifecycle contract. */
export function toRunContract(run: SandboxRunSnapshot): SandboxRun {
  const config = resolveSandboxRunConfig(
    run.settings,
    run.tokens.map((token) => token.tokenKey),
  );

  return {
    id: run.id,
    name: run.name,
    status: run.status,
    initialCapitalUsd: money(run.initialCapitalUsd),
    cashUsd: money(run.cashUsd),
    equityUsd: money(run.equityUsd),
    peakEquityUsd: money(run.peakEquityUsd),
    dayStartEquityUsd: money(run.dayStartEquityUsd),
    tokenKeys: [...config.tokenKeys],
    tokens: run.tokens.map((token) => ({
      tokenKey: token.tokenKey,
      symbol: token.symbol,
      chain: token.chain as SandboxRun['tokens'][number]['chain'],
      contractAddress: token.contractAddress,
      enabled: token.enabled,
    })),
    settings: config.settings as unknown as SandboxRun['settings'],
    paper: config.paper as unknown as SandboxRun['paper'],
    lastBarClose: run.lastBarClose ? run.lastBarClose.toISOString() : null,
    lastTickAt: run.lastTickAt ? run.lastTickAt.toISOString() : null,
    error: run.error,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
    startedAt: run.startedAt ? run.startedAt.toISOString() : null,
    pausedAt: run.pausedAt ? run.pausedAt.toISOString() : null,
    stoppedAt: run.stoppedAt ? run.stoppedAt.toISOString() : null,
    archivedAt: run.archivedAt ? run.archivedAt.toISOString() : null,
  };
}

function money(value: string): string {
  return new Decimal(value).toFixed(2);
}
