import Decimal from 'decimal.js';
import { minDecimal, money, moneyDown, toDecimal } from './decimal';
import type { RankedOpportunity } from './opportunity-ranker';
import { Reason } from './reason-codes';
import type { ReasonCode } from './reason-codes';
import type { PortfolioSnapshot, SandboxDecisionSettings } from './types';

/**
 * Portfolio sizing for ranked buy opportunities.
 *
 * Every money value uses `decimal.js`; no JS float ever holds a size, cap or
 * cash value. The allocator is pure: it copies the portfolio-derived state,
 * never mutates the snapshot or the ranked array, and iterates candidates in
 * rank order. Sells never reach this function.
 */

export interface Allocation {
  readonly candidate: RankedOpportunity;
  readonly sizeUsd: string;
  readonly stopLossPct: string;
  readonly takeProfitPct: string | null;
  readonly bindingConstraint: ReasonCode;
}

export interface AllocationDrop {
  readonly candidate: RankedOpportunity;
  readonly reasonCode: ReasonCode;
  readonly reasonText: string;
}

export interface AllocationResult {
  readonly allocations: readonly Allocation[];
  readonly drops: readonly AllocationDrop[];
}

const DECIMAL = /^\d+(\.\d+)?$/;

function optionalDecimal(value: string | null): Decimal | null {
  if (value === null || !DECIMAL.test(value)) return null;
  return toDecimal(value, 'decimal value');
}

/** Converts a configuration percentage/ratio number without binary noise. */
function ratio(value: number): Decimal {
  return new Decimal(Number.isFinite(value) ? String(value) : '0');
}

interface Constraint {
  readonly code: ReasonCode;
  readonly cap: Decimal;
}

function dropMessage(
  code: ReasonCode,
  candidate: RankedOpportunity,
  context: {
    readonly maxPositions: number;
    readonly cashAvailable: Decimal;
    readonly minOrderUsd: string;
    readonly size: Decimal | null;
    readonly stopText: string;
  },
): string {
  switch (code) {
    case Reason.ALLOC_EXISTING_POSITION:
      return `${candidate.tokenId} already has an open position`;
    case Reason.ALLOC_MAX_POSITIONS:
      return `Open positions reached the ${context.maxPositions} position limit`;
    case Reason.ALLOC_TOKEN_CAP:
      return `Token exposure cap reached for ${candidate.tokenId}`;
    case Reason.ALLOC_STRATEGY_CAP:
      return `Strategy exposure cap reached for ${candidate.strategyKey}`;
    case Reason.ALLOC_CASH_BUFFER:
      return `Cash buffer leaves ${money(context.cashAvailable)} USD available`;
    case Reason.ALLOC_RISK_CAP:
      return `Per-trade risk budget leaves no size for ${candidate.tokenId}`;
    case Reason.ALLOC_LIQUIDITY_CAP:
      return `Liquidity cap leaves no size for ${candidate.tokenId}`;
    case Reason.ALLOC_SIZE_TOO_SMALL:
      return `Size ${money(context.size ?? new Decimal(0))} USD is below the ${context.minOrderUsd} USD minimum order`;
    case Reason.ALLOC_INVALID_STOP:
      return `Stop distance ${context.stopText} must be positive for ${candidate.tokenId}`;
    default:
      return `${code} for ${candidate.tokenId}`;
  }
}

/**
 * Allocates USD sizes to ranked buy candidates, honouring existing positions,
 * open-position count, token/strategy exposure, the cash buffer, per-trade risk
 * and the liquidity cap. Inputs are never mutated.
 *
 * Expects buy candidates only; the engine guarantees that sells never reach
 * the allocator, so no sell guard is required here.
 */
