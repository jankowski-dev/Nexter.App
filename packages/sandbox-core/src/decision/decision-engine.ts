import type { EventLog } from '../events/event-log';
import { TIMEFRAME_MS, candleCloseTime } from '../timeframes';
import type { Candle, Timestamp } from '../types';
import { DEFAULT_REGIME_SETTINGS, settingsVersion } from './defaults';
import { DecisionLogger } from './decision-logger';
import { rankOpportunities } from './opportunity-ranker';
import type { OpportunityCandidate, RankingDrop } from './opportunity-ranker';
import { allocateOpportunities } from './portfolio-allocator';
import { Reason } from './reason-codes';
import type { ReasonCode } from './reason-codes';
import { classifyRegime } from './regime-classifier';
import { checkBuyRisk, checkSellRisk } from './risk-manager';
import type { RiskContext } from './risk-manager';
import { STRATEGY_KEYS, createStrategySet, eligibleStrategyFor } from './strategies';
import type { StrategyRuntime, StrategySignal } from './strategies';
import { deriveTokenPhase } from './token-state';
import type {
  DecisionInput,
  DecisionResult,
  EngineState,
  OrderIntent,
  PortfolioPosition,
  RegimeFeatures,
  RegimeState,
  SandboxDecisionSettings,
  StrategyKey,
  TokenPhase,
  TokenRuntimeState,
  TokenStateView,
} from './types';

/**
 * Pure per-bar decision engine for the sandbox.
 *
 * The engine reads closed candles through the `MarketView`, classifies each
 * token's regime, evaluates the eligible strategy, ranks and allocates buy
 * opportunities, applies risk vetoes and writes a complete audit trail. It
 * never fills, books, reports, talks to a network or reads the wall clock:
 * the caller passes `clockTime`, the portfolio snapshot and the previous
 * `EngineState`, and receives intents plus the next state.
 *
 * Determinism is binding: tokens are visited in UTF-16 code-unit order, the
 * ranker owns its own deterministic ordering, and no `localeCompare`,
 * `Date.now` or `Math.random` is used anywhere in the decision path.
 */

export class DecisionInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecisionInputError';
  }
}

const DECIMAL_PATTERN = /^\d+(\.\d+)?$/;
const ZERO_PATTERN = /^0+(\.0+)?$/;

function invalid(message: string): never {
  throw new DecisionInputError(message);
}

/**
 * Reason code for a buy candidate that must be dropped before ranking because
 * of its preliminary token phase, or `null` when it may be ranked.
 *
 * `COOLDOWN` and `BLOCKED` candidates never reach ranking or allocation, so a
 * cooled-down or blocked signal cannot consume a position slot or produce a
 * misleading `ALLOC_MAX_POSITIONS` drop.
 */
export function rankingDropReasonForPhase(phase: TokenPhase): ReasonCode | null {
  if (phase === 'COOLDOWN') return Reason.RANK_COOLDOWN;
  if (phase === 'BLOCKED') return Reason.RANK_BLOCKED;
  return null;
}

function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function requireDecimal(value: string, label: string): void {
  if (typeof value !== 'string' || !DECIMAL_PATTERN.test(value)) {
    invalid(`${label} must be a non-negative decimal string`);
  }
}

function requirePositiveDecimal(value: string, label: string): void {
  requireDecimal(value, label);
  if (ZERO_PATTERN.test(value)) invalid(`${label} must be greater than zero`);
}

function requirePositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) invalid(`${label} must be a positive integer`);
}

function requireNonNegativeNumber(value: number, label: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    invalid(`${label} must be a non-negative finite number`);
  }
}

function requirePositiveNumber(value: number, label: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    invalid(`${label} must be a positive finite number`);
  }
}

