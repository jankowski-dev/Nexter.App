import Decimal from 'decimal.js';
import type { SandboxRiskCheck } from '../events/event-types';
import type { Timestamp } from '../types';
import { DecimalInputError, maxDecimal, money, percent, toDecimal } from './decimal';
import { Reason } from './reason-codes';
import type { ReasonCode } from './reason-codes';
import type {
  PortfolioSnapshot,
  RegimeFeatures,
  SandboxDecisionSettings,
  StrategyKey,
  TokenPhase,
} from './types';

/**
 * Risk vetoes for decision intents.
 *
 * Every money and percentage value is computed with `decimal.js`; the result is
 * a list of `SandboxRiskCheck` entries with decimal-string `value`/`limit` that
 * the decision logger persists verbatim. The module is pure: it reads the
 * portfolio snapshot, settings, token phases and regime features, and never
 * mutates them or talks to the outside world.
 *
 * Risk can only veto; it never sizes an order. The allocator owns sizing, so
 * the checks receive a concrete size and answer "may this go through?".
 */

export interface RiskContext {
  readonly now: Timestamp;
  readonly portfolio: PortfolioSnapshot;
  readonly settings: SandboxDecisionSettings;
  readonly phases: Readonly<Record<string, TokenPhase>>;
  readonly features: Readonly<Record<string, RegimeFeatures>>;
  /**
   * Optional cooldown deadlines by token id.
   *
   * The engine already knows each token's `cooldownUntil`, so it should pass it
   * here to log the real ISO deadline. When the map is absent the phase map is
   * authoritative: a token whose phase is `COOLDOWN` still fails the check, but
   * the value cannot be an ISO timestamp and is reported as `cooldown`.
   */
  readonly cooldowns?: Readonly<Record<string, Timestamp>>;
}

export interface RiskOutcome {
  readonly passed: boolean;
  readonly checks: readonly SandboxRiskCheck[];
  readonly failedCode: ReasonCode | null;
}

type BuyCheckName =
  | 'max_positions'
  | 'max_token_exposure'
  | 'max_strategy_exposure'
  | 'cash_buffer'
  | 'daily_loss_limit'
  | 'max_drawdown'
  | 'per_trade_risk'
  | 'liquidity'
  | 'data_stale'
  | 'cooldown'
  | 'token_blocked'
  | 'size_too_small';

type SellCheckName = 'data_stale' | 'liquidity';

const BUY_CHECK_REASONS: Readonly<Record<BuyCheckName, ReasonCode>> = {
  max_positions: Reason.RISK_MAX_POSITIONS,
  max_token_exposure: Reason.RISK_TOKEN_EXPOSURE,
  max_strategy_exposure: Reason.RISK_STRATEGY_EXPOSURE,
  cash_buffer: Reason.RISK_CASH_BUFFER,
  daily_loss_limit: Reason.RISK_DAILY_LOSS,
  max_drawdown: Reason.RISK_MAX_DRAWDOWN,
  per_trade_risk: Reason.RISK_PER_TRADE,
  liquidity: Reason.RISK_LIQUIDITY,
  data_stale: Reason.RISK_DATA_STALE,
  cooldown: Reason.RISK_COOLDOWN,
  token_blocked: Reason.RISK_TOKEN_BLOCKED,
  size_too_small: Reason.RISK_SIZE_TOO_SMALL,
};

const SELL_CHECK_REASONS: Readonly<Record<SellCheckName, ReasonCode>> = {
  data_stale: Reason.RISK_DATA_STALE,
  liquidity: Reason.RISK_LIQUIDITY,
};

/** Sentinel stale-bar count for a token without a feature snapshot. */
const MISSING_STALE_BARS = 999999;

const DECIMAL_PATTERN = /^\d+(\.\d+)?$/;

function iso(timestamp: Timestamp): string {
  return new Date(timestamp).toISOString();
}

/** Converts a configuration percentage/ratio number without binary noise. */
function ratio(value: number): Decimal {
  return new Decimal(Number.isFinite(value) ? String(value) : '0');
}

/** Parses a decimal that the caller must have validated as positive. */
function positiveDecimal(value: string, label: string): Decimal {
  const parsed = toDecimal(value, label);
  if (parsed.isZero()) {
    throw new DecimalInputError(`${label} must be greater than zero`);
  }
  return parsed;
}

