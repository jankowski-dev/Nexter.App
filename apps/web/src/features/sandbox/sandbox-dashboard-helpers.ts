import Decimal from 'decimal.js';
import type {
  SandboxEvent,
  SandboxPosition,
  SandboxRunDetail,
  SandboxRunStatus,
  SandboxRunToken,
} from '@nexter/contracts';

/** `(equity / initialCapital - 1) * 100`, two decimals, never NaN. */
export function sandboxRunReturnPct(run: { equityUsd: string; initialCapitalUsd: string }): string {
  const initial = new Decimal(run.initialCapitalUsd);
  if (initial.lessThanOrEqualTo(0)) return '0.00';
  return new Decimal(run.equityUsd).div(initial).minus(1).times(100).toFixed(2);
}

/** `(peak - equity) / peak * 100`, four decimals, never negative. */
export function sandboxRunDrawdownPct(run: { equityUsd: string; peakEquityUsd: string }): string {
  const peak = new Decimal(run.peakEquityUsd);
  if (peak.lessThanOrEqualTo(0)) return '0.0000';
  const drawdown = peak.minus(run.equityUsd).div(peak).times(100);
  return Decimal.max(drawdown, 0).toFixed(4);
}

/** `(equity - initialCapital)`, two decimals, exact decimal arithmetic. */
export function sandboxAbsolutePnlUsd(run: {
  equityUsd: string;
  initialCapitalUsd: string;
}): string {
  return new Decimal(run.equityUsd).minus(run.initialCapitalUsd).toFixed(2);
}

/**
 * Exclusive `afterSeq` for a latest-events tail read. The event chain is
 * 0-based; when the run has more events than the page limit, skip to
 * `eventCount - limit - 1` so `seq > afterSeq` returns the newest `limit`
 * events. A run that fits entirely starts at 0 (`null` = omit the cursor).
 */
export function sandboxTailEventsAfterSeq(eventCount: number, limit: number): number | null {
  if (!Number.isFinite(eventCount) || eventCount <= limit) return null;
  return Math.max(0, Math.trunc(eventCount) - Math.trunc(limit) - 1);
}

/** Universe staleness filtered to the tokens of one run. */
export function sandboxRunStaleTokens(
  staleTokens: readonly string[],
  tokenIds: readonly string[],
): string[] {
  const runTokens = new Set(tokenIds);
  return staleTokens.filter((tokenId) => runTokens.has(tokenId));
}

export type SandboxPnlTone = 'positive' | 'negative' | 'flat';

export interface SandboxPositionPnl {
  pnlUsd: string;
  pnlPct: string;
  tone: SandboxPnlTone;
}

/**
 * Cost-basis P&L of an open position from contract strings. The values are
 * display summaries derived with exact decimal arithmetic; the persisted
 * money strings stay untouched.
 */
export function sandboxPositionPnl(position: SandboxPosition): SandboxPositionPnl {
  const costBasis = new Decimal(position.costBasisUsd);
  const marketValue = new Decimal(position.marketValueUsd);
  const pnl = marketValue.minus(costBasis);
  const pnlPct = costBasis.greaterThan(0) ? pnl.div(costBasis).times(100) : new Decimal(0);

  return {
    pnlUsd: pnl.toFixed(2),
    pnlPct: pnlPct.toFixed(2),
    tone: pnl.greaterThan(0) ? 'positive' : pnl.lessThan(0) ? 'negative' : 'flat',
  };
}

export interface SandboxCloseEligibility {
  eligible: boolean;
  reason: string | null;
}

export interface SandboxCloseConfirmation {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  variant: 'danger';
}

/**
 * Confirmation copy of the single manual action. It states explicitly that a
 * sell intent is queued for the next closed 1h bar and that no manual buy
 * exists in the sandbox.
 */
export function sandboxCloseConfirmation(symbol: string): SandboxCloseConfirmation {
  return {
    title: 'Закрыть сделку?',
    description: `Будет поставлен интент на продажу ${symbol}. Он исполнится на следующем закрытом баре 1h по первой доступной котировке. Ручная покупка в песочнице недоступна.`,
    confirmLabel: 'Закрыть сделку',
    cancelLabel: 'Отмена',
    variant: 'danger',
  };
}

