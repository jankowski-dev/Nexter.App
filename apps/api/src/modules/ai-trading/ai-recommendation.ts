const DAY_MS = 86_400_000;
const DEFAULT_TTL_DAYS = 7;

export function recommendationTtlDays(metrics: Record<string, unknown>): number {
  const horizon = metrics.horizonDays;
  return typeof horizon === 'number' && Number.isFinite(horizon) && horizon > 0
    ? Math.floor(horizon)
    : DEFAULT_TTL_DAYS;
}

export function recommendationExpiresAt(createdAt: Date, metrics: Record<string, unknown>): Date {
  return new Date(createdAt.getTime() + recommendationTtlDays(metrics) * DAY_MS);
}

export function isRecommendationExpired(
  createdAt: Date,
  metrics: Record<string, unknown>,
  now = new Date(),
): boolean {
  return now.getTime() > recommendationExpiresAt(createdAt, metrics).getTime();
}
