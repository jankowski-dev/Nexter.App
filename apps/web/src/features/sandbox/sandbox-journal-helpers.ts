import type {
  SandboxEvent,
  SandboxIntent,
  SandboxIntentStatus,
  SandboxTrade,
} from '@nexter/contracts';

export interface SandboxPageState {
  limit: number;
  offset: number;
  total: number;
  from: number;
  to: number;
  canPrev: boolean;
  canNext: boolean;
}

/**
 * Offset pagination state for the journal pages. `from`/`to` are the 1-based
 * positions of the loaded rows so the owner sees `1–50 из 120`.
 */
export function sandboxPageState(total: number, limit: number, offset: number): SandboxPageState {
  const safeTotal = Math.max(0, total);
  const from = safeTotal === 0 ? 0 : Math.min(offset + 1, safeTotal);
  const to = Math.min(offset + limit, safeTotal);
  return {
    limit,
    offset,
    total: safeTotal,
    from,
    to,
    canPrev: offset > 0,
    canNext: offset + limit < safeTotal,
  };
}

export interface SandboxEventFilters {
  tokenId: string | null;
  module: SandboxEvent['module'] | 'all';
  severity: SandboxEvent['severity'] | 'all';
  eventType: string;
}

export const defaultSandboxEventFilters: SandboxEventFilters = {
  tokenId: null,
  module: 'all',
  severity: 'all',
  eventType: '',
};

/**
 * Client-side event filters over the loaded page. The journal paginates by
 * `afterSeq`, so filters intentionally apply only to what has been loaded; the
 * component states that explicitly to avoid implying a server-side query.
 */
export function filterSandboxEvents(
  events: readonly SandboxEvent[],
  filters: SandboxEventFilters,
): SandboxEvent[] {
  const term = filters.eventType.trim().toLowerCase();
  return events.filter((event) => {
    if (filters.tokenId !== null && event.tokenId !== filters.tokenId) return false;
    if (filters.module !== 'all' && event.module !== filters.module) return false;
    if (filters.severity !== 'all' && event.severity !== filters.severity) return false;
    if (term.length > 0 && !event.eventType.toLowerCase().includes(term)) return false;
    return true;
  });
}

/**
 * Appends a fetched event page, de-duplicating by `seq` and keeping ascending
 * order. A live refetch may overlap the previous page, so dedupe is required.
 */
export function appendSandboxEvents(
  existing: readonly SandboxEvent[],
  next: readonly SandboxEvent[],
): SandboxEvent[] {
  const bySeq = new Map<number, SandboxEvent>();
  for (const event of existing) bySeq.set(event.seq, event);
  for (const event of next) bySeq.set(event.seq, event);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

/** Flattens infinite event pages with the same seq dedupe guarantee. */
export function flattenSandboxEventPages(
  pages: ReadonlyArray<readonly SandboxEvent[]>,
): SandboxEvent[] {
  return pages.reduce<SandboxEvent[]>((acc, page) => appendSandboxEvents(acc, page), []);
}

/** Events that carry at least one risk check (the `Проверки риска` block). */
export function sandboxRiskEvents(events: readonly SandboxEvent[]): SandboxEvent[] {
  return events.filter((event) => event.riskChecks.length > 0);
}

/** The "почему не" evidence of a decision event. */
export function sandboxEventWhyNot(event: SandboxEvent): string[] {
  return event.alternatives.map((alternative) => alternative.whyNot);
}

export interface SandboxIntentFilters {
  status: SandboxIntentStatus | 'all';
  side: SandboxIntent['side'] | 'all';
  tokenId: string | null;
}

export const defaultSandboxIntentFilters: SandboxIntentFilters = {
  status: 'all',
  side: 'all',
  tokenId: null,
};

export function filterSandboxIntents(
  intents: readonly SandboxIntent[],
  filters: SandboxIntentFilters,
): SandboxIntent[] {
  return intents.filter((intent) => {
    if (filters.status !== 'all' && intent.status !== filters.status) return false;
    if (filters.side !== 'all' && intent.side !== filters.side) return false;
    if (filters.tokenId !== null && intent.tokenId !== filters.tokenId) return false;
    return true;
  });
}

export type SandboxTradeFilter = SandboxTrade['status'] | 'all';

export function filterSandboxTrades(
  trades: readonly SandboxTrade[],
  status: SandboxTradeFilter,
): SandboxTrade[] {
  if (status === 'all') return [...trades];
  return trades.filter((trade) => trade.status === status);
}

/** Normalizes a limit that the API exposed to the UI (bounded 1–500). */
export function clampSandboxPageLimit(limit: number, fallback = 50): number {
  if (!Number.isFinite(limit)) return fallback;
  return Math.min(500, Math.max(1, Math.trunc(limit)));
}