/**
 * A close is offered only for a running run and a positive open amount. The
 * close queues a sell intent; it never fills immediately and never buys.
 */
export function sandboxCloseEligibility(input: {
  status: SandboxRunStatus;
  amount: string;
  archivedAt?: string | null;
}): SandboxCloseEligibility {
  if (input.archivedAt) {
    return {
      eligible: false,
      reason: 'Запуск в архиве: доступен только просмотр и отчёты.',
    };
  }
  if (input.status !== 'running') {
    return {
      eligible: false,
      reason: 'Закрытие доступно только у работающего запуска.',
    };
  }
  if (new Decimal(input.amount).lessThanOrEqualTo(0)) {
    return {
      eligible: false,
      reason: 'По токену нет открытой позиции.',
    };
  }
  return { eligible: true, reason: null };
}

export interface SandboxTokenStateView {
  tokenId: string;
  symbol: string;
  regime: string | null;
  lastEventAt: string | null;
  action: NonNullable<SandboxEvent['decision']>['action'] | null;
  reasonText: string | null;
  severity: SandboxEvent['severity'] | null;
  positionAmount: string | null;
  riskStatus: 'passed' | 'failed' | null;
  failedRiskChecks: number;
}

/**
 * Per-token state derived from the latest *relevant* journal events.
 *
 * A typical latest event (`strategy.evaluated`, `ledger.entry`) carries neither
 * a decision, a regime nor risk checks, so each field comes from the latest
 * event that actually has it; risk is only claimed from an event with
 * `riskChecks`, never inferred from severity. The event time stays the latest
 * event of the token.
 */
export function sandboxTokenStates(input: {
  tokens: readonly SandboxRunToken[];
  events: readonly SandboxEvent[];
  positions: readonly SandboxPosition[];
}): SandboxTokenStateView[] {
  const latestByToken = new Map<string, SandboxEvent>();
  const regimeByToken = new Map<string, SandboxEvent>();
  const decisionByToken = new Map<string, SandboxEvent>();
  const riskByToken = new Map<string, SandboxEvent>();

  for (const event of input.events) {
    if (event.tokenId === null) continue;
    const tokenId = event.tokenId;
    const latest = latestByToken.get(tokenId);
    if (!latest || event.seq > latest.seq) latestByToken.set(tokenId, event);

    if (event.regime !== null) {
      const current = regimeByToken.get(tokenId);
      if (!current || event.seq > current.seq) regimeByToken.set(tokenId, event);
    }
    if (event.decision !== null) {
      const current = decisionByToken.get(tokenId);
      if (!current || event.seq > current.seq) decisionByToken.set(tokenId, event);
    }
    if (event.riskChecks.length > 0) {
      const current = riskByToken.get(tokenId);
      if (!current || event.seq > current.seq) riskByToken.set(tokenId, event);
    }
  }

  const positionByToken = new Map(input.positions.map((position) => [position.tokenId, position]));

  return input.tokens.map((token) => {
    const latest = latestByToken.get(token.tokenKey) ?? null;
    const regime = regimeByToken.get(token.tokenKey) ?? null;
    const decision = decisionByToken.get(token.tokenKey) ?? null;
    const risk = riskByToken.get(token.tokenKey) ?? null;
    const position = positionByToken.get(token.tokenKey) ?? null;
    const failedRiskChecks = risk ? risk.riskChecks.filter((check) => !check.passed).length : 0;

    return {
      tokenId: token.tokenKey,
      symbol: token.symbol,
      regime: regime?.regime ?? null,
      lastEventAt: latest?.clockTime ?? null,
      action: decision?.decision?.action ?? null,
      reasonText: decision?.decision?.reasonText ?? decision?.reasonText ?? null,
      severity: latest?.severity ?? null,
      positionAmount: position ? position.amount : null,
      riskStatus: risk ? (failedRiskChecks > 0 ? 'failed' : 'passed') : null,
      failedRiskChecks,
    };
  });
}

