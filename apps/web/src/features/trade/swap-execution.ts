import type { SwapOrderDetail } from '@nexter/contracts';

export interface ParsedProtectionPct {
  value: number | null;
  error: string | null;
}

/**
 * `0` and an empty field mean "protection disabled"; the API only accepts
 * positive percentages, so sending a raw 0 would fail with VALIDATION_ERROR.
 */
export function parseProtectionPct(
  value: string,
  min: number,
  max: number,
  label: string,
): ParsedProtectionPct {
  const trimmed = value.trim();
  if (!trimmed) return { value: null, error: null };
  const parsed = Number(trimmed.replace(',', '.'));
  if (!Number.isFinite(parsed)) {
    return { value: null, error: `${label}: укажите число от ${min} до ${max}% или 0.` };
  }
  if (parsed === 0) return { value: null, error: null };
  if (parsed < min || parsed > max) {
    return { value: null, error: `${label}: допустимый диапазон ${min}–${max}% или 0.` };
  }
  return { value: parsed, error: null };
}

/**
 * A sell (or a cash-to-cash swap) has no new trade group, so success must depend on
 * accounting being written, not on `tradeGroupId`.
 */
export function isSwapSettled(
  order: Pick<SwapOrderDetail, 'status' | 'accountingTransactionId'>,
): boolean {
  return order.status === 'CONFIRMED' && Boolean(order.accountingTransactionId);
}

export function isStepUpRequired(code: string | undefined): boolean {
  return code === 'SWAP_STEP_UP_REQUIRED';
}

export function isBuildRetryable(code: string | undefined): boolean {
  return isStepUpRequired(code) || code === 'SWAP_STATE_INVALID';
}

/**
 * If the transaction was already broadcast, the signed hash must be kept and submitted
 * again; otherwise the quote/build can be abandoned and the user can start over.
 */
export function phaseAfterExecutionFailure(hasBroadcastHash: boolean): 'submit_failed' | 'idle' {
  return hasBroadcastHash ? 'submit_failed' : 'idle';
}
