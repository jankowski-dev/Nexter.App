import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  normalizeSandboxTokenKey,
  parseSandboxTokenKey,
  SANDBOX_REQUIRED_CANDLES,
  SANDBOX_STALE_AFTER_MS,
  SANDBOX_TIMEFRAME,
  SANDBOX_TIMEFRAME_MS,
  type SandboxChain,
  type SandboxCoverage,
  type SandboxCoverageResponse,
  type SandboxCoverageStatus,
  type SandboxToken,
  type SandboxTokenCreateRequest,
  type SandboxTokenRefreshResponse,
  type SandboxTokensResponse,
  type SandboxTokenUpdateRequest,
} from '@nexter/contracts';
import { AuditService } from '../../shared/audit/audit.service';
import { SandboxDataService } from './sandbox-data.service';
import {
  SandboxRepository,
  type SandboxCandleStats,
  type SandboxTokenRecord,
} from './sandbox.repository';

export interface SandboxAuditMeta {
  ip?: string;
  userAgent?: string;
}

export interface SandboxPreflight {
  status: SandboxCoverageStatus;
  warnings: string[];
  coverage: SandboxCoverage[];
}

const EMPTY_STATS: SandboxCandleStats = {
  available: 0,
  firstOpenTime: null,
  lastOpenTime: null,
  syntheticCandles: 0,
};

/** Owner-scoped sandbox token universe plus candle coverage and refresh. */
@Injectable()
export class SandboxTokensService {
  constructor(
    private readonly repository: SandboxRepository,
    private readonly audit: AuditService,
    private readonly data: SandboxDataService,
  ) {}

  async list(userId: string): Promise<SandboxTokensResponse> {
    const rows = await this.repository.listTokens(userId);
    return { tokens: rows.map(toContract) };
  }