export interface SandboxLastDecisionView {
  seq: number;
  clockTime: string;
  tokenId: string | null;
  action: NonNullable<SandboxEvent['decision']>['action'];
  sizeUsd: string | null;
  reasonText: string;
  alternatives: number;
  severity: SandboxEvent['severity'];
}

/** Latest event that carries a decision payload, by sequence. */
export function sandboxLastDecision(
  events: readonly SandboxEvent[],
): SandboxLastDecisionView | null {
  let latest: SandboxEvent | null = null;
  for (const event of events) {
    if (!event.decision) continue;
    if (!latest || event.seq > latest.seq) latest = event;
  }
  if (!latest || !latest.decision) return null;
  return {
    seq: latest.seq,
    clockTime: latest.clockTime,
    tokenId: latest.tokenId,
    action: latest.decision.action,
    sizeUsd: latest.decision.sizeUsd,
    reasonText: latest.decision.reasonText,
    alternatives: latest.alternatives.length,
    severity: latest.severity,
  };
}

export interface SandboxFreshnessWarning {
  tone: 'ok' | 'warning' | 'danger';
  message: string;
}

export interface SandboxFreshnessInput {
  lastBarClose: string | null;
  lastTickAt: string | null;
  lastCandleAt: string | null;
  staleTokens: readonly string[];
  now: Date;
  barMs?: number;
}

/**
 * Human-readable data freshness for the dashboard. A 1h run is considered stale
 * when the last closed bar or candle is older than two bar intervals, matching
 * the server's one-bar staleness threshold with a grace period for the tick.
 */
export function sandboxFreshnessWarnings(input: SandboxFreshnessInput): SandboxFreshnessWarning[] {
  const barMs = input.barMs ?? 3_600_000;
  const now = input.now.getTime();
  const warnings: SandboxFreshnessWarning[] = [];

  if (input.staleTokens.length > 0) {
    const sample = input.staleTokens.slice(0, 3).join(', ');
    const suffix = input.staleTokens.length > 3 ? '…' : '';
    warnings.push({
      tone: 'danger',
      message: `Устаревшие данные 1h: ${input.staleTokens.length} ток. (${sample}${suffix}).`,
    });
  }

  if (input.lastBarClose === null) {
    warnings.push({
      tone: 'warning',
      message: 'Закрытых баров 1h ещё нет: первое решение появится после закрытия бара.',
    });
  } else if (now - Date.parse(input.lastBarClose) > barMs * 2) {
    warnings.push({ tone: 'warning', message: 'Последний закрытый бар старше двух часов.' });
  }

  if (input.lastCandleAt !== null && now - Date.parse(input.lastCandleAt) > barMs * 2) {
    warnings.push({ tone: 'warning', message: 'Последняя свеча 1h старше двух часов.' });
  }

  if (input.lastTickAt !== null && now - Date.parse(input.lastTickAt) > 180_000) {
    warnings.push({ tone: 'warning', message: 'Последний тик был больше трёх минут назад.' });
  }

  return warnings;
}

/** Headline freshness tone: the worst warning wins, otherwise `ok`. */
export function sandboxFreshnessTone(
  warnings: readonly SandboxFreshnessWarning[],
): SandboxFreshnessWarning['tone'] {
  if (warnings.some((warning) => warning.tone === 'danger')) return 'danger';
  if (warnings.some((warning) => warning.tone === 'warning')) return 'warning';
  return 'ok';
}

/** Position/trade/token counts summary of a run detail. */
export function sandboxRunCounts(detail: SandboxRunDetail): {
  positions: number;
  openTrades: number;
  closedTrades: number;
  intents: number;
  pendingIntents: number;
  events: number;
} {
  return {
    positions: detail.openPositions,
    openTrades: detail.openTrades,
    closedTrades: detail.closedTrades,
    intents: detail.intents,
    pendingIntents: detail.pendingIntents,
    events: detail.eventCount,
  };
}
