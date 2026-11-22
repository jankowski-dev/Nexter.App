# AI Holdout Top-50 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Test 50 diversified OOS survivors on the untouched 30-day holdout, split the holdout into 3×10-day blocks, and make the funnel transparent.

**Architecture:** Pure helpers in `ai-search.helpers.ts` select candidates round-robin by strategy and compute 10-day block returns from the holdout equity curve. `ai-search.service.ts` uses those helpers, stores additive block fields in the run artifact/candidate metrics, and keeps the holdout as a rejection gate. The web UI shows OOS/holdout counts, block consistency, and the min-trades threshold.

**Tech Stack:** TypeScript, NestJS, Drizzle (no migration), Zod contracts, React/Vite, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-22-ai-holdout-top50-design.md`

## Global Constraints

- Do not change min trades (8 total across 8 OOS folds), min positive folds (5/8), max drawdown (20%), worst fold (-15%), or holdout return > 0.
- The holdout is never used to rank or select candidates; it only rejects.
- Top 50 selection is deterministic and diversified by strategy.
- Holdout blocks are 10 days each; require at least 2/3 non-negative and the last block non-negative.
- No database migration; additive contract/JSON fields only.
- UI copy is Russian; identifiers and comments are English.
- Money remains Decimal strings; do not introduce JS floats into accounting.
- Tests, typecheck, lint, and build must pass before merge.

## Review Focus

- A strategy with fewer than 50 candidates must not be starved or duplicated; the round-robin filler must be deterministic.
- An empty or very short equity curve must not bypass the block gate; `holdoutBlockStats` returns null and the gate rejects with `holdout blocks unavailable`.
- Existing negative-return and drawdown rejections must keep their exact reason codes and priority.
- Legacy artifacts without block fields must parse and render as `—`, not crash.
- The last-block rule must reject a candidate that is positive overall but negative in the most recent 10 days.

---

### Task 1: Pure selection and block helpers

**Files:**

- Modify: `apps/api/src/modules/ai-trading/ai-search.helpers.ts`
- Test: `apps/api/src/modules/ai-trading/ai-search.helpers.spec.ts`

**Interfaces:**

- Consumes: existing `VariantMetrics`, `SearchVariant` shapes.
- Produces:
  - `selectHoldoutCandidates<T extends HoldoutCandidateLike>(candidates: T[], limit = 50): T[]`
  - `holdoutBlockStats(equityCurve: Array<{ equityUsd: string }>, blocks = 3): HoldoutBlockStats | null`
  - `HoldoutBlockStats { returnsPct: string[]; nonNegative: number; total: number; lastNegative: boolean }`
  - `holdoutRejection(returnPct, drawdownPct, maxDrawdownPct, blocks: HoldoutBlockStats | null)` with new reasons.

- [ ] **Step 1: Write failing tests for round-robin selection**

Add to `ai-search.helpers.spec.ts`:

```ts
import { holdoutBlockStats, selectHoldoutCandidates } from './ai-search.helpers';

function candidate(strategyKey: string, policyScore: number, id: string) {
  return {
    id,
    policyScore: policyScore.toFixed(4),
    oosMedianReturnPct: '1.00',
    variant: { strategyKey, params: { id } },
  };
}

it('selects 50 candidates round-robin by strategy and fills the remainder by score', () => {
  const keys = Array.from({ length: 12 }, (_, index) => `s${String(index).padStart(2, '0')}`);
  const candidates = keys.flatMap((key, strategyIndex) =>
    Array.from({ length: 5 }, (_, rank) =>
      candidate(key, 100 - strategyIndex - rank * 10, `${key}-${rank}`),
    ),
  );
  const selected = selectHoldoutCandidates(candidates, 50);
  expect(selected).toHaveLength(50);
  expect(new Set(selected.map((item) => item.id)).size).toBe(50);
  expect(selected.slice(0, 12).map((item) => item.variant.strategyKey)).toEqual(keys);
  expect(selected.slice(12, 24).map((item) => item.variant.strategyKey)).toEqual(keys);
  expect(selected.slice(-2).map((item) => item.id)).toEqual(['s00-4', 's01-4']);
  expect(selectHoldoutCandidates(candidates, 50)).toEqual(selected);
});

