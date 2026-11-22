/**
 * Comparison helpers for the native search engine. A comparison whose operands
 * are closer than the relative epsilon is flagged as ambiguous; the caller then
 * re-runs the variant on the Decimal engine. This keeps native rounding from
 * flipping an entry, exit or stop at an exact boundary.
 */
export interface FastComparisons {
  readonly ambiguous: boolean;
  lt(left: number, right: number): boolean;
  lte(left: number, right: number): boolean;
  gt(left: number, right: number): boolean;
  gte(left: number, right: number): boolean;
}

const RELATIVE_EPSILON = 1e-11;

export function createComparisons(): FastComparisons {
  let ambiguous = false;
  const near = (left: number, right: number) => {
    if (ambiguous) return;
    const scale = Math.max(1, Math.abs(left), Math.abs(right));
    if (Math.abs(left - right) <= RELATIVE_EPSILON * scale) {
      ambiguous = true;
    }
  };
  return {
    get ambiguous() {
      return ambiguous;
    },
    lt(left, right) {
      near(left, right);
      return left < right;
    },
    lte(left, right) {
      near(left, right);
      return left <= right;
    },
    gt(left, right) {
      near(left, right);
      return left > right;
    },
    gte(left, right) {
      near(left, right);
      return left >= right;
    },
  };
}
