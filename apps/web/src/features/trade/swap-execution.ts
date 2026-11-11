import type { SwapOrderDetail } from '@nexter/contracts';

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