it('skips exhausted strategies and never duplicates candidates', () => {
  const candidates = [
    candidate('a', 10, 'a-0'),
    candidate('b', 9, 'b-0'),
    candidate('b', 8, 'b-1'),
    candidate('b', 7, 'b-2'),
  ];
  const selected = selectHoldoutCandidates(candidates, 5);
  expect(selected.map((item) => item.id)).toEqual(['a-0', 'b-0', 'b-1', 'b-2']);
});
```

- [ ] **Step 2: Run the selection tests and verify they fail**

Run: `npx pnpm@10.20.0 --filter @nexter/api exec vitest run src/modules/ai-trading/ai-search.helpers.spec.ts`

Expected: FAIL because `selectHoldoutCandidates` is not exported.

- [ ] **Step 3: Implement selection**

In `ai-search.helpers.ts` add:

```ts
export interface HoldoutCandidateLike {
  policyScore: string;
  oosMedianReturnPct: string;
  variant: { strategyKey: string; params: Record<string, unknown> };
}

function compareHoldoutCandidates<T extends HoldoutCandidateLike>(left: T, right: T): number {
  return (
    Number(right.policyScore) - Number(left.policyScore) ||
    Number(right.oosMedianReturnPct) - Number(left.oosMedianReturnPct) ||
    left.variant.strategyKey.localeCompare(right.variant.strategyKey) ||
    JSON.stringify(left.variant.params).localeCompare(JSON.stringify(right.variant.params))
  );
}

export function selectHoldoutCandidates<T extends HoldoutCandidateLike>(
  candidates: T[],
  limit = 50,
): T[] {
  if (limit <= 0) return [];
  const groups = new Map<string, T[]>();
  for (const candidate of candidates) {
    const list = groups.get(candidate.variant.strategyKey) ?? [];
    list.push(candidate);
    groups.set(candidate.variant.strategyKey, list);
  }
  const order = [...groups.keys()].sort(
    (left, right) =>
      compareHoldoutCandidates(groups.get(left)?.[0] as T, groups.get(right)?.[0] as T) ||
      left.localeCompare(right),
  );
  for (const list of groups.values()) list.sort(compareHoldoutCandidates);
  const selected: T[] = [];
  const chosen = new Set<T>();
  for (let rank = 0; selected.length < limit; rank += 1) {
    let added = 0;
    for (const key of order) {
      const candidate = groups.get(key)?.[rank];
      if (!candidate) continue;
      selected.push(candidate);
      chosen.add(candidate);
      added += 1;
      if (selected.length >= limit) break;
    }
    if (added === 0) break;
  }
  if (selected.length < limit) {
    for (const candidate of [...candidates].sort(compareHoldoutCandidates)) {
      if (chosen.has(candidate)) continue;
      selected.push(candidate);
      if (selected.length >= limit) break;
    }
  }
  return selected;
}
```

- [ ] **Step 4: Run the selection tests and verify they pass**

Run the same command. Expected: PASS.

- [ ] **Step 5: Write failing block-stat tests**

Add to `ai-search.helpers.spec.ts`:

```ts
it('splits the holdout equity curve into three 10-day block returns', () => {
  const curve = [100, 110, 120, 100, 90, 80, 90, 100, 110].map((equity) => ({
    equityUsd: String(equity),
  }));
  const stats = holdoutBlockStats(curve, 3);
  expect(stats).not.toBeNull();
  expect(stats?.returnsPct).toEqual(['20.00', '-33.33', '37.50']);
  expect(stats?.nonNegative).toBe(2);
  expect(stats?.total).toBe(3);
  expect(stats?.lastNegative).toBe(false);
});

it('flags a negative last block and an unusable curve', () => {
  const lastNegative = holdoutBlockStats(
    [100, 110, 120, 130, 140, 150, 100, 90, 80].map((equity) => ({
      equityUsd: String(equity),
    })),
    3,
  );
  expect(lastNegative?.nonNegative).toBe(2);
  expect(lastNegative?.lastNegative).toBe(true);
  expect(holdoutBlockStats([{ equityUsd: '100' }, { equityUsd: '110' }], 3)).toBeNull();
});
```

- [ ] **Step 6: Run the block tests and verify they fail**

Run the same command. Expected: FAIL because `holdoutBlockStats` is not exported.

- [ ] **Step 7: Implement `holdoutBlockStats`**

```ts
export interface HoldoutBlockStats {
  returnsPct: string[];
  nonNegative: number;
  total: number;
  lastNegative: boolean;
}