function optionalDecimal(value: string | null | undefined): Decimal | null {
  if (value === null || value === undefined || !DECIMAL_PATTERN.test(value)) return null;
  return new Decimal(value);
}

function staleBarsOf(features: RegimeFeatures | undefined): number {
  if (features === undefined || !Number.isFinite(features.staleBars)) {
    return MISSING_STALE_BARS;
  }
  return features.staleBars;
}

function liquidityLimitOf(
  features: RegimeFeatures | undefined,
  settings: SandboxDecisionSettings,
): Decimal {
  const volume = optionalDecimal(features?.avgVolumeUsd ?? null);
  if (volume === null) return new Decimal(0);
  return volume.times(ratio(settings.liquidityCapPct)).div(100);
}

interface ExposureMaps {
  readonly byToken: ReadonlyMap<string, Decimal>;
  readonly byStrategy: ReadonlyMap<string, Decimal>;
}

function exposureMaps(positions: PortfolioSnapshot['positions']): ExposureMaps {
  const byToken = new Map<string, Decimal>();
  const byStrategy = new Map<string, Decimal>();
  for (const position of positions) {
    const value = toDecimal(position.marketValueUsd, 'portfolio.positions.marketValueUsd');
    byToken.set(position.tokenId, (byToken.get(position.tokenId) ?? new Decimal(0)).plus(value));
    byStrategy.set(
      position.strategyKey,
      (byStrategy.get(position.strategyKey) ?? new Decimal(0)).plus(value),
    );
  }
  return { byToken, byStrategy };
}

function riskCheck<Name extends string>(
  name: Name,
  value: string,
  limit: string,
  passed: boolean,
): {
  readonly name: Name;
  readonly value: string;
  readonly limit: string;
  readonly passed: boolean;
} {
  return { name, value, limit, passed };
}

function firstFailure<Name extends string>(
  checks: readonly { readonly name: Name; readonly passed: boolean }[],
  reasons: Readonly<Record<Name, ReasonCode>>,
): { readonly code: ReasonCode | null; readonly passed: boolean } {
  const failed = checks.find((check) => !check.passed);
  return { code: failed === undefined ? null : reasons[failed.name], passed: failed === undefined };
}

/**
 * Checks a sized buy intent against every Stage 1B risk limit.
 *
 * All twelve checks are always returned in contract order. Daily loss and
 * drawdown block at or above their limit; exposure, cash-buffer, per-trade
 * risk, liquidity and minimum-order checks pass at equality.
 */
