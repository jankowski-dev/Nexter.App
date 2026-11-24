import {
  SANDBOX_STALE_AFTER_MS,
  SANDBOX_TIMEFRAME_MS,
  type SandboxCoverageStatus,
  type SandboxReplayCoverage,
  type SandboxReplayPeriod,
} from '@nexter/contracts';

/** A shortened (`allowPartial`) evaluation window needs this many 1h bars. */
export const SANDBOX_REPLAY_MIN_PARTIAL_BARS = 240;

/** The candle store keeps at most 180 days of 1h history per token. */
export const SANDBOX_REPLAY_PREFIX_DAYS = 180;
/**
 * Minimal candle summary the coverage math needs. Structurally compatible with
 * the repository's `SandboxCandleStats`.
 */
export interface SandboxReplayCandleStats {
  readonly available: number;
  readonly firstOpenTime: Date | null;
  readonly lastOpenTime: Date | null;
  readonly syntheticCandles: number;
}

/**
 * Stats for one token. `requested`/`requestedPrefix` cover the requested
 * evaluation window and its lookback prefix; `partial`/`partialPrefix` are the
 * same summaries after `allowPartial` moves `from_time` forward. Supplying the
 * exact shortened stats keeps the reported `available`/`gaps` truthful.
 */
export interface SandboxReplayWindowStats {
  readonly tokenKey: string;
  readonly latestClosedOpenTime: Date | null;
  readonly firstOpenTime: Date | null;
  readonly lastOpenTime: Date | null;
  readonly requested: SandboxReplayCandleStats;
  readonly requestedPrefix: SandboxReplayCandleStats;
  readonly partial?: SandboxReplayCandleStats;
  readonly partialPrefix?: SandboxReplayCandleStats;
}

export interface SandboxReplayWindow {
  /** First evaluation candle open. */
  readonly fromTime: Date;
  /** Last evaluation candle close. */
  readonly toTime: Date;
  /** The requested (unshortened) evaluation start. */
  readonly requestedFromTime: Date;
  readonly evaluationBars: number;
  readonly status: SandboxCoverageStatus;
  /** True when the requested window was shortened by `allowPartial`. */
  readonly shortened: boolean;
  readonly warnings: string[];
  readonly coverage: SandboxReplayCoverage[];
}

/**
 * Resolves the replay window and per-token coverage.
 *
 * - `toTime` is the earliest latest closed candle across the selected tokens
 *   plus one bar (i.e. that candle's close), so every token has data at the end.
 * - The requested evaluation window is `[toTime - periodDays, toTime)`.
 * - With `allowPartial`, an incomplete requested window starts at the earliest
 *   commonly available candle (the latest first candle among the tokens) and
 *   records the actual window.
 * - A gap inside the evaluation window is a block (`partial`/`missing`); the
 *   lookback prefix may be shorter (180-day stores have no prefix).
 */