function validatePositions(snapshot: DecisionInput['portfolio']): void {
  const seen = new Set<string>();
  for (const [index, position] of snapshot.positions.entries()) {
    const label = `portfolio.positions[${index}]`;
    if (typeof position.tokenId !== 'string' || position.tokenId.length === 0) {
      invalid(`${label}.tokenId must be a non-empty string`);
    }
    if (seen.has(position.tokenId)) {
      invalid(`portfolio.positions contains duplicate token id "${position.tokenId}"`);
    }
    seen.add(position.tokenId);
    if (!STRATEGY_KEYS.includes(position.strategyKey)) {
      invalid(`${label}.strategyKey "${String(position.strategyKey)}" is not a known strategy`);
    }
    requireDecimal(position.amount, `${label}.amount`);
    requireDecimal(position.avgCostUsd, `${label}.avgCostUsd`);
    requireDecimal(position.marketValueUsd, `${label}.marketValueUsd`);
    if (position.stopLossPct !== null && position.stopLossPct !== undefined) {
      requireDecimal(position.stopLossPct, `${label}.stopLossPct`);
    }
    if (position.takeProfitPct !== null && position.takeProfitPct !== undefined) {
      requireDecimal(position.takeProfitPct, `${label}.takeProfitPct`);
    }
  }
}

function requireObject(value: unknown, label: string): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalid(`${label} must be an object`);
  }
}

function validateRegimeSettings(settings: SandboxDecisionSettings): void {
  requireObject(settings.regime, 'settings.regime');
  const regime = settings.regime;
  for (const key of [
    'fastHours',
    'slowHours',
    'longHours',
    'atrPeriod',
    'rangeWindowHours',
    'liquidityWindowHours',
    'recoveryConfirmBars',
    'regimeDwellBars',
  ] as const) {
    requirePositiveInteger(regime[key], `settings.regime.${key}`);
  }
  if (regime.slowHours < regime.fastHours) {
    invalid('settings.regime.slowHours must be greater than or equal to settings.regime.fastHours');
  }
  if (regime.atrPeriod !== DEFAULT_REGIME_SETTINGS.atrPeriod) {
    invalid(
      `settings.regime.atrPeriod must equal ${DEFAULT_REGIME_SETTINGS.atrPeriod} in Stage 1B`,
    );
  }
  requireDecimal(regime.minLiquidityUsd, 'settings.regime.minLiquidityUsd');
  for (const key of [
    'trendSpreadPct',
    'trendMaxAtrPct',
    'rangeSpreadPct',
    'rangeMaxAtrPct',
    'crashDrawdownPct',
    'crashAtrPct',
  ] as const) {
    requireNonNegativeNumber(regime[key], `settings.regime.${key}`);
  }
}

function validateStrategySettings(settings: SandboxDecisionSettings): void {
  requireObject(settings.strategies, 'settings.strategies');
  const { trendPullback, rangeReversion, recovery } = settings.strategies;
  requireObject(trendPullback, 'settings.strategies.trendPullback');
  requireObject(rangeReversion, 'settings.strategies.rangeReversion');
  requireObject(recovery, 'settings.strategies.recovery');
  requirePositiveInteger(trendPullback.fastPeriod, 'settings.strategies.trendPullback.fastPeriod');
  requirePositiveInteger(trendPullback.slowPeriod, 'settings.strategies.trendPullback.slowPeriod');
  requireNonNegativeNumber(
    trendPullback.pullbackPct,
    'settings.strategies.trendPullback.pullbackPct',
  );
  requirePositiveNumber(trendPullback.atrStopMult, 'settings.strategies.trendPullback.atrStopMult');
  requireNonNegativeNumber(
    trendPullback.trailActivationPct,
    'settings.strategies.trendPullback.trailActivationPct',
  );
  requireNonNegativeNumber(trendPullback.trailPct, 'settings.strategies.trendPullback.trailPct');

  requirePositiveInteger(rangeReversion.lookback, 'settings.strategies.rangeReversion.lookback');
  requireNonNegativeNumber(
    rangeReversion.bandAtrMult,
    'settings.strategies.rangeReversion.bandAtrMult',
  );
  requirePositiveNumber(
    rangeReversion.stopAtrMult,
    'settings.strategies.rangeReversion.stopAtrMult',
  );

  requirePositiveInteger(recovery.fastPeriod, 'settings.strategies.recovery.fastPeriod');
  requirePositiveInteger(recovery.confirmBars, 'settings.strategies.recovery.confirmBars');
  requirePositiveNumber(recovery.stopPct, 'settings.strategies.recovery.stopPct');
  if (
    typeof recovery.riskWeight !== 'number' ||
    !Number.isFinite(recovery.riskWeight) ||
    recovery.riskWeight <= 0 ||
    recovery.riskWeight > 1
  ) {
    invalid('settings.strategies.recovery.riskWeight must be in (0, 1]');
  }
}