export function holdoutBlockStats(
  equityCurve: Array<{ equityUsd: string }>,
  blocks = 3,
): HoldoutBlockStats | null {
  if (blocks <= 0 || equityCurve.length < blocks) return null;
  const size = Math.floor(equityCurve.length / blocks);
  if (size <= 0) return null;
  let previous = Number(equityCurve[0]?.equityUsd ?? 0);
  if (!Number.isFinite(previous) || previous <= 0) return null;
  const returnsPct: string[] = [];
  for (let index = 0; index < blocks; index += 1) {
    const endIndex = index === blocks - 1 ? equityCurve.length - 1 : (index + 1) * size - 1;
    const end = Number(equityCurve[endIndex]?.equityUsd ?? previous);
    if (!Number.isFinite(end)) return null;
    returnsPct.push(((end / previous - 1) * 100).toFixed(2));
    previous = end;
  }
  const numeric = returnsPct.map(Number);
  return {
    returnsPct,
    nonNegative: numeric.filter((value) => value >= 0).length,
    total: numeric.length,
    lastNegative: (numeric.at(-1) ?? 0) < 0,
  };
}
```

- [ ] **Step 8: Run the block tests and verify they pass**

Run the same command. Expected: PASS.

- [ ] **Step 9: Update the gate tests and implementation**

Update the existing `holdoutRejection` tests to pass a block fixture:

```ts
const passingBlocks = {
  returnsPct: ['1.00', '2.00', '3.00'],
  nonNegative: 3,
  total: 3,
  lastNegative: false,
};

it('accepts a positive holdout below the drawdown limit', () => {
  expect(holdoutRejection(5, 10, 20, passingBlocks)).toBeNull();
});
```

Add:

```ts
it('rejects an unstable block set, a negative last block, and missing blocks', () => {
  expect(holdoutRejection(5, 10, 20, { ...passingBlocks, nonNegative: 1 })).toBe(
    'holdout blocks unstable',
  );
  expect(
    holdoutRejection(5, 10, 20, { ...passingBlocks, nonNegative: 2, lastNegative: true }),
  ).toBe('holdout recent block negative');
  expect(holdoutRejection(5, 10, 20, null)).toBe('holdout blocks unavailable');
});
```

Extend the type and function:

```ts
export type HoldoutRejection =
  | 'negative holdout'
  | 'holdout drawdown too high'
  | 'holdout blocks unstable'
  | 'holdout recent block negative'
  | 'holdout blocks unavailable'
  | null;