export function replayWindow(
  statsByToken: ReadonlyMap<string, SandboxReplayWindowStats>,
  periodDays: SandboxReplayPeriod,
  allowPartial: boolean,
  now: Date = new Date(),
): SandboxReplayWindow {
  const entries = [...statsByToken.values()];
  const requestedBars = periodDays * 24;

  if (entries.length === 0) {
    const toTime = floorHour(now);
    const fromTime = new Date(toTime.getTime() - requestedBars * SANDBOX_TIMEFRAME_MS);
    return {
      fromTime,
      toTime,
      requestedFromTime: fromTime,
      evaluationBars: requestedBars,
      status: 'missing',
      shortened: false,
      warnings: ['Не выбрано ни одного токена для исторического прогона.'],
      coverage: [],
    };
  }

  const closedOpenTimes = entries.map((entry) => entry.latestClosedOpenTime);
  const hasEveryClosed = closedOpenTimes.every((value): value is Date => value !== null);
  const earliestClosed =
    closedOpenTimes.length > 0
      ? closedOpenTimes.reduce<Date | null>(
          (earliest, value) =>
            value === null || (earliest !== null && earliest <= value) ? earliest : value,
          null,
        )
      : null;

  const toTime = earliestClosed
    ? new Date(earliestClosed.getTime() + SANDBOX_TIMEFRAME_MS)
    : floorHour(now);
  const requestedFromTime = new Date(toTime.getTime() - requestedBars * SANDBOX_TIMEFRAME_MS);

  if (!hasEveryClosed) {
    const coverage = entries.map((entry) =>
      buildReplayCoverage(
        entry.tokenKey,
        entry.requested,
        requestedFromTime,
        toTime,
        entry.requestedPrefix,
        now,
      ),
    );
    const warnings = [
      'Нет закрытых часовых свечей для части выбранных токенов.',
      ...entries
        .filter((entry) => entry.latestClosedOpenTime === null)
        .map((entry) => `Токен ${entry.tokenKey} не имеет закрытых часовых свечей.`),
    ];

    return {
      fromTime: requestedFromTime,
      toTime,
      requestedFromTime,
      evaluationBars: requestedBars,
      status: 'missing',
      shortened: false,
      warnings: unique(warnings),
      coverage,
    };
  }

  const fullWindowCovered = entries.every(
    (entry) => Math.max(0, Math.trunc(entry.requested.available)) >= requestedBars,
  );

  let fromTime = requestedFromTime;
  let shortened = false;

  if (allowPartial && !fullWindowCovered) {
    const firstOpenTimes = entries.map((entry) => entry.requested.firstOpenTime);
    if (firstOpenTimes.every((value): value is Date => value !== null)) {
      const earliestCommon = new Date(Math.max(...firstOpenTimes.map((value) => value.getTime())));
      if (earliestCommon.getTime() > requestedFromTime.getTime()) {
        fromTime = earliestCommon;
        shortened = true;
      }
    }
  }

  const evaluationBars = Math.max(
    0,
    Math.round((toTime.getTime() - fromTime.getTime()) / SANDBOX_TIMEFRAME_MS),
  );

  const coverage = entries.map((entry) =>
    buildReplayCoverage(
      entry.tokenKey,
      shortened ? (entry.partial ?? entry.requested) : entry.requested,
      fromTime,
      toTime,
      shortened ? (entry.partialPrefix ?? entry.requestedPrefix) : entry.requestedPrefix,
      now,
    ),
  );

  const warnings: string[] = [];
  if (shortened) {
    warnings.push(
      `Окно прогона сокращено до ${evaluationBars} ч ` +
        `(${fromTime.toISOString()} — ${toTime.toISOString()}).`,
    );
    if (evaluationBars < SANDBOX_REPLAY_MIN_PARTIAL_BARS) {
      warnings.push(
        `Для сокращённого окна нужно минимум ${SANDBOX_REPLAY_MIN_PARTIAL_BARS} часовых свечей; ` +
          `доступно ${evaluationBars}.`,
      );
    }
  }
  for (const token of coverage) {
    if (token.warning !== null) warnings.push(token.warning);
  }

  const status: SandboxCoverageStatus = coverage.some((token) => token.status === 'missing')
    ? 'missing'
    : shortened || coverage.some((token) => token.status === 'partial')
      ? 'partial'
      : 'ok';

  return {
    fromTime,
    toTime,
    requestedFromTime,
    evaluationBars,
    status,
    shortened,
    warnings: unique(warnings),
    coverage,
  };
}

/**
 * Builds one token's window coverage. `available` counts bars inside
 * `[from, to)`; `prefixBars` counts lookback bars before `from`. A gap in the
 * evaluation window is `partial`; no bars at all is `missing`. Synthetic and
 * stale data are surfaced as warnings, not blocks.
 */
export function buildReplayCoverage(
  tokenKey: string,
  stats: SandboxReplayCandleStats,
  from: Date,
  to: Date,
  prefixStats: SandboxReplayCandleStats,
  now: Date,
): SandboxReplayCoverage {
  const required = Math.max(1, Math.round((to.getTime() - from.getTime()) / SANDBOX_TIMEFRAME_MS));
  const available = Math.min(Math.max(0, Math.trunc(stats.available)), required);
  const gaps = Math.max(0, required - available);
  const prefixBars = Math.max(0, Math.trunc(prefixStats.available));
  const synthetic = stats.syntheticCandles > 0;
  const stale = now.getTime() - to.getTime() > SANDBOX_STALE_AFTER_MS;
  const status: SandboxCoverageStatus = available === 0 ? 'missing' : gaps === 0 ? 'ok' : 'partial';

  const warnings: string[] = [];
  if (available === 0) {
    warnings.push('Нет часовых свечей в окне прогона.');
  } else if (gaps > 0) {
    warnings.push(`Доступно ${available} из ${required} часовых свечей в окне прогона.`);
  }
  if (synthetic) {
    warnings.push('Данные CoinGecko помечены как synthetic и не являются биржевым OHLCV.');
  }
  if (stale) {
    warnings.push('Последняя свеча окна старше одного закрытого бара (1h).');
  }
  if (prefixBars === 0 && required < SANDBOX_REPLAY_PREFIX_DAYS * 24) {
    warnings.push('Нет истории перед окном прогона: индикаторы стартуют без прогрева.');
  }

  return {
    tokenKey,
    fromTime: from.toISOString(),
    toTime: to.toISOString(),
    available,
    required,
    prefixBars,
    gaps,
    synthetic,
    stale,
    status,
    warning: warnings.length > 0 ? warnings.join(' ') : null,
  };
}

function floorHour(value: Date): Date {
  return new Date(Math.floor(value.getTime() / SANDBOX_TIMEFRAME_MS) * SANDBOX_TIMEFRAME_MS);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
