import Decimal from 'decimal.js';
import type {
  SandboxEquityPointRecord,
  SandboxIntentRecord as SandboxIntentDbRecord,
  SandboxPositionRecord,
  SandboxTradeRecord,
} from '@nexter/db';
import {
  SANDBOX_EXECUTION_MODE,
  type SandboxEquityPoint,
  type SandboxEvent,
  type SandboxIntent,
  type SandboxPosition,
  type SandboxRunDetail,
  type SandboxRunSummary,
  type SandboxTrade,
} from '@nexter/contracts';
import type { SandboxEvent as CoreSandboxEvent } from '@nexter/sandbox-core';
import { toRunContract } from './sandbox-run.service';
import type { SandboxRunSummaryRow } from './sandbox.repository';
import type { SandboxRunSnapshot } from './sandbox.types';

/**
 * Shared read-API mapper.
 *
 * Postgres returns `numeric(30,18)`/`numeric(9,4)` values padded to their
 * declared scale (for example `'105.000000000000000000'` or `'14.2150'`). The
 * read contracts expose the core/UI display scales instead: USD two decimals,
 * token amounts and prices eight, percentages four (equity drawdown) or two
 * (return). Every conversion goes through `decimal.js`; raw driver strings are
 * never returned.
 */

function decimal(value: string | Decimal): Decimal {
  return new Decimal(value);
}

/**
 * Rounds first, then normalizes a rounded zero. Normalizing only an exact zero
 * would still emit `-0.00` for a tiny negative value such as `-0.004`.
 */
function formatFixed(value: string | Decimal, decimals: number): string {
  const rounded = decimal(value).toDecimalPlaces(decimals, Decimal.ROUND_HALF_UP);
  return (rounded.isZero() ? new Decimal(0) : rounded).toFixed(decimals);
}

/** Formats a USD value with two decimals (`0` never becomes `-0.00`). */
export function formatUsd(value: string | Decimal): string {
  return formatFixed(value, 2);
}

/** Formats a price or token amount with eight decimals. */
export function formatUnits(value: string | Decimal): string {
  return formatFixed(value, 8);
}

/** Formats a percentage with two decimals. */
export function formatPercent(value: string | Decimal): string {
  return formatFixed(value, 2);
}

/** Formats a high-precision percentage (drawdown) with four decimals. */
export function formatPercentFine(value: string | Decimal): string {
  return formatFixed(value, 4);
}

/** `(equity / initialCapital - 1) * 100`, never NaN when capital is zero. */
export function computeReturnPct(initialCapitalUsd: string, equityUsd: string): string {
  const initial = decimal(initialCapitalUsd);
  if (initial.lessThanOrEqualTo(0)) return '0.00';
  return formatPercent(decimal(equityUsd).div(initial).minus(1).times(100));
}

/** Current drawdown from the persisted peak, clamped at zero. */
export function computeDrawdownPct(peakEquityUsd: string, equityUsd: string): string {
  const peak = decimal(peakEquityUsd);
  if (peak.lessThanOrEqualTo(0)) return '0.0000';
  const drawdown = peak.minus(equityUsd).div(peak).times(100);
  return formatPercentFine(drawdown.isNegative() ? new Decimal(0) : drawdown);
}

function iso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

function isoRequired(value: Date): string {
  return value.toISOString();
}

/** Converts one run-list row to the owner read summary. */
export function toSandboxRunSummary(row: SandboxRunSummaryRow): SandboxRunSummary {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    initialCapitalUsd: formatUsd(row.initialCapitalUsd),
    cashUsd: formatUsd(row.cashUsd),
    equityUsd: formatUsd(row.equityUsd),
    peakEquityUsd: formatUsd(row.peakEquityUsd),
    returnPct: computeReturnPct(row.initialCapitalUsd, row.equityUsd),
    drawdownPct: computeDrawdownPct(row.peakEquityUsd, row.equityUsd),
    tokenCount: row.tokenCount,
    lastBarClose: iso(row.lastBarClose),
    lastTickAt: iso(row.lastTickAt),
    startedAt: iso(row.startedAt),
    stoppedAt: iso(row.stoppedAt),
    archivedAt: iso(row.archivedAt),
    error: row.error,
    createdAt: isoRequired(row.createdAt),
    updatedAt: isoRequired(row.updatedAt),
  };
}

export interface SandboxRunDetailCounts {
  readonly openPositions: number;
  readonly openTrades: number;
  readonly closedTrades: number;
  readonly intents: number;
  readonly pendingIntents: number;
  readonly equityPoints: number;
  readonly ledgerEntries: number;
}

/** Extends the lifecycle contract with the read-only counters the UI needs. */
export function toSandboxRunDetail(
  run: SandboxRunSnapshot,
  counts: SandboxRunDetailCounts,
): SandboxRunDetail {
  return {
    ...toRunContract(run),
    executionMode: SANDBOX_EXECUTION_MODE,
    openPositions: counts.openPositions,
    openTrades: counts.openTrades,
    closedTrades: counts.closedTrades,
    intents: counts.intents,
    pendingIntents: counts.pendingIntents,
    equityPoints: counts.equityPoints,
    ledgerEntries: counts.ledgerEntries,
    eventCount: run.eventSeq,
    eventHash: run.eventHash,
  };
}

