import { describe, expect, it } from 'vitest';
import {
  isRecommendationExpired,
  recommendationExpiresAt,
  recommendationTtlDays,
} from './ai-recommendation';

describe('AI recommendation TTL', () => {
  it('uses the candidate horizon and defaults to 7 days', () => {
    expect(recommendationTtlDays({ horizonDays: 5 })).toBe(5);
    expect(recommendationTtlDays({})).toBe(7);
    expect(recommendationTtlDays({ horizonDays: -1 })).toBe(7);
  });

  it('expires after the horizon from creation', () => {
    const createdAt = new Date('2026-11-20T00:00:00.000Z');
    const metrics = { horizonDays: 3 };
    expect(recommendationExpiresAt(createdAt, metrics).toISOString()).toBe(
      '2026-11-23T00:00:00.000Z',
    );
    expect(isRecommendationExpired(createdAt, metrics, new Date('2026-11-22T23:59:59.000Z'))).toBe(
      false,
    );
    expect(isRecommendationExpired(createdAt, metrics, new Date('2026-11-23T00:00:01.000Z'))).toBe(
      true,
    );
  });
});