export function holdoutRejection(
  returnPct: number,
  drawdownPct: number,
  maxDrawdownPct: number,
  blocks: HoldoutBlockStats | null,
): HoldoutRejection {
  if (!Number.isFinite(returnPct) || returnPct <= 0) return 'negative holdout';
  if (Number.isFinite(drawdownPct) && drawdownPct > maxDrawdownPct) {
    return 'holdout drawdown too high';
  }
  if (!blocks || blocks.total < 3) return 'holdout blocks unavailable';
  if (blocks.nonNegative < 2) return 'holdout blocks unstable';
  if (blocks.lastNegative) return 'holdout recent block negative';
  return null;
}
```

- [ ] **Step 10: Run the full helper suite**

Run: `npx pnpm@10.20.0 --filter @nexter/api exec vitest run src/modules/ai-trading/ai-search.helpers.spec.ts`

Expected: all tests PASS.

- [ ] **Step 11: Commit**

```bash
git add apps/api/src/modules/ai-trading/ai-search.helpers.ts apps/api/src/modules/ai-trading/ai-search.helpers.spec.ts
git commit -m "feat(ai): add diversified holdout selection and block gate helpers"
```

---

### Task 2: Contract fields, service integration, and e2e invariant

**Files:**

- Modify: `packages/contracts/src/ai-trading.ts`
- Modify: `apps/api/src/modules/ai-trading/ai-search.service.ts`
- Modify: `apps/api/src/modules/ai-trading/ai-cycle.service.ts`
- Test: `apps/web/src/features/ai-trading/ai-cycle.test.ts`
- Test: `apps/api/test/ai-trading.e2e.spec.ts`

**Interfaces:**

- Consumes: `selectHoldoutCandidates`, `holdoutBlockStats`, `holdoutRejection` from Task 1.
- Produces:
  - `AiSearchNearMiss`/`AiSearchCandidate` gain `holdoutBlockReturnsPct: string[]`, `holdoutBlocksNonNegative: number`, `holdoutBlocksTotal: number`.
  - `AiCycleStatus`/`AiCycleSummary` gain optional `oosPassed` and `holdoutTested`.

- [ ] **Step 1: Add a failing contract test**

In `apps/web/src/features/ai-trading/ai-cycle.test.ts`, add:

```ts
it('parses holdout block fields and legacy rows without them', () => {
  const nearMiss = aiSearchNearMissSchema.parse({
    strategyKey: 'trend_pullback',
    strategyName: 'Откат в тренде',
    params: {},
    oosMedianReturnPct: '1.00',
    oosMeanReturnPct: '0.50',
    oosWorstReturnPct: '-3.00',
    maxDrawdownPct: '4.00',
    trades: 12,
    positiveFolds: 5,
    stabilityPct: '62.50',
    holdoutReturnPct: '-2.00',
    holdoutDrawdownPct: '5.00',
    policyScore: '1.00',
    reasons: ['holdout recent block negative'],
    holdoutBlockReturnsPct: ['1.00', '-2.00', '-1.00'],
    holdoutBlocksNonNegative: 1,
    holdoutBlocksTotal: 3,
  });
  expect(nearMiss.holdoutBlocksNonNegative).toBe(1);
  const legacyInput: Record<string, unknown> = { ...nearMiss };
  delete legacyInput.holdoutBlockReturnsPct;
  delete legacyInput.holdoutBlocksNonNegative;
  delete legacyInput.holdoutBlocksTotal;
  const legacy = aiSearchNearMissSchema.parse(legacyInput);
  expect(legacy.holdoutBlockReturnsPct).toEqual([]);
  expect(legacy.holdoutBlocksTotal).toBe(0);
});
```

Import `aiSearchNearMissSchema` in the test.

- [ ] **Step 2: Run the contract test and verify it fails**

Run: `npx pnpm@10.20.0 --filter @nexter/web test -- ai-cycle.test.ts`

Expected: FAIL because the schema strips/does not define the fields.

- [ ] **Step 3: Add contract fields**

In `packages/contracts/src/ai-trading.ts`:

- `aiSearchNearMissSchema`: add
  ```ts
  holdoutBlockReturnsPct: z.array(z.string()).default([]),
  holdoutBlocksNonNegative: z.number().int().default(0),
  holdoutBlocksTotal: z.number().int().default(0),
  ```
- `aiSearchCandidateSchema`: add the same three fields.
- `aiCycleStatusSchema` and `aiCycleSummarySchema`: add

  ```ts
  oosPassed: z.number().int().default(0),
  holdoutTested: z.number().int().default(0),
  ```

  with `.default(0)` so legacy cycles parse.

- [ ] **Step 4: Run the contract test and verify it passes**

Run the same web test. Expected: PASS.

- [ ] **Step 5: Integrate helpers into the service**

In `ai-search.service.ts`:

- Import `holdoutBlockStats`, `selectHoldoutCandidates`, and `HoldoutBlockStats`.
- Extend `SearchCandidate`:
  ```ts
  holdoutBlockReturnsPct: string[];
  holdoutBlocksNonNegative: number;
  holdoutBlocksTotal: number;
  ```
- Initialize these fields when pushing to `metrics`:
  ```ts
  metrics.push({
    ...aggregate,
    variant,
    holdoutReturnPct: null,
    holdoutBlockReturnsPct: [],
    holdoutBlocksNonNegative: 0,
    holdoutBlocksTotal: 0,
  });
  ```
- Replace `const top = metrics.slice(0, 10);` with:
  ```ts
  const top = selectHoldoutCandidates(metrics, 50);
  ```
- In the holdout loop, after `runBacktest`:
  ```ts
  const blocks = holdoutBlockStats(result.equityCurve);
  candidate.holdoutBlockReturnsPct = blocks?.returnsPct ?? [];
  candidate.holdoutBlocksNonNegative = blocks?.nonNegative ?? 0;
  candidate.holdoutBlocksTotal = blocks?.total ?? 0;
  const rejection = holdoutRejection(returnPct, drawdown, FULL_MAX_DRAWDOWN_PCT, blocks);
  ```
- In `rememberNearMiss`, add optional parameters:
  ```ts
  holdoutBlockReturnsPct: string[] = [],
  holdoutBlocksNonNegative = 0,
  holdoutBlocksTotal = 0,
  ```
  and include them in the pushed object.
- Pass `blocks?.returnsPct ?? []`, `blocks?.nonNegative ?? 0`, `blocks?.total ?? 0` from both holdout rejection branches.
- In the `catch` branch set the candidate block fields to empty/0 and call `rememberNearMiss` with the defaults.
- Sort recommendations before insert:
  ```ts
  recommended.sort(
    (left, right) =>
      right.holdoutBlocksNonNegative - left.holdoutBlocksNonNegative ||
      Number(right.policyScore) - Number(left.policyScore),
  );
  ```
- Include block fields in the inserted `metrics` JSON.
- Extend `holdoutFailed` with `holdout blocks unstable`, `holdout recent block negative`, and `holdout blocks unavailable`.
- Raise `nearMissesTop` from `.slice(0, 10)` to `.slice(0, 50)`.
- Raise the results candidate query from `.limit(20)` to `.limit(50)`.
- In `toCandidate`, map the three block fields from `metrics` with legacy defaults:
  ```ts
  holdoutBlockReturnsPct: Array.isArray(metrics.holdoutBlockReturnsPct)
    ? (metrics.holdoutBlockReturnsPct as unknown[]).filter(
        (value): value is string => typeof value === 'string',
      )
    : [],
  holdoutBlocksNonNegative:
    typeof metrics.holdoutBlocksNonNegative === 'number'
      ? metrics.holdoutBlocksNonNegative
      : 0,
  holdoutBlocksTotal:
    typeof metrics.holdoutBlocksTotal === 'number' ? metrics.holdoutBlocksTotal : 0,
  ```
- In `listRecommendations` (the candidate mapping around the `invalidationRules` block), map the same three fields from the candidate `metrics` JSON with the same defaults.

- [ ] **Step 6: Populate cycle counts**

In `ai-cycle.service.ts`:

- Add `oosPassed: number; holdoutTested: number;` to `CycleSummary`.
- Initialize them to `0` in the cycle summary.
- In `runRecommendationsStep`, set:
  ```ts
  summary.oosPassed = results.stats?.oosPassed ?? 0;
  summary.holdoutTested = results.stats?.holdoutTested ?? 0;
  ```
- Include both fields in the status/summary responses and normalizers.

- [ ] **Step 7: Add the e2e invariant**

In `apps/api/test/ai-trading.e2e.spec.ts`, after the stats assertions:

```ts
expect(searchResults.body.stats.holdoutTested).toBe(
  Math.min(50, searchResults.body.stats.oosPassed),
);
expect(searchResults.body.stats.oosPassed).toBeGreaterThanOrEqual(
  searchResults.body.stats.holdoutTested,
);
```

- [ ] **Step 8: Run API typecheck and targeted tests**

Run:

```bash
npx pnpm@10.20.0 --filter @nexter/api typecheck
npx pnpm@10.20.0 --filter @nexter/api exec vitest run src/modules/ai-trading
```

Expected: PASS. If the e2e fixture is not run locally, rely on CI for `apps/api/test/ai-trading.e2e.spec.ts`.

- [ ] **Step 9: Commit**

```bash
git add packages/contracts/src/ai-trading.ts apps/api/src/modules/ai-trading/ai-search.service.ts apps/api/src/modules/ai-trading/ai-cycle.service.ts apps/web/src/features/ai-trading/ai-cycle.test.ts apps/api/test/ai-trading.e2e.spec.ts
git commit -m "feat(ai): test 50 diversified holdout candidates with block consistency"
```

---

### Task 3: UI transparency and block badges

**Files:**

- Create: `apps/web/src/features/ai-trading/ai-holdout-format.ts`
- Create: `apps/web/src/features/ai-trading/ai-holdout-format.test.ts`
- Modify: `apps/web/src/features/ai-trading/ai-trading-page.tsx`

**Interfaces:**

- Consumes: new contract fields and cycle counts from Task 2.
- Produces:
  - `holdoutConsistencyLabel(nonNegative: number, total: number): string`
  - `holdoutBlockSummary(returnsPct: string[]): string`

- [ ] **Step 1: Write failing format tests**

Create `ai-holdout-format.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { holdoutBlockSummary, holdoutConsistencyLabel } from './ai-holdout-format';

