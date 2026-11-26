import type { RunReport } from '../paper/types';
import type { SandboxEvent } from '../events/event-types';
import type { Candle } from '../types';

/** One research row per evaluated replay bar. Not part of the production report. */
export interface BarDiagnostic {
  readonly barIndex: number;
  readonly tokenId: string;
  readonly timeframe: string;
  readonly openTime: string;
  readonly closeTime: string;
  readonly open: string;
  readonly high: string;
  readonly low: string;
  readonly close: string;
  readonly volumeUsd: string;
  readonly regime: string | null;
  readonly regimeReason: string | null;
  readonly fastSma: string | null;
  readonly slowSma: string | null;
  readonly longSma: string | null;
  readonly atrPct: string | null;
  readonly recentHigh: string | null;
  readonly recentLow: string | null;
  readonly drawdownPct: string | null;
  readonly avgVolumeUsd: string | null;
  readonly staleBars: number | null;
  readonly strategyKey: string | null;
  readonly signalAction: string | null;
  readonly signalReason: string | null;
  readonly confidence: string | null;
  readonly riskWeight: string | null;
  readonly riskDecision: string | null;
  readonly riskReason: string | null;
  readonly riskChecks: string | null;
  readonly intentSide: string | null;
  readonly intentStatus: string | null;
  readonly intentReason: string | null;
  readonly fillSide: string | null;
  readonly fillPrice: string | null;
  readonly fillStatus: string | null;
  readonly positionAmount: string | null;
  readonly equityUsd: string | null;
  readonly cashUsd: string | null;
  readonly equityDrawdownPct: string | null;
}

export interface BuildBarDiagnosticsInput {
  readonly candles: readonly Candle[];
  readonly events: readonly SandboxEvent[];
  readonly report: Pick<RunReport, 'intentJournal' | 'equityCurve'>;
  readonly tokenId: string;
  readonly timeframe: string;
}
