import { describe, expect, it } from 'vitest';
import { selectDraftCandidates, type DraftCapacity } from './ai-risk.helpers';

function capacity(overrides: Partial<DraftCapacity> = {}): DraftCapacity {
  return {
    slots: 8,
    budgetUsd: '25000.00',
    maxInvestedUsd: '20000.00',
    usedBudgetUsd: '0.00',
    freeBudgetUsd: '20000.00',
    perBotBudgetUsd: '5000.00',
    tokenCapUsd: '5000.00',
    exposureByAsset: {},
    ...overrides,
  };
}

const candidates = [
  { id: '1', assetId: 'xrp', strategyKey: 'momentum_breakout' },
  { id: '2', assetId: 'xrp', strategyKey: 'momentum_breakout' },
  { id: '3', assetId: 'xrp', strategyKey: 'grid_range' },
  { id: '4', assetId: 'xrp', strategyKey: 'mean_reversion' },
  { id: '5', assetId: 'xrp', strategyKey: 'dca_dip' },
];

describe('selectDraftCandidates', () => {
  it('selects distinct strategies up to maxDrafts and respects token exposure', () => {
    const result = selectDraftCandidates(candidates, capacity(), 3);
    expect(result.selected.map((item) => item.strategyKey)).toEqual(['momentum_breakout']);
    expect(result.skipped['duplicate strategy']).toBe(1);
    expect(result.skipped['token exposure limit']).toBe(3);
  });

  it('returns no drafts when token exposure is already at the cap', () => {
    const result = selectDraftCandidates(
      candidates,
      capacity({ exposureByAsset: { xrp: '5000.00' } }),
      3,
    );
    expect(result.selected).toHaveLength(0);
    expect(result.skipped['token exposure limit']).toBe(5);
  });

  it('returns no drafts without worker slots or free budget', () => {
    expect(selectDraftCandidates(candidates, capacity({ slots: 0 }), 3).selected).toHaveLength(0);
    expect(
      selectDraftCandidates(candidates, capacity({ freeBudgetUsd: '100.00' }), 3).selected,
    ).toHaveLength(0);
  });
});