  async create(
    userId: string,
    input: SandboxTokenCreateRequest,
    meta: SandboxAuditMeta,
  ): Promise<SandboxToken> {
    const tokenKey = normalizeSandboxTokenKey(input.tokenKey);
    const parsed = tokenKey ? parseSandboxTokenKey(tokenKey) : null;
    if (!tokenKey || !parsed) {
      throw new BadRequestException({
        code: 'SANDBOX_TOKEN_KEY_INVALID',
        message: 'Unsupported sandbox token key',
      });
    }

    if (input.contractAddress) {
      if (!parsed.contractAddress) {
        throw new BadRequestException({
          code: 'SANDBOX_TOKEN_CONTRACT_MISMATCH',
          message: 'A Binance pair cannot have a contract address',
        });
      }
      if (input.contractAddress.toLowerCase() !== parsed.contractAddress) {
        throw new BadRequestException({
          code: 'SANDBOX_TOKEN_CONTRACT_MISMATCH',
          message: 'The contract address does not match the token key',
        });
      }
    }

    let row: SandboxTokenRecord;
    try {
      row = await this.repository.insertToken({
        userId,
        tokenKey,
        symbol: input.symbol.trim(),
        name: input.name.trim(),
        chain: parsed.chain,
        contractAddress: parsed.contractAddress,
        coingeckoId: input.coingeckoId ?? null,
        enabled: input.enabled ?? true,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException({
          code: 'SANDBOX_TOKEN_EXISTS',
          message: 'Token is already in the sandbox universe',
        });
      }
      throw error;
    }

    const token = toContract(row);
    await this.audit.log({
      userId,
      action: 'sandbox.token_created',
      entityType: 'sandbox_token',
      entityId: token.id,
      after: token,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return token;
  }

  async update(
    userId: string,
    id: string,
    input: SandboxTokenUpdateRequest,
    meta: SandboxAuditMeta,
  ): Promise<SandboxToken> {
    const existing = await this.requireToken(userId, id);
    const before = auditShape(existing);
    const updated = await this.repository.updateToken(userId, id, input);
    if (!updated) {
      throw new NotFoundException({
        code: 'SANDBOX_TOKEN_NOT_FOUND',
        message: 'Sandbox token not found',
      });
    }

    const token = toContract(updated);
    await this.audit.log({
      userId,
      action: 'sandbox.token_updated',
      entityType: 'sandbox_token',
      entityId: token.id,
      before,
      after: auditShape(updated),
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return token;
  }

  async refresh(
    userId: string,
    id: string,
    meta: SandboxAuditMeta,
    now: Date = new Date(),
  ): Promise<SandboxTokenRefreshResponse> {
    const token = await this.requireToken(userId, id);
    const result = await this.data.refreshToken(token, { now });
    const stats = await this.repository.candleStatsMany([token.tokenKey]);
    const coverage = buildSandboxCoverage(
      token.tokenKey,
      stats.get(token.tokenKey) ?? EMPTY_STATS,
      now,
    );

    await this.audit.log({
      userId,
      action: 'sandbox.token_refreshed',
      entityType: 'sandbox_token',
      entityId: token.id,
      after: {
        tokenKey: token.tokenKey,
        fetched: result.fetched,
        source: result.source,
        synthetic: result.synthetic,
      },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return { token: toContract(token), coverage, fetched: result.fetched };
  }

  async coverage(
    userId: string,
    tokenKey?: string,
    now: Date = new Date(),
  ): Promise<SandboxCoverageResponse> {
    const tokens = await this.repository.listTokens(userId);
    const selected = tokenKey ? tokens.filter((token) => token.tokenKey === tokenKey) : tokens;

    if (tokenKey && selected.length === 0) {
      throw new NotFoundException({
        code: 'SANDBOX_TOKEN_NOT_FOUND',
        message: 'Sandbox token not found',
      });
    }
    if (selected.length === 0) return { tokens: [] };

    const stats = await this.repository.candleStatsMany(selected.map((token) => token.tokenKey));

    return {
      tokens: selected.map((token) =>
        buildSandboxCoverage(token.tokenKey, stats.get(token.tokenKey) ?? EMPTY_STATS, now),
      ),
    };
  }

  /**
   * Preflight for a run start: aggregates coverage for the requested universe
   * and returns a warning for every gap instead of blocking silently.
   */
  async preflight(
    userId: string,
    tokenKeys: string[],
    now: Date = new Date(),
  ): Promise<SandboxPreflight> {
    const tokens = await this.repository.listTokens(userId);
    const owned = new Set(tokens.map((token) => token.tokenKey));
    const requested = [...new Set(tokenKeys)];

    if (requested.length === 0) {
      return {
        status: 'missing',
        warnings: ['Не выбрано ни одного токена для запуска.'],
        coverage: [],
      };
    }

    const known = requested.filter((key) => owned.has(key));
    const missing = requested.filter((key) => !owned.has(key));

    const stats =
      known.length > 0
        ? await this.repository.candleStatsMany(known)
        : new Map<string, SandboxCandleStats>();
    const coverage = known.map((key) =>
      buildSandboxCoverage(key, stats.get(key) ?? EMPTY_STATS, now),
    );

    const warnings = [
      ...missing.map((key) => `Токен ${key} не найден в песочнице.`),
      ...coverage
        .map((entry) => entry.warning)
        .filter((warning): warning is string => warning !== null),
    ];

    const status: SandboxCoverageStatus =
      missing.length > 0 || coverage.some((entry) => entry.status === 'missing')
        ? 'missing'
        : coverage.some((entry) => entry.status === 'partial')
          ? 'partial'
          : 'ok';

    return { status, warnings, coverage };
  }

  private async requireToken(userId: string, id: string): Promise<SandboxTokenRecord> {
    const token = await this.repository.findTokenById(userId, id);
    if (!token) {
      throw new NotFoundException({
        code: 'SANDBOX_TOKEN_NOT_FOUND',
        message: 'Sandbox token not found',
      });
    }

    return token;
  }
}

/** Pure coverage projection used by the API and the run-start preflight. */
export function buildSandboxCoverage(
  tokenKey: string,
  stats: SandboxCandleStats,
  now: Date,
): SandboxCoverage {
  const available = Math.max(0, Math.trunc(stats.available));
  const firstOpenTime = stats.firstOpenTime ? new Date(stats.firstOpenTime) : null;
  const lastOpenTime = stats.lastOpenTime ? new Date(stats.lastOpenTime) : null;

  const spanBars =
    firstOpenTime && lastOpenTime
      ? Math.floor((lastOpenTime.getTime() - firstOpenTime.getTime()) / SANDBOX_TIMEFRAME_MS) + 1
      : 0;
  const gaps = Math.max(0, spanBars - available);
  const synthetic = stats.syntheticCandles > 0;
  const lastCloseTime = lastOpenTime ? lastOpenTime.getTime() + SANDBOX_TIMEFRAME_MS : null;
  const stale = lastCloseTime === null || now.getTime() - lastCloseTime > SANDBOX_STALE_AFTER_MS;
  const complete = available >= SANDBOX_REQUIRED_CANDLES && gaps === 0;
  const status: SandboxCoverageStatus =
    available === 0 ? 'missing' : complete && !stale ? 'ok' : 'partial';

  const warnings: string[] = [];
  if (available === 0) {
    warnings.push('Нет часовых свечей: сначала загрузите данные.');
  } else if (!complete) {
    warnings.push(`Доступно ${available} из ${SANDBOX_REQUIRED_CANDLES} часовых свечей.`);
  }
  if (synthetic) {
    warnings.push('Данные CoinGecko помечены как synthetic и не являются биржевым OHLCV.');
  }
  if (stale) warnings.push('Последняя свеча старше одного закрытого бара (1h).');

  return {
    tokenKey,
    timeframe: SANDBOX_TIMEFRAME,
    available,
    required: SANDBOX_REQUIRED_CANDLES,
    firstOpenTime: firstOpenTime ? firstOpenTime.toISOString() : null,
    lastOpenTime: lastOpenTime ? lastOpenTime.toISOString() : null,
    gaps,
    synthetic,
    stale,
    status,
    warning: warnings.length > 0 ? warnings.join(' ') : null,
  };
}

function toContract(row: SandboxTokenRecord): SandboxToken {
  return {
    id: row.id,
    tokenKey: row.tokenKey,
    symbol: row.symbol,
    name: row.name,
    chain: row.chain as SandboxChain,
    contractAddress: row.contractAddress,
    coingeckoId: row.coingeckoId,
    enabled: row.enabled,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

function auditShape(row: SandboxTokenRecord): Record<string, unknown> {
  return {
    tokenKey: row.tokenKey,
    symbol: row.symbol,
    name: row.name,
    coingeckoId: row.coingeckoId,
    enabled: row.enabled,
  };
}

function isUniqueViolation(error: unknown): boolean {
  const candidate = error as { code?: string; cause?: { code?: string } };
  return candidate?.code === '23505' || candidate?.cause?.code === '23505';
}
