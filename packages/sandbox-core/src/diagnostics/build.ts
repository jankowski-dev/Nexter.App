import { TIMEFRAME_MS } from '../timeframes';
import type { SandboxEvent } from '../events/event-types';
import type { BuildBarDiagnosticsInput, BarDiagnostic } from './types';

function iso(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

function stringValue(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function featuresOf(event: SandboxEvent | undefined): Record<string, unknown> {
  return record(event?.inputs?.features) ?? {};
}

function riskChecksOf(event: SandboxEvent | undefined): string | null {
  if (!event?.riskChecks || event.riskChecks.length === 0) return null;
  return event.riskChecks
    .map((check) => `${check.name}:${String(check.passed)}:${check.limit}`)
    .join('|');
}

function eventKey(clockTime: string, tokenId: string, eventType: string): string {
  return `${clockTime}|${tokenId}|${eventType}`;
}

/**
 * Joins the persisted run report (intent/equity projections) with the full
 * decision event stream from `runPaperFromCandles`.
 *
 * The engine does not persist regime/strategy/risk events in replay reports, so
 * this builder is intentionally research-only. It never writes back to the run.
 */
export function buildBarDiagnostics(input: BuildBarDiagnosticsInput): BarDiagnostic[] {
  const step = TIMEFRAME_MS[input.timeframe];
  if (step === undefined) throw new Error(`Unknown timeframe ${input.timeframe}`);

  const candles = input.candles
    .filter((candle) => candle.tokenId === input.tokenId && candle.timeframe === input.timeframe)
    .slice()
    .sort((left, right) => left.openTime - right.openTime);

  const byKey = new Map<string, SandboxEvent>();
  for (const event of input.events) {
    if (!event.tokenId || event.tokenId !== input.tokenId) continue;
    const key = eventKey(event.clockTime, input.tokenId, event.eventType);
    if (!byKey.has(key)) byKey.set(key, event);
  }

  const intents = new Map<string, (typeof input.report.intentJournal)[number]>();
  for (const intent of input.report.intentJournal) {
    if (intent.tokenId !== input.tokenId) continue;
    const key = iso(intent.decisionTime);
    if (!intents.has(key)) intents.set(key, intent);
  }

  const equity = new Map<string, (typeof input.report.equityCurve)[number]>();
  for (const point of input.report.equityCurve) {
    equity.set(iso(point.clockTime), point);
  }

  const ledger = input.events
    .filter(
      (event) =>
        event.tokenId === input.tokenId &&
        event.eventType === 'ledger.entry' &&
        typeof event.inputs?.positionAmountAfter === 'string',
    )
    .slice()
    .sort((left, right) => Date.parse(left.clockTime) - Date.parse(right.clockTime));

  let ledgerIndex = 0;
  let positionAmount: string | null = null;
  const rows: BarDiagnostic[] = [];

  for (let barIndex = 0; barIndex < candles.length; barIndex += 1) {
    const candle = candles[barIndex] as (typeof candles)[number];
    const closeTime = candle.openTime + step;
    const clockTime = iso(closeTime);

    while (ledgerIndex < ledger.length && Date.parse(ledger[ledgerIndex]!.clockTime) <= closeTime) {
      positionAmount = String(ledger[ledgerIndex]!.inputs?.positionAmountAfter);
      ledgerIndex += 1;
    }

    const regime = byKey.get(eventKey(clockTime, input.tokenId, 'regime.evaluated'));
    const strategy = byKey.get(eventKey(clockTime, input.tokenId, 'strategy.evaluated'));
    const risk = byKey.get(eventKey(clockTime, input.tokenId, 'risk.checked'));
    const filled = byKey.get(eventKey(clockTime, input.tokenId, 'execution.filled'));
    const partial = byKey.get(eventKey(clockTime, input.tokenId, 'execution.partial'));
    const execution = filled ?? partial;
    const intent = intents.get(clockTime);
    const point = equity.get(clockTime);
    const features = featuresOf(regime);
    const signalInputs = record(strategy?.inputs) ?? {};

    rows.push({
      barIndex,
      tokenId: input.tokenId,
      timeframe: input.timeframe,
      openTime: iso(candle.openTime),
      closeTime: clockTime,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volumeUsd: candle.volumeUsd,
      regime: stringValue(regime?.stateAfter?.regime) ?? stringValue(regime?.regime),
      regimeReason: regime?.reasonCode ?? null,
      fastSma: stringValue(features.fastSma),
      slowSma: stringValue(features.slowSma),
      longSma: stringValue(features.longSma),
      atrPct: stringValue(features.atrPct),
      recentHigh: stringValue(features.recentHigh),
      recentLow: stringValue(features.recentLow),
      drawdownPct: stringValue(features.drawdownPct),
      avgVolumeUsd: stringValue(features.avgVolumeUsd),
      staleBars: numberValue(features.staleBars),
      strategyKey: strategy?.strategyId ?? null,
      signalAction: stringValue(signalInputs.action),
      signalReason: strategy?.reasonCode ?? null,
      confidence: stringValue(signalInputs.confidence),
      riskWeight: stringValue(signalInputs.riskWeight),
      riskDecision: risk?.decision?.action ?? null,
      riskReason: risk?.decision?.reasonCode ?? risk?.reasonCode ?? null,
      riskChecks: riskChecksOf(risk),
      intentSide: intent?.side ?? null,
      intentStatus: intent?.status ?? null,
      intentReason: intent?.strategyReasonCode ?? null,
      fillSide: stringValue(execution?.inputs?.side),
      fillPrice: stringValue(execution?.inputs?.priceUsd),
      fillStatus: filled ? 'filled' : partial ? 'partial' : null,
      positionAmount,
      equityUsd: point?.equityUsd ?? null,
      cashUsd: point?.cashUsd ?? null,
      equityDrawdownPct: point?.drawdownPct ?? null,
    });
  }

  return rows;
}
