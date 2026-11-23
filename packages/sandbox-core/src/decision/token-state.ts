import type { Timestamp } from '../types';
import { Reason } from './reason-codes';
import type { ReasonCode } from './reason-codes';
import type { PortfolioPosition, Regime, TokenPhase } from './types';

/**
 * Token phase derivation for the decision engine view.
 *
 * The phase is a projection of the portfolio, the host-provided cooldown, the
 * regime and the surviving buy intent. It is never persisted by this module and
 * carries no fills or equity: Stage 1C owns state and execution.
 *
 * Precedence is intentional: an open position is always visible first, then an
 * active cooldown, then a blocked market, and only a healthy token can be armed
 * or stay asleep.
 */

export interface TokenStateInput {
  readonly tokenId: string;
  readonly position: PortfolioPosition | null;
  readonly previous: TokenPhase | null;
  readonly cooldownUntil: Timestamp | null;
  readonly now: Timestamp;
  readonly regime: Regime;
  readonly staleBars: number;
  readonly hasBuyIntent: boolean;
}

export interface TokenStateOutcome {
  readonly phase: TokenPhase;
  readonly reasonCode: ReasonCode;
  readonly changed: boolean;
}

const PHASE_REASONS: Readonly<Record<TokenPhase, ReasonCode>> = {
  IN_POSITION: Reason.TOKEN_IN_POSITION,
  COOLDOWN: Reason.TOKEN_COOLDOWN,
  BLOCKED: Reason.TOKEN_BLOCKED,
  ARMED: Reason.TOKEN_ARMED,
  SLEEPING: Reason.TOKEN_SLEEPING,
};

function resolvePhase(input: TokenStateInput): TokenPhase {
  if (input.position !== null) return 'IN_POSITION';
  if (input.cooldownUntil !== null && input.cooldownUntil > input.now) return 'COOLDOWN';
  if (input.regime === 'ILLIQUID' || input.regime === 'UNKNOWN' || input.staleBars > 0) {
    return 'BLOCKED';
  }
  if (input.hasBuyIntent) return 'ARMED';
  return 'SLEEPING';
}

/**
 * Derives the token phase and whether it changed since the previous cycle.
 * `previous === null` (first observation) counts as a change so the log always
 * records the initial phase.
 */
export function deriveTokenPhase(input: TokenStateInput): TokenStateOutcome {
  const phase = resolvePhase(input);
  return {
    phase,
    reasonCode: PHASE_REASONS[phase],
    changed: input.previous !== phase,
  };
}
