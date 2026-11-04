import { ForbiddenException } from '@nestjs/common';
import type { SwapOrder } from '@nexter/db';
import { env } from '../../shared/config/env';
import { Decimal, decimal } from '../../shared/money/decimal';
import type { AuthContext } from '../auth/auth.types';

export function normalizeUsd(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;

  try {
    const parsed = decimal(String(value));

    if (!parsed.isFinite() || parsed.lte(0) || parsed.gte(new Decimal('1e15'))) return null;
    return parsed.toFixed(8);
  } catch {
    return null;
  }
}

export function amountInUsd(order: SwapOrder): Decimal | null {
  const stored = normalizeUsd(order.amountInUsd);
  if (stored) return decimal(stored);

  const routeSummary = order.routeSummary as Record<string, unknown>;
  const fromRoute = normalizeUsd(routeSummary.amountInUsd);
  return fromRoute ? decimal(fromRoute) : null;
}

export function requiresStepUp(order: SwapOrder): boolean {
  const usd = amountInUsd(order);

  // Fail closed: unknown USD cannot prove the swap is below the threshold.
  if (usd === null) return true;
  return usd.gt(env.SWAP_STEP_UP_THRESHOLD_USD);
}

export function assertStepUp(auth: AuthContext, order: SwapOrder): void {
  if (!requiresStepUp(order)) return;

  if (!auth.session.stepUpUntil || auth.session.stepUpUntil.getTime() <= Date.now()) {
    throw new ForbiddenException({
      code: 'SWAP_STEP_UP_REQUIRED',
      message: 'Step-up TOTP is required for this swap',
    });
  }
}
