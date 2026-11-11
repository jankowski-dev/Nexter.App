import { describe, expect, it } from 'vitest';
import {
  isBuildRetryable,
  isStepUpRequired,
  isSwapSettled,
  phaseAfterExecutionFailure,
} from './swap-execution';

describe('swap execution flow', () => {
  it('treats a confirmed sell with accounting as settled even without a trade group', () => {
    expect(
      isSwapSettled({
        status: 'CONFIRMED',
        accountingTransactionId: '11111111-1111-4111-8111-111111111111',
      }),
    ).toBe(true);
  });

  it('does not settle before accounting exists', () => {
    expect(isSwapSettled({ status: 'CONFIRMED', accountingTransactionId: null })).toBe(false);
    expect(
      isSwapSettled({
        status: 'SUBMITTED',
        accountingTransactionId: '11111111-1111-4111-8111-111111111111',
      }),
    ).toBe(false);
  });

  it('retries build after step-up or an expired quote', () => {
    expect(isBuildRetryable('SWAP_STEP_UP_REQUIRED')).toBe(true);
    expect(isBuildRetryable('SWAP_STATE_INVALID')).toBe(true);
    expect(isBuildRetryable('SWAP_VALIDATION_FAILED')).toBe(false);
    expect(isStepUpRequired('SWAP_STEP_UP_REQUIRED')).toBe(true);
    expect(isStepUpRequired('SWAP_STATE_INVALID')).toBe(false);
  });

  it('keeps a broadcast hash for retry instead of starting a new quote', () => {
    expect(phaseAfterExecutionFailure(true)).toBe('submit_failed');
    expect(phaseAfterExecutionFailure(false)).toBe('idle');
  });
});