export function allocateOpportunities(
  ranked: readonly RankedOpportunity[],
  portfolio: PortfolioSnapshot,
  settings: SandboxDecisionSettings,
): AllocationResult {
  const equity = toDecimal(portfolio.equityUsd, 'portfolio.equityUsd');
  const cash = toDecimal(portfolio.cashUsd, 'portfolio.cashUsd');
  const minOrder = toDecimal(settings.minOrderUsd, 'settings.minOrderUsd');

  const tokenLimit = equity.times(ratio(settings.maxTokenExposurePct)).div(100);
  const strategyLimit = equity.times(ratio(settings.maxStrategyExposurePct)).div(100);
  const cashBuffer = equity.times(ratio(settings.cashBufferPct)).div(100);
  const riskBudget = equity.times(ratio(settings.perTradeRiskPct)).div(100);
  const liquidityPct = ratio(settings.liquidityCapPct);

  // Mutable working copies derived from the snapshot. The snapshot itself is
  // never touched.
  const heldTokens = new Set<string>();
  const tokenValues = new Map<string, Decimal>();
  const strategyValues = new Map<string, Decimal>();
  for (const position of portfolio.positions) {
    heldTokens.add(position.tokenId);
    const value = toDecimal(position.marketValueUsd, 'portfolio.positions.marketValueUsd');
    tokenValues.set(
      position.tokenId,
      (tokenValues.get(position.tokenId) ?? new Decimal(0)).plus(value),
    );
    strategyValues.set(
      position.strategyKey,
      (strategyValues.get(position.strategyKey) ?? new Decimal(0)).plus(value),
    );
  }

  let openPositions = portfolio.positions.length;
  let cashAvailable = cash.minus(cashBuffer);
  let positionsFull = false;

  const allocations: Allocation[] = [];
  const drops: AllocationDrop[] = [];

  const pushDrop = (
    candidate: RankedOpportunity,
    code: ReasonCode,
    context: {
      readonly size?: Decimal | null;
      readonly stopText?: string;
    } = {},
  ): void => {
    drops.push({
      candidate,
      reasonCode: code,
      reasonText: dropMessage(code, candidate, {
        maxPositions: settings.maxPositions,
        cashAvailable,
        minOrderUsd: settings.minOrderUsd,
        size: context.size ?? null,
        stopText: context.stopText ?? '',
      }),
    });
  };

  const ordered = [...ranked].sort((left, right) => left.rank - right.rank);

  for (const candidate of ordered) {
    if (heldTokens.has(candidate.tokenId)) {
      pushDrop(candidate, Reason.ALLOC_EXISTING_POSITION);
      continue;
    }

    if (positionsFull || openPositions >= settings.maxPositions) {
      positionsFull = true;
      pushDrop(candidate, Reason.ALLOC_MAX_POSITIONS);
      continue;
    }

    const tokenCap = tokenLimit.minus(tokenValues.get(candidate.tokenId) ?? new Decimal(0));
    const strategyCap = strategyLimit.minus(
      strategyValues.get(candidate.strategyKey) ?? new Decimal(0),
    );

    const stopText = candidate.signal.stopLossPct ?? String(settings.defaultStopPct);
    const stop = optionalDecimal(stopText);
    if (stop === null || stop.lessThanOrEqualTo(0)) {
      pushDrop(candidate, Reason.ALLOC_INVALID_STOP, { stopText });
      continue;
    }

    const riskWeight = ratio(candidate.signal.riskWeight);
    const sizeByRisk = riskBudget.times(riskWeight).times(100).div(stop);

    const volume = optionalDecimal(candidate.avgVolumeUsd);
    const liquidityCap = (volume ?? new Decimal(0)).times(liquidityPct).div(100);

    // Fixed order defines which reason wins when several caps are exhausted.
    const constraints: readonly Constraint[] = [
      { code: Reason.ALLOC_TOKEN_CAP, cap: tokenCap },
      { code: Reason.ALLOC_STRATEGY_CAP, cap: strategyCap },
      { code: Reason.ALLOC_CASH_BUFFER, cap: cashAvailable },
      { code: Reason.ALLOC_RISK_CAP, cap: sizeByRisk },
      { code: Reason.ALLOC_LIQUIDITY_CAP, cap: liquidityCap },
    ];

    const blocked = constraints.find((constraint) => constraint.cap.lessThanOrEqualTo(0));
    if (blocked !== undefined) {
      pushDrop(candidate, blocked.code);
      continue;
    }

    const size = minDecimal(...constraints.map((constraint) => constraint.cap));
    // Emit the size truncated to cents. Rounding up could exceed the exact cap
    // that produced it, and the risk manager (which re-derives the same cap)
    // would veto the allocator's own output.
    const sizeUsd = moneyDown(size);
    const emitted = toDecimal(sizeUsd, 'sizeUsd');
    if (emitted.lessThan(minOrder)) {
      pushDrop(candidate, Reason.ALLOC_SIZE_TOO_SMALL, { size: emitted });
      continue;
    }

    const binding = constraints.find((constraint) => constraint.cap.equals(size));
    allocations.push({
      candidate,
      sizeUsd,
      stopLossPct: stopText,
      takeProfitPct: candidate.signal.takeProfitPct,
      bindingConstraint: binding?.code ?? Reason.ALLOC_TOKEN_CAP,
    });

    openPositions += 1;
    // Accepting a buy makes the token held for the rest of this cycle, so a
    // duplicate ranked candidate cannot buy the same token twice. Accounting
    // uses the emitted (floored) size so it matches the order exactly.
    heldTokens.add(candidate.tokenId);
    tokenValues.set(
      candidate.tokenId,
      (tokenValues.get(candidate.tokenId) ?? new Decimal(0)).plus(emitted),
    );
    strategyValues.set(
      candidate.strategyKey,
      (strategyValues.get(candidate.strategyKey) ?? new Decimal(0)).plus(emitted),
    );
    cashAvailable = cashAvailable.minus(emitted);
  }

  return { allocations, drops };
}