describe('holdout formatting', () => {
  it('formats block consistency and returns', () => {
    expect(holdoutConsistencyLabel(3, 3)).toBe('3/3');
    expect(holdoutConsistencyLabel(2, 3)).toBe('2/3');
    expect(holdoutConsistencyLabel(0, 0)).toBe('—');
    expect(holdoutBlockSummary(['1.20', '-0.50', '0.00'])).toBe('+1.20% / -0.50% / 0.00%');
    expect(holdoutBlockSummary([])).toBe('—');
  });
});
```

- [ ] **Step 2: Run the format test and verify it fails**

Run: `npx pnpm@10.20.0 --filter @nexter/web test -- ai-holdout-format.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the formatter**

Create `ai-holdout-format.ts`:

```ts
export function holdoutConsistencyLabel(nonNegative: number, total: number): string {
  if (total <= 0) return '—';
  return `${nonNegative}/${total}`;
}

export function holdoutBlockSummary(returnsPct: string[]): string {
  if (returnsPct.length === 0) return '—';
  return returnsPct.map((value) => `${Number(value) > 0 ? '+' : ''}${value}%`).join(' / ');
}
```

- [ ] **Step 4: Run the format test and verify it passes**

Run the same command. Expected: PASS.

- [ ] **Step 5: Wire the cycle card**

