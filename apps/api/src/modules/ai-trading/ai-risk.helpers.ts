import { Decimal, decimal } from '../../shared/money/decimal';

export interface DraftCapacity {
  slots: number;
  budgetUsd: string;
  maxInvestedUsd: string;
  usedBudgetUsd: string;
  freeBudgetUsd: string;
  perBotBudgetUsd: string;
  tokenCapUsd: string;
  exposureByAsset: Record<string, string>;
}

export interface DraftCandidate {
  id: string;
  assetId: string;
  strategyKey: string;
}

export interface DraftSelection {
  selected: DraftCandidate[];
  skipped: Record<string, number>;
}

export function selectDraftCandidates(
  candidates: DraftCandidate[],
  capacity: DraftCapacity,
  maxDrafts: number,
): DraftSelection {
  const perBot = decimal(capacity.perBotBudgetUsd);
  const maxInvested = decimal(capacity.maxInvestedUsd);
  const tokenCap = decimal(capacity.tokenCapUsd);
  const used = decimal(capacity.usedBudgetUsd);
  const free = decimal(capacity.freeBudgetUsd);
  const exposure = new Map(
    Object.entries(capacity.exposureByAsset).map(([assetId, value]) => [assetId, decimal(value)]),
  );
  const selected: DraftCandidate[] = [];
  const skipped: Record<string, number> = {};
  const strategies = new Set<string>();
  let slots = capacity.slots;
  let allocated = used;
  let remainingFree = free;

  const skip = (reason: string) => {
    skipped[reason] = (skipped[reason] ?? 0) + 1;
  };

  for (const candidate of candidates) {
    if (selected.length >= maxDrafts) break;
    if (strategies.has(candidate.strategyKey)) {
      skip('duplicate strategy');
      continue;
    }
    if (slots <= 0) {
      skip('no worker slots');
      continue;
    }
    if (perBot.lt(100)) {
      skip('budget too small');
      continue;
    }
    if (allocated.plus(perBot).gt(maxInvested)) {
      skip('max invested limit');
      continue;
    }
    if (remainingFree.lt(perBot)) {
      skip('no free budget');
      continue;
    }
    const currentExposure = exposure.get(candidate.assetId) ?? new Decimal(0);
    if (currentExposure.plus(perBot).gt(tokenCap)) {
      skip('token exposure limit');
      continue;
    }
    selected.push(candidate);
    strategies.add(candidate.strategyKey);
    slots -= 1;
    allocated = allocated.plus(perBot);
    remainingFree = remainingFree.minus(perBot);
    exposure.set(candidate.assetId, currentExposure.plus(perBot));
  }

  return { selected, skipped };
}
