import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { Select } from '@/components/ui/select';
import { toRussianError } from '@/lib/error-messages';
import {
  useCreateSandboxToken,
  useRefreshSandboxToken,
  useSandboxCoverage,
  useSandboxTokenCandidates,
  useSandboxTokens,
  useUpdateSandboxToken,
} from './sandbox-hooks';
import { SandboxTokenList, sandboxCoverageLabels, sandboxChainLabels } from './sandbox-token-list';
import { sandboxTokenCandidatePayload } from './sandbox-token-candidates';
import { useEffect, useMemo, useState } from 'react';
import type { SandboxToken } from '@nexter/contracts';

interface SandboxTokenNotice {
  text: string;
  tone: 'status' | 'error';
}

function candidateChainLabel(chain: string): string {
  return (sandboxChainLabels as Record<string, string>)[chain] ?? chain.toUpperCase();
}

export function SandboxTokensDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const tokens = useSandboxTokens(open);
  const coverage = useSandboxCoverage(open);
  const candidates = useSandboxTokenCandidates(open);
  const createToken = useCreateSandboxToken();
  const updateToken = useUpdateSandboxToken();
  const refreshToken = useRefreshSandboxToken();
  const [selectedKey, setSelectedKey] = useState('');
  const [notice, setNotice] = useState<SandboxTokenNotice | null>(null);

  useEffect(() => {
    if (!open) {
      setSelectedKey('');
      setNotice(null);
      return;
    }
    if (selectedKey) return;
    const first = candidates.data?.candidates.find((item) => item.eligible);
    if (first) setSelectedKey(first.tokenKey);
  }, [open, selectedKey, candidates.data]);

  const coverageByKey = useMemo(
    () => new Map((coverage.data?.tokens ?? []).map((entry) => [entry.tokenKey, entry])),
    [coverage.data],
  );
  const tokenList = tokens.data?.tokens ?? [];
  const adding = createToken.isPending;
  const togglingId = updateToken.isPending ? (updateToken.variables?.tokenId ?? null) : null;
  const refreshingId = refreshToken.isPending ? (refreshToken.variables ?? null) : null;
  const selected = candidates.data?.candidates.find((item) => item.tokenKey === selectedKey);

  async function addToken(): Promise<void> {
    if (!selected) {
      setNotice({ text: 'Выберите токен из «Избранного».', tone: 'error' });
      return;
    }
    if (!selected.eligible) {
      setNotice({ text: selected.reason ?? 'Токен не подходит для песочницы.', tone: 'error' });
      return;
    }

    setNotice(null);
    try {
      await createToken.mutateAsync(sandboxTokenCandidatePayload(selected));
      setSelectedKey('');
      setNotice({
        text: 'Токен добавлен из «Избранного». Он сразу доступен в настройках запуска.',
        tone: 'status',
      });
    } catch (error) {
      setNotice({
        text: toRussianError(error, 'Не удалось добавить токен'),
        tone: 'error',
      });
    }
  }

  async function toggleToken(token: SandboxToken, enabled: boolean): Promise<void> {
    setNotice(null);
    try {
      await updateToken.mutateAsync({ tokenId: token.id, body: { enabled } });
      setNotice({
        text: enabled ? `${token.symbol} включён.` : `${token.symbol} отключён.`,
        tone: 'status',
      });
    } catch (error) {
      setNotice({
        text: toRussianError(error, 'Не удалось изменить токен'),
        tone: 'error',
      });
    }
  }

  async function refresh(token: SandboxToken): Promise<void> {
    setNotice(null);
    try {
      const result = await refreshToken.mutateAsync(token.id);
      setNotice({
        text: `Загружено свечей: ${result.fetched}. Покрытие: ${sandboxCoverageLabels[result.coverage.status].toLowerCase()}.`,
        tone: 'status',
      });
    } catch (error) {
      setNotice({
        text: toRussianError(error, 'Не удалось обновить историю токена'),
        tone: 'error',
      });
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Токены песочницы"
      description="Только токены из «Избранного» с сетью и контрактом. Виртуальные деньги."
      size="lg"
      footer={
        <Button variant="secondary" onClick={onClose}>
          Готово
        </Button>
      }
    >
      <div className="space-y-5">
        <div className="rounded-xl border border-zinc-200 p-4">
          <h3 className="text-sm font-medium text-zinc-700">Добавить из «Избранного»</h3>
          <p className="mt-1 text-xs text-zinc-500">
            Список берётся из группы «Избранное». Если у токена не указан контракт, добавление
            заблокировано — сначала заполните контракт в базе токенов.
          </p>

          {candidates.isPending ? (
            <div className="mt-3 h-10 animate-pulse rounded-lg bg-zinc-100" />
          ) : candidates.isError ? (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {toRussianError(candidates.error, 'Не удалось загрузить «Избранное»')}
            </div>
          ) : (candidates.data?.candidates.length ?? 0) === 0 ? (
            <div className="mt-3 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-3 py-3 text-sm text-zinc-600">
              В «Избранном» пока нет токенов. Добавьте токен в базу и группу «Избранное».
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              <label className="block text-sm text-zinc-600">
                Токен
                <Select
                  className="mt-1"
                  value={selectedKey}
                  onChange={(event) => setSelectedKey(event.target.value)}
                >
                  <option value="">Выберите токен</option>
                  {candidates.data?.candidates.map((candidate) => (
                    <option
                      key={candidate.tokenKey}
                      value={candidate.tokenKey}
                      disabled={!candidate.eligible}
                    >
                      {candidate.symbol} · {candidateChainLabel(candidate.chain)} · {candidate.name}
                      {candidate.eligible ? '' : ` — ${candidate.reason}`}
                    </option>
                  ))}
                </Select>
              </label>
              {selected && !selected.eligible ? (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  {selected.reason}
                </p>
              ) : null}
              <div className="flex justify-end">
                <Button
                  onClick={() => void addToken()}
                  disabled={adding || !selected || !selected.eligible}
                >
                  {adding ? 'Добавляю…' : 'Добавить токен'}
                </Button>
              </div>
            </div>
          )}
        </div>

        {notice ? (
          <div
            role={notice.tone === 'error' ? 'alert' : 'status'}
            className={`rounded-xl border px-4 py-3 text-sm ${
              notice.tone === 'error'
                ? 'border-red-200 bg-red-50 text-red-700'
                : 'border-zinc-200 bg-zinc-50 text-zinc-700'
            }`}
          >
            {notice.text}
          </div>
        ) : null}

        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <h3 className="text-sm font-medium text-zinc-700">Вселенная</h3>
            <span className="text-xs text-zinc-500">Токенов: {tokenList.length}</span>
          </div>
          <SandboxTokenList
            tokens={tokenList}
            coverageByKey={coverageByKey}
            pending={tokens.isPending}
            error={
              tokens.isError
                ? toRussianError(tokens.error, 'Не удалось загрузить токены песочницы')
                : null
            }
            coverageError={
              coverage.isError
                ? toRussianError(coverage.error, 'Не удалось проверить покрытие истории')
                : null
            }
            togglingId={togglingId}
            refreshingId={refreshingId}
            onToggle={(token, enabled) => void toggleToken(token, enabled)}
            onRefresh={(token) => void refresh(token)}
          />
        </div>
      </div>
    </Drawer>
  );
}