In `AiCycleCard` (`ai-trading-page.tsx`):

- Add rejection labels:
  ```ts
  'holdout blocks unstable': 'holdout нестабилен по 10-дневным блокам',
  'holdout recent block negative': 'последний 10-дневный блок отрицательный',
  'holdout blocks unavailable': 'блоки holdout недоступны',
  ```
- Under the cycle step grid, show the counts only when the API supplied them
  (legacy cycles have zeros):
  ```tsx
  {
    cycle.oosPassed > 0 ? (
      <div className="mt-2 text-[11px] text-zinc-500">
        Прошли OOS: {cycle.oosPassed} · допущено к holdout: {cycle.holdoutTested} · не
        тестировались: {Math.max(0, cycle.oosPassed - cycle.holdoutTested)}
      </div>
    ) : null;
  }
  ```
- In the near-miss lines, append:

  ```tsx
  {
    item.holdoutBlocksTotal > 0
      ? ` · блоки ${holdoutBlockSummary(item.holdoutBlockReturnsPct)} (${holdoutConsistencyLabel(item.holdoutBlocksNonNegative, item.holdoutBlocksTotal)})`
      : '';
  }
  ```

- [ ] **Step 6: Wire the results page**

In the results near-miss cards and candidate cards:

- Show the same block summary and consistency label.
- Add a hint near the funnel:
  ```tsx
  <span className="text-[11px] text-zinc-500">
    «Мало сделок» — меньше 8 сделок за 8 OOS-фолдов (≈80 дней). Это диагностика, не рекомендация.
  </span>
  ```
- Candidate badge:

  ```tsx
  <Badge tone={item.holdoutBlocksNonNegative === item.holdoutBlocksTotal ? 'success' : 'warning'}>
    holdout {holdoutConsistencyLabel(item.holdoutBlocksNonNegative, item.holdoutBlocksTotal)}
  </Badge>
  ```

- [ ] **Step 7: Run web tests, typecheck, and build**

Run:

```bash
npx pnpm@10.20.0 --filter @nexter/web test
npx pnpm@10.20.0 --filter @nexter/web typecheck
npx pnpm@10.20.0 --filter @nexter/web build
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/features/ai-trading/ai-holdout-format.ts apps/web/src/features/ai-trading/ai-holdout-format.test.ts apps/web/src/features/ai-trading/ai-trading-page.tsx
git commit -m "feat(ai): show holdout batch counts and 10-day consistency"
```