export function checkBuyRisk(input: {
  tokenId: string;
  strategyKey: StrategyKey;
  sizeUsd: string;
  stopLossPct: string | null;
  riskWeight: number;
  context: RiskContext;
}): RiskOutcome {
  const { context } = input;
  const { portfolio, settings } = context;

  const equity = positiveDecimal(portfolio.equityUsd, 'portfolio.equityUsd');
  const cash = toDecimal(portfolio.cashUsd, 'portfolio.cashUsd');
  const dayStart = positiveDecimal(portfolio.dayStartEquityUsd, 'portfolio.dayStartEquityUsd');
  const peak = positiveDecimal(portfolio.peakEquityUsd, 'portfolio.peakEquityUsd');
  const minOrder = toDecimal(settings.minOrderUsd, 'settings.minOrderUsd');
  const size = toDecimal(input.sizeUsd, 'sizeUsd');
  const stop = toDecimal(input.stopLossPct ?? String(settings.defaultStopPct), 'stopLossPct');

  const exposures = exposureMaps(portfolio.positions);
  const tokenValue = exposures.byToken.get(input.tokenId) ?? new Decimal(0);
  const strategyValue = exposures.byStrategy.get(input.strategyKey) ?? new Decimal(0);

  const tokenExposure = tokenValue.plus(size).div(equity).times(100);
  const tokenExposureLimit = ratio(settings.maxTokenExposurePct);
  const strategyExposure = strategyValue.plus(size).div(equity).times(100);
  const strategyExposureLimit = ratio(settings.maxStrategyExposurePct);

  const cashAfter = cash.minus(size);
  const cashBufferFloor = equity.times(ratio(settings.cashBufferPct)).div(100);

  const dailyLoss = maxDecimal(new Decimal(0), dayStart.minus(equity).div(dayStart).times(100));
  const dailyLossLimit = ratio(settings.dailyLossLimitPct);
  const drawdown = maxDecimal(new Decimal(0), peak.minus(equity).div(peak).times(100));
  const drawdownLimit = ratio(settings.maxDrawdownPct);

  const riskUsed = size.times(stop).div(100);
  const riskBudget = equity
    .times(ratio(settings.perTradeRiskPct))
    .div(100)
    .times(ratio(input.riskWeight));

  const features = context.features[input.tokenId];
  const liquidityLimit = liquidityLimitOf(features, settings);
  const staleBars = staleBarsOf(features);

  const cooldownUntil = context.cooldowns?.[input.tokenId] ?? null;
  const phaseCooling = context.phases[input.tokenId] === 'COOLDOWN';
  const cooldownActive = cooldownUntil === null ? phaseCooling : cooldownUntil > context.now;
  const cooldownValue =
    cooldownUntil === null ? (phaseCooling ? 'cooldown' : 'none') : iso(cooldownUntil);
  const phase = context.phases[input.tokenId] ?? 'UNKNOWN';

  const checks = [
    riskCheck(
      'max_positions',
      String(portfolio.positions.length),
      String(settings.maxPositions),
      portfolio.positions.length < settings.maxPositions,
    ),
    riskCheck(
      'max_token_exposure',
      percent(tokenExposure),
      percent(tokenExposureLimit),
      tokenExposure.lessThanOrEqualTo(tokenExposureLimit),
    ),
    riskCheck(
      'max_strategy_exposure',
      percent(strategyExposure),
      percent(strategyExposureLimit),
      strategyExposure.lessThanOrEqualTo(strategyExposureLimit),
    ),
    riskCheck(
      'cash_buffer',
      money(cashAfter),
      money(cashBufferFloor),
      cashAfter.greaterThanOrEqualTo(cashBufferFloor),
    ),
    riskCheck(
      'daily_loss_limit',
      percent(dailyLoss),
      percent(dailyLossLimit),
      dailyLoss.lessThan(dailyLossLimit),
    ),
    riskCheck(
      'max_drawdown',
      percent(drawdown),
      percent(drawdownLimit),
      drawdown.lessThan(drawdownLimit),
    ),
    riskCheck(
      'per_trade_risk',
      money(riskUsed),
      money(riskBudget),
      riskUsed.lessThanOrEqualTo(riskBudget),
    ),
    riskCheck(
      'liquidity',
      money(size),
      money(liquidityLimit),
      size.lessThanOrEqualTo(liquidityLimit),
    ),
    riskCheck('data_stale', String(staleBars), '0', staleBars <= 0),
    riskCheck('cooldown', cooldownValue, iso(context.now), !cooldownActive),
    riskCheck('token_blocked', phase, 'not_blocked', phase !== 'BLOCKED'),
    riskCheck('size_too_small', money(size), money(minOrder), size.greaterThanOrEqualTo(minOrder)),
  ] as const;

  const outcome = firstFailure(checks, BUY_CHECK_REASONS);
  return { passed: outcome.passed, checks, failedCode: outcome.code };
}

/**
 * Checks a sell intent. Sells only require fresh data and enough liquidity:
 * reducing risk is allowed even when the portfolio breached its daily-loss or
 * drawdown limits, the token is cooling down or its phase is blocked.
 */
export function checkSellRisk(input: {
  tokenId: string;
  sizeUsd: string;
  context: RiskContext;
}): RiskOutcome {
  const { context } = input;
  const size = toDecimal(input.sizeUsd, 'sizeUsd');
  const features = context.features[input.tokenId];
  const staleBars = staleBarsOf(features);
  const liquidityLimit = liquidityLimitOf(features, context.settings);

  const checks = [
    riskCheck('data_stale', String(staleBars), '0', staleBars <= 0),
    riskCheck(
      'liquidity',
      money(size),
      money(liquidityLimit),
      size.lessThanOrEqualTo(liquidityLimit),
    ),
  ] as const;

  const outcome = firstFailure(checks, SELL_CHECK_REASONS);
  return { passed: outcome.passed, checks, failedCode: outcome.code };
}