function validateInput(input: DecisionInput): void {
  const { clockTime, tokenIds, portfolio: snapshot, settings } = input;

  if (!Number.isSafeInteger(clockTime) || !Number.isFinite(new Date(clockTime).getTime())) {
    invalid('clockTime must be a valid safe-integer timestamp');
  }

  if (!Array.isArray(tokenIds)) invalid('tokenIds must be an array');
  const seenTokens = new Set<string>();
  for (const [index, tokenId] of tokenIds.entries()) {
    if (typeof tokenId !== 'string' || tokenId.length === 0) {
      invalid(`tokenIds[${index}] must be a non-empty string`);
    }
    if (seenTokens.has(tokenId)) invalid(`tokenIds contains duplicate token id "${tokenId}"`);
    seenTokens.add(tokenId);
  }

  const marketSnapshotId = input.market.snapshotId();
  if (marketSnapshotId !== input.dataSnapshotId) {
    invalid(
      `market snapshot "${marketSnapshotId}" does not match dataSnapshotId "${input.dataSnapshotId}"`,
    );
  }

  requirePositiveDecimal(snapshot.equityUsd, 'portfolio.equityUsd');
  requireDecimal(snapshot.cashUsd, 'portfolio.cashUsd');
  requirePositiveDecimal(snapshot.dayStartEquityUsd, 'portfolio.dayStartEquityUsd');
  requirePositiveDecimal(snapshot.peakEquityUsd, 'portfolio.peakEquityUsd');
  validatePositions(snapshot);

  if (!Object.hasOwn(TIMEFRAME_MS, settings.timeframe)) {
    invalid(`settings.timeframe "${settings.timeframe}" is not a known timeframe`);
  }
  if (!Number.isInteger(settings.maxPositions) || settings.maxPositions < 0) {
    invalid('settings.maxPositions must be a non-negative integer');
  }
  for (const key of [
    'maxTokenExposurePct',
    'maxStrategyExposurePct',
    'cashBufferPct',
    'dailyLossLimitPct',
    'maxDrawdownPct',
    'perTradeRiskPct',
    'liquidityCapPct',
  ] as const) {
    requireNonNegativeNumber(settings[key], `settings.${key}`);
  }
  requirePositiveNumber(settings.defaultStopPct, 'settings.defaultStopPct');
  requireDecimal(settings.minOrderUsd, 'settings.minOrderUsd');

  validateRegimeSettings(settings);
  validateStrategySettings(settings);
}

/** Keeps only candles that have already closed at the decision time. */
function visibleCandles(candles: readonly Candle[], now: Timestamp): readonly Candle[] {
  return candles.filter((candle) => candleCloseTime(candle) <= now);
}

function lastCloseOf(candles: readonly Candle[]): string | null {
  const last = candles[candles.length - 1];
  return last === undefined ? null : last.close;
}

interface TokenPass {
  readonly tokenId: string;
  readonly position: PortfolioPosition | null;
  readonly previous: TokenRuntimeState | null;
  readonly candles: readonly Candle[];
  readonly regime: RegimeState;
  readonly signal: StrategySignal | null;
  readonly strategyKey: StrategyKey | null;
  readonly strategyVersion: number | null;
}

interface StrategySelection {
  readonly key: StrategyKey;
  readonly runtime: StrategyRuntime;
}

export class DecisionEngine {
  constructor(private readonly log: EventLog) {}