---

### Task 4: ADR, release notes, and guide v1.2

**Files:**

- Create: `docs/adr/0081-ai-holdout-top50-and-blocks.md`
- Modify: `docs/decisions.md`
- Modify: `AGENTS.md`
- Modify: `docs/guides/ai-system-engineering-guide.md`
- Regenerate: `docs/guides/nexter-ai-system-engineering.pdf`
- Copy: `apps/web/public/docs/nexter-ai-system-engineering.pdf`
- Modify: `apps/web/src/features/settings/settings-page.tsx` (`?v=3`)

**Interfaces:**

- Consumes: the approved spec and implemented behavior.
- Produces: documentation consistent with the new gate.

- [ ] **Step 1: Write ADR 0081**

Cover:

- context: 200k IRYS run, 1,342 OOS passers, top-10 all failed the pump-and-crash holdout;
- decision: 50 diversified candidates, 3×10-day blocks, 2/3 non-negative + last block non-negative;
- why not all 1,342: holdout fitting/multiple testing;
- why not 5-day holdout: warmup, trade count, noise;
- consequences: more recommendations, stricter consistency, block fields in artifacts;
- rollback: revert; no migration.

- [ ] **Step 2: Update `docs/decisions.md`**

Add one bullet dated 2026-11-22 with the behavior, exact gate, and no-migration note.

- [ ] **Step 3: Update the guide**

In `docs/guides/ai-system-engineering-guide.md`:

- Section 9 figure/text: change holdout count from 10 to 50.
- Section 12: replace the “Top-10” paragraph with the diversified top-50, 3×10-day block gate, last-block rule, and the multiple-testing caveat.
- Section 21 ADR index: include 0081.
- Bump the guide version to 1.2.

- [ ] **Step 4: Rebuild and verify the PDF**

Run:

```bash
node scripts/docs/build-ai-engineering-guide.mjs
cp docs/guides/nexter-ai-system-engineering.pdf apps/web/public/docs/nexter-ai-system-engineering.pdf
pdftotext -enc UTF-8 docs/guides/nexter-ai-system-engineering.pdf - | grep -m1 "Версия 1.2"
```

Expected: PDF generated, version 1.2 present.

- [ ] **Step 5: Bump the settings link**

Change the settings href to `/docs/nexter-ai-system-engineering.pdf?v=3`.

- [ ] **Step 6: Commit**

```bash
git add docs/adr/0081-ai-holdout-top50-and-blocks.md docs/decisions.md AGENTS.md docs/guides/ai-system-engineering-guide.md docs/guides/ai-system-engineering-guide.html docs/guides/nexter-ai-system-engineering.pdf apps/web/public/docs/nexter-ai-system-engineering.pdf apps/web/src/features/settings/settings-page.tsx
git commit -m "docs: document AI holdout top-50 and block consistency"
```

---

### Task 5: Full verification and PR

- [ ] **Step 1: Run the full local checks**

```bash
npx pnpm@10.20.0 typecheck
npx pnpm@10.20.0 --filter @nexter/api exec vitest run src/modules/ai-trading
npx pnpm@10.20.0 --filter @nexter/web test
npx pnpm@10.20.0 lint
npx pnpm@10.20.0 build
```

Expected: no TypeScript errors, all tests pass, lint clean, build succeeds.

- [ ] **Step 2: Review the diff for scope**

Confirm:

- no threshold values changed;
- no migration;
- no holdout-based ranking;
- legacy cycle/artifact parsing still works.

- [ ] **Step 3: Push and open the PR**

Use a PR body with:

- the IRYS 200k run evidence;
- top-50 round-robin rationale;
- 3×10-day block gate and last-block rule;
- multiple-testing caveat;
- test/verification results;
- rollback (revert; no migration).

- [ ] **Step 4: Merge after CI and verify production**

After merge:

- deployment success;
- `/health` and `/ready` 200;
- bundle contains the new UI labels;
- a cycle/search artifact shows `holdoutTested <= 50`, `oosPassed`, and block fields;
- guide v1.2 at `?v=3`.

- [ ] **Step 5: Update `AGENTS.md` release note with deployment ID and bundle**

Commit as a separate docs-only PR.