export function toSandboxPosition(row: SandboxPositionRecord): SandboxPosition {
  return {
    tokenId: row.tokenId,
    strategyKey: row.strategyKey,
    strategyVersion: row.strategyVersion,
    amount: formatUnits(row.amount),
    avgCostUsd: formatUnits(row.avgCostUsd),
    costBasisUsd: formatUsd(row.costBasisUsd),
    marketPriceUsd: formatUnits(row.marketPriceUsd),
    marketValueUsd: formatUsd(row.marketValueUsd),
    openedAt: isoRequired(row.openedAt),
    stopLossPct: row.stopLossPct === null ? null : formatPercentFine(row.stopLossPct),
    takeProfitPct: row.takeProfitPct === null ? null : formatPercentFine(row.takeProfitPct),
    entryIntentId: row.entryIntentId,
    feesPaidUsd: formatUsd(row.feesPaidUsd),
    updatedAt: isoRequired(row.updatedAt),
  };
}

export function toSandboxTrade(row: SandboxTradeRecord): SandboxTrade {
  return {
    tradeId: row.tradeId,
    tokenId: row.tokenId,
    strategyKey: row.strategyKey,
    strategyVersion: row.strategyVersion,
    entryAt: isoRequired(row.entryAt),
    entryPriceUsd: formatUnits(row.entryPriceUsd),
    entryAmount: formatUnits(row.entryAmount),
    entryNotionalUsd: formatUsd(row.entryNotionalUsd),
    entryFeeUsd: formatUsd(row.entryFeeUsd),
    entryCostBasisUsd: formatUsd(row.entryCostBasisUsd),
    entryIntentId: row.entryIntentId,
    exitAt: iso(row.exitAt),
    exitPriceUsd: row.exitPriceUsd === null ? null : formatUnits(row.exitPriceUsd),
    exitAmount: formatUnits(row.exitAmount),
    exitNotionalUsd: formatUsd(row.exitNotionalUsd),
    exitFeeUsd: formatUsd(row.exitFeeUsd),
    exitReasonCode: row.exitReasonCode,
    exitIntentId: row.exitIntentId,
    realizedPnlUsd: formatUsd(row.realizedPnlUsd),
    status: sandboxTradeStatus(row.status),
    updatedAt: isoRequired(row.updatedAt),
  };
}

function sandboxTradeStatus(value: string): SandboxTrade['status'] {
  switch (value) {
    case 'open':
    case 'closed':
      return value;
    default:
      // A persisted unknown status is a defect; never present it as open.
      throw new Error(`Unknown sandbox trade status "${value}"`);
  }
}

export function toSandboxIntent(row: SandboxIntentDbRecord): SandboxIntent {
  return {
    intentId: row.intentId,
    tokenId: row.tokenId,
    side: sandboxIntentSide(row.side),
    strategyKey: row.strategyKey,
    strategyVersion: row.strategyVersion,
    status: sandboxIntentStatus(row.status),
    requestedUsd: row.requestedUsd === null ? null : formatUsd(row.requestedUsd),
    requestedAmount: row.requestedAmount === null ? null : formatUnits(row.requestedAmount),
    filledUsd: formatUsd(row.filledUsd),
    filledAmount: formatUnits(row.filledAmount),
    priceUsd: row.priceUsd === null ? null : formatUnits(row.priceUsd),
    stopLossPct: row.stopLossPct === null ? null : formatPercentFine(row.stopLossPct),
    takeProfitPct: row.takeProfitPct === null ? null : formatPercentFine(row.takeProfitPct),
    feeUsd: formatUsd(row.feeUsd),
    reasonCode: row.reasonCode,
    strategyReasonCode: row.strategyReasonCode,
    reasonText: row.reasonText,
    decisionTime: isoRequired(row.decisionTime),
    fillTime: iso(row.fillTime),
  };
}

function sandboxIntentSide(value: string): SandboxIntent['side'] {
  switch (value) {
    case 'buy':
    case 'sell':
      return value;
    default:
      throw new Error(`Unknown sandbox intent side "${value}"`);
  }
}

function sandboxIntentStatus(value: string): SandboxIntent['status'] {
  switch (value) {
    case 'pending':
    case 'filled':
    case 'partial':
    case 'rejected':
    case 'expired':
      return value;
    default:
      // Unknown statuses are a persistence defect; fail closed instead of
      // presenting an irreversible intent as filled.
      throw new Error(`Unknown sandbox intent status "${value}"`);
  }
}

export function toSandboxEquityPoint(row: SandboxEquityPointRecord): SandboxEquityPoint {
  return {
    clockTime: isoRequired(row.clockTime),
    equityUsd: formatUsd(row.equityUsd),
    cashUsd: formatUsd(row.cashUsd),
    positionsValueUsd: formatUsd(row.positionsValueUsd),
    drawdownPct: formatPercentFine(row.drawdownPct),
  };
}

/**
 * Maps a core event to the journal contract. Canonical state/input blobs are
 * intentionally omitted; the decision, alternatives and risk checks remain.
 */
export function toSandboxEvent(event: CoreSandboxEvent): SandboxEvent {
  return {
    seq: event.seq,
    clockTime: event.clockTime,
    module: event.module,
    eventType: event.eventType,
    severity: event.severity,
    tokenId: event.tokenId ?? null,
    strategyId: event.strategyId ?? null,
    regime: event.regime ?? null,
    decision: event.decision ?? null,
    alternatives: [...(event.alternatives ?? [])],
    riskChecks: [...(event.riskChecks ?? [])],
    dataSnapshotId: event.dataSnapshotId,
    configVersion: event.configVersion,
    seed: event.seed,
    correlationId: event.correlationId ?? null,
    reasonCode: event.reasonCode ?? null,
    reasonText: event.reasonText ?? null,
    recordedAt: event.recordedAt,
    prevHash: event.prevHash,
    hash: event.hash,
  };
}