  async decide(input: DecisionInput): Promise<DecisionResult> {
    validateInput(input);

    const { runId, seed, configVersion, dataSnapshotId, clockTime, settings } = input;
    const clockIso = new Date(clockTime).toISOString();
    const logger = new DecisionLogger(this.log, {
      runId,
      seed,
      configVersion,
      dataSnapshotId,
      clockTime: clockIso,
    });
    const before = this.log.events().length;

    const positionByToken = new Map<string, PortfolioPosition>();
    for (const position of input.portfolio.positions)
      positionByToken.set(position.tokenId, position);

    const evaluatedTokens = [
      ...new Set<string>([...input.tokenIds, ...positionByToken.keys()]),
    ].sort(compareCodeUnits);
    const requestedTokens = [...input.tokenIds].sort(compareCodeUnits);
    const openPositionTokens = [...positionByToken.keys()].sort(compareCodeUnits);

    await logger.cycle({
      tokenIds: requestedTokens,
      evaluatedTokenIds: evaluatedTokens,
      settingsVersion: settingsVersion(settings),
      equityUsd: input.portfolio.equityUsd,
      cashUsd: input.portfolio.cashUsd,
      openPositions: openPositionTokens,
    });

    const strategies = createStrategySet(settings.strategies);
    const passes: TokenPass[] = [];

    for (const tokenId of evaluatedTokens) {
      const previous = input.state.tokens[tokenId] ?? null;
      const position = positionByToken.get(tokenId) ?? null;
      const candles = visibleCandles(input.market.candles(tokenId, settings.timeframe), clockTime);

      const evaluation = classifyRegime({
        tokenId,
        now: clockTime,
        candles,
        previous: previous?.regime ?? null,
        settings: settings.regime,
      });

      await logger.regimeEvaluated({
        tokenId,
        regime: evaluation.state.regime,
        reasonCode: evaluation.reasonCode,
        reasonText: evaluation.reasonText,
        rawRegime: evaluation.rawRegime,
        before: previous?.regime ?? null,
        after: evaluation.state,
      });
      if (evaluation.changed) {
        await logger.regimeChanged({
          tokenId,
          regime: evaluation.state.regime,
          reasonCode: Reason.REGIME_CHANGED,
          reasonText: evaluation.reasonText,
          rawRegime: evaluation.rawRegime,
          before: previous?.regime ?? null,
          after: evaluation.state,
        });
      }

      let selection: StrategySelection | null = null;
      if (position !== null) {
        const key = position.strategyKey;
        selection = { key, runtime: strategies[key] };
      } else {
        const key = eligibleStrategyFor(evaluation.state.regime);
        if (key === null) {
          await logger.strategySkipped({ tokenId, regime: evaluation.state.regime });
        } else {
          selection = { key, runtime: strategies[key] };
        }
      }

      let signal: StrategySignal | null = null;
      let strategyKey: StrategyKey | null = null;
      let strategyVersion: number | null = null;

      if (selection !== null) {
        strategyKey = selection.key;
        strategyVersion = selection.runtime.version;
        await logger.strategySelected({
          tokenId,
          strategyKey,
          strategyVersion,
          reasonCode:
            position !== null
              ? Reason.STRATEGY_ORIGINAL_POSITION
              : Reason.STRATEGY_SELECTED_BY_REGIME,
        });

        const evaluatedSignal = selection.runtime.evaluate({
          now: clockTime,
          tokenId,
          timeframe: settings.timeframe,
          regime: evaluation.state.regime,
          candles,
          position,
          state: previous?.strategyState ?? {},
        });

        await logger.strategyEvaluated({
          tokenId,
          strategyKey,
          strategyVersion,
          signal: evaluatedSignal,
        });

        signal = evaluatedSignal;
        if (position !== null && evaluatedSignal.action === 'buy') {
          await logger.strategyRejected({ tokenId, strategyKey, strategyVersion });
          signal = {
            ...evaluatedSignal,
            action: 'hold',
            reasonCode: Reason.STRATEGY_BUY_WITH_POSITION,
            reasonText: `Strategy ${strategyKey} proposed a buy while ${tokenId} already has an open position; adds are not allowed`,
          };
        }
      }

      passes.push({
        tokenId,
        position,
        previous,
        candles,
        regime: evaluation.state,
        signal,
        strategyKey,
        strategyVersion,
      });
    }

    const phases: Record<string, TokenPhase> = {};
    const features: Record<string, RegimeFeatures> = {};
    const cooldowns: Record<string, Timestamp> = {};
    for (const pass of passes) {
      phases[pass.tokenId] = deriveTokenPhase({
        tokenId: pass.tokenId,
        position: pass.position,
        previous: pass.previous?.phase ?? null,
        cooldownUntil: pass.previous?.cooldownUntil ?? null,
        now: clockTime,
        regime: pass.regime.regime,
        staleBars: pass.regime.features.staleBars,
        hasBuyIntent: false,
      }).phase;
      features[pass.tokenId] = pass.regime.features;
      const cooldownUntil = pass.previous?.cooldownUntil ?? null;
      if (cooldownUntil !== null) cooldowns[pass.tokenId] = cooldownUntil;
    }

    const riskContext: RiskContext = {
      now: clockTime,
      portfolio: input.portfolio,
      settings,
      phases,
      features,
      cooldowns,
    };

    const intents: OrderIntent[] = [];
    const intentKeys = new Set<string>();
    const buyIntentTokens = new Set<string>();
    let riskBlocked = 0;

    // Sells first: reducing risk is never gated by loss, drawdown or cooldown.
    for (const pass of passes) {
      if (pass.position === null || pass.signal === null || pass.signal.action !== 'sell') continue;
      const decisionPriceUsd = lastCloseOf(pass.candles);
      if (decisionPriceUsd === null) continue;

      const position = pass.position;
      const sizeUsd = position.marketValueUsd;
      const outcome = checkSellRisk({ tokenId: pass.tokenId, sizeUsd, context: riskContext });
      await logger.riskChecked({
        kind: 'sell',
        tokenId: pass.tokenId,
        strategyKey: position.strategyKey,
        sizeUsd,
        stopLossPct: null,
        riskWeight: pass.signal.riskWeight,
        outcome,
      });
      if (!outcome.passed) {
        riskBlocked += 1;
        continue;
      }

      const key = `${pass.tokenId}:sell`;
      if (intentKeys.has(key)) continue;
      intentKeys.add(key);
      const intent: OrderIntent = {
        intentId: `${runId}:${pass.tokenId}:sell:${clockIso}:${position.strategyKey}`,
        tokenId: pass.tokenId,
        side: 'sell',
        strategyKey: position.strategyKey,
        strategyVersion: pass.strategyVersion ?? position.strategyVersion,
        reasonCode: pass.signal.reasonCode,
        sizeUsd,
        amount: position.amount,
        stopLossPct: position.stopLossPct,
        takeProfitPct: position.takeProfitPct,
        decisionPriceUsd,
        clockTime,
      };
      intents.push(intent);
      await logger.orderIntent({
        intent,
        reasonText: pass.signal.reasonText,
        bindingConstraint: null,
      });
    }

    // Buys: drive out phase-blocked signals first, then rank every eligible
    // survivor, size it, and veto by risk.
    const candidates: OpportunityCandidate[] = [];
    const phaseDrops: RankingDrop[] = [];
    for (const pass of passes) {
      if (pass.position !== null) continue;
      if (pass.signal === null || pass.signal.action !== 'buy') continue;
      if (pass.strategyKey === null) continue;
      const candidate: OpportunityCandidate = {
        tokenId: pass.tokenId,
        strategyKey: pass.strategyKey,
        signal: pass.signal,
        atrPct: pass.regime.features.atrPct,
        avgVolumeUsd: pass.regime.features.avgVolumeUsd,
      };
      const dropReason = rankingDropReasonForPhase(phases[pass.tokenId]);
      if (dropReason !== null) {
        phaseDrops.push({
          candidate,
          reasonCode: dropReason,
          reasonText:
            dropReason === Reason.RANK_COOLDOWN
              ? `${pass.tokenId} is cooling down and is dropped before ranking`
              : `${pass.tokenId} is blocked and is dropped before ranking`,
        });
        continue;
      }
      candidates.push(candidate);
    }

    for (const drop of phaseDrops) {
      await logger.opportunityDropped({ drop });
    }
    const ranking = rankOpportunities(candidates, settings);
    for (const [index, ranked] of ranking.ranked.entries()) {
      await logger.opportunityRanked({
        ranked,
        next: ranking.ranked[index + 1] ?? null,
      });
    }
    for (const drop of ranking.dropped) {
      await logger.opportunityDropped({ drop });
    }

    const allocationResult = allocateOpportunities(ranking.ranked, input.portfolio, settings);
    const allocatedTokens = new Set(
      allocationResult.allocations.map((entry) => entry.candidate.tokenId),
    );
    for (const allocation of allocationResult.allocations) {
      const nextUnallocated = ranking.ranked.find(
        (ranked) => ranked.rank > allocation.candidate.rank && !allocatedTokens.has(ranked.tokenId),
      );
      await logger.portfolioAllocated({
        allocation,
        nextUnallocated:
          nextUnallocated === undefined
            ? null
            : { tokenId: nextUnallocated.tokenId, strategyKey: nextUnallocated.strategyKey },
      });
    }
    for (const drop of allocationResult.drops) {
      await logger.portfolioDropped({ drop });
    }

    const passByToken = new Map(passes.map((pass) => [pass.tokenId, pass]));
    for (const allocation of allocationResult.allocations) {
      const candidate = allocation.candidate;
      const pass = passByToken.get(candidate.tokenId);
      if (pass === undefined) continue;
      const decisionPriceUsd = lastCloseOf(pass.candles);
      if (decisionPriceUsd === null) continue;

      const outcome = checkBuyRisk({
        tokenId: candidate.tokenId,
        strategyKey: candidate.strategyKey,
        sizeUsd: allocation.sizeUsd,
        stopLossPct: allocation.stopLossPct,
        riskWeight: candidate.signal.riskWeight,
        context: riskContext,
      });
      await logger.riskChecked({
        kind: 'buy',
        tokenId: candidate.tokenId,
        strategyKey: candidate.strategyKey,
        sizeUsd: allocation.sizeUsd,
        stopLossPct: allocation.stopLossPct,
        riskWeight: candidate.signal.riskWeight,
        outcome,
      });
      if (!outcome.passed) {
        riskBlocked += 1;
        continue;
      }

      const key = `${candidate.tokenId}:buy`;
      if (intentKeys.has(key)) continue;
      intentKeys.add(key);
      const intent: OrderIntent = {
        intentId: `${runId}:${candidate.tokenId}:buy:${clockIso}:${candidate.strategyKey}`,
        tokenId: candidate.tokenId,
        side: 'buy',
        strategyKey: candidate.strategyKey,
        strategyVersion: pass.strategyVersion ?? strategies[candidate.strategyKey].version,
        reasonCode: candidate.signal.reasonCode,
        sizeUsd: allocation.sizeUsd,
        amount: null,
        stopLossPct: allocation.stopLossPct,
        takeProfitPct: allocation.takeProfitPct,
        decisionPriceUsd,
        clockTime,
      };
      intents.push(intent);
      buyIntentTokens.add(candidate.tokenId);
      await logger.orderIntent({
        intent,
        reasonText: candidate.signal.reasonText,
        bindingConstraint: allocation.bindingConstraint,
      });
    }

    const tokenViews: TokenStateView[] = [];
    const nextTokens: Record<string, TokenRuntimeState> = {};
    for (const pass of passes) {
      const outcome = deriveTokenPhase({
        tokenId: pass.tokenId,
        position: pass.position,
        previous: pass.previous?.phase ?? null,
        cooldownUntil: pass.previous?.cooldownUntil ?? null,
        now: clockTime,
        regime: pass.regime.regime,
        staleBars: pass.regime.features.staleBars,
        hasBuyIntent: buyIntentTokens.has(pass.tokenId),
      });
      if (outcome.changed) {
        await logger.tokenStateChanged({
          tokenId: pass.tokenId,
          previous: pass.previous?.phase ?? null,
          phase: outcome.phase,
          reasonCode: outcome.reasonCode,
        });
      }
      tokenViews.push({
        tokenId: pass.tokenId,
        phase: outcome.phase,
        reasonCode: outcome.reasonCode,
      });
      nextTokens[pass.tokenId] = {
        tokenId: pass.tokenId,
        regime: pass.regime,
        phase: outcome.phase,
        cooldownUntil: pass.previous?.cooldownUntil ?? null,
        strategyState: pass.signal?.nextState ?? pass.previous?.strategyState ?? {},
      };
    }

    const buys = intents.filter((intent) => intent.side === 'buy').length;
    const sells = intents.length - buys;
    await logger.completed({
      intents: intents.length,
      buys,
      sells,
      dropped:
        phaseDrops.length + ranking.dropped.length + allocationResult.drops.length + riskBlocked,
      tokens: passes.length,
    });

    const state: EngineState = { tokens: nextTokens };

    return {
      clockTime,
      intents,
      tokenViews,
      state,
      eventCount: this.log.events().length - before,
      eventHash: this.log.hash(),
    };
  }
}
