import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { formatDateTime } from '@/lib/format';
import type { SandboxChain, SandboxCoverage, SandboxToken } from '@nexter/contracts';

export const sandboxChainLabels: Record<SandboxChain, string> = {
  bsc: 'BSC',
  ethereum: 'Ethereum',
  binance: 'Binance',
};

export const sandboxCoverageLabels: Record<SandboxCoverage['status'], string> = {
  ok: 'История полная',
  partial: 'История неполная',
  missing: 'Истории нет',
};

export interface SandboxCoverageBadge {
  label: string;
  tone: 'neutral' | 'success' | 'warning' | 'danger';
}

/**
 * Coverage badge for the token list. A green "История полная" is only honest
 * when the series is complete, non-synthetic and fresh; otherwise the badge
 * names the actual problem.
 */
export function sandboxCoverageBadge(coverage: SandboxCoverage | undefined): SandboxCoverageBadge {
  if (!coverage) return { label: 'Покрытие неизвестно', tone: 'neutral' };
  if (coverage.status === 'missing') return { label: 'Истории нет', tone: 'danger' };
  if (coverage.stale) return { label: 'Устарело', tone: 'warning' };
  if (coverage.synthetic) return { label: 'Синтетика', tone: 'warning' };
  if (coverage.status === 'partial') return { label: 'Частично', tone: 'warning' };
  return { label: 'История полная', tone: 'success' };
}

export function SandboxTokenRow({
  token,
  coverage,
  toggling,
  refreshing,
  onToggle,
  onRefresh,
}: {
  token: SandboxToken;
  coverage: SandboxCoverage | undefined;
  toggling: boolean;
  refreshing: boolean;
  onToggle: (enabled: boolean) => void;
  onRefresh: () => void;
}) {
  const badge = sandboxCoverageBadge(coverage);

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-zinc-900">{token.symbol}</span>
          <span className="text-sm text-zinc-500">{token.name}</span>
          <Badge tone="neutral">{sandboxChainLabels[token.chain]}</Badge>
          <Badge tone={badge.tone}>{badge.label}</Badge>
        </div>
        <code className="mt-1 block break-all text-[11px] text-zinc-500">{token.tokenKey}</code>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
          <span>Свечей 1h: {coverage ? `${coverage.available} из ${coverage.required}` : '—'}</span>
          <span>Последняя: {formatDateTime(coverage?.lastOpenTime ?? null)}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-zinc-600">
          <Switch
            checked={token.enabled}
            disabled={toggling}
            onChange={onToggle}
            label={`${token.enabled ? 'Отключить' : 'Включить'} ${token.symbol}`}
          />
          {token.enabled ? 'Включён' : 'Отключён'}
        </label>
        <Button variant="secondary" disabled={refreshing} onClick={onRefresh}>
          {refreshing ? 'Обновляю…' : 'Обновить'}
        </Button>
      </div>
    </div>
  );
}

/**
 * Token universe list shared by the drawer and its tests. An empty universe
 * points the owner at the add form; a failed coverage query is never silent.
 */
export function SandboxTokenList({
  tokens,
  coverageByKey,
  pending,
  error,
  coverageError,
  togglingId,
  refreshingId,
  onToggle,
  onRefresh,
}: {
  tokens: readonly SandboxToken[];
  coverageByKey: ReadonlyMap<string, SandboxCoverage>;
  pending: boolean;
  error: string | null;
  coverageError: string | null;
  togglingId: string | null;
  refreshingId: string | null;
  onToggle: (token: SandboxToken, enabled: boolean) => void;
  onRefresh: (token: SandboxToken) => void;
}) {
  if (pending) {
    return (
      <div className="h-20 animate-pulse rounded-xl bg-zinc-100" aria-label="Загрузка токенов" />
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {error}
      </div>
    );
  }

  return (
    <div>
      {tokens.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-4 py-3 text-sm text-zinc-600">
          В песочнице пока нет токенов. Добавьте первый токен формой выше.
        </div>
      ) : (
        <div className="space-y-2">
          {tokens.map((token) => (
            <SandboxTokenRow
              key={token.id}
              token={token}
              coverage={coverageByKey.get(token.tokenKey)}
              toggling={togglingId === token.id}
              refreshing={refreshingId === token.id}
              onToggle={(enabled) => onToggle(token, enabled)}
              onRefresh={() => onRefresh(token)}
            />
          ))}
        </div>
      )}
      {coverageError ? (
        <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {coverageError}
        </div>
      ) : null}
    </div>
  );
}
