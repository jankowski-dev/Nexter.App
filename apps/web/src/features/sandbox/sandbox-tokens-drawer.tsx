import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { toRussianError } from '@/lib/error-messages';
import {
  useCreateSandboxToken,
  useRefreshSandboxToken,
  useSandboxCoverage,
  useSandboxTokens,
  useUpdateSandboxToken,
} from './sandbox-hooks';
import { SandboxTokenList, sandboxCoverageLabels, sandboxChainLabels } from './sandbox-token-list';
import {
  sandboxTokenCreatePayload,
  sandboxTokenFormDefaults,
  validateSandboxTokenForm,
  type SandboxTokenFormValues,
} from './sandbox-token-form';
import { useMemo, useState } from 'react';
import type { SandboxChain, SandboxToken } from '@nexter/contracts';

export function SandboxTokensDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const tokens = useSandboxTokens(open);
  const coverage = useSandboxCoverage(open);
  const createToken = useCreateSandboxToken();
  const updateToken = useUpdateSandboxToken();
  const refreshToken = useRefreshSandboxToken();
  const [form, setForm] = useState<SandboxTokenFormValues>(sandboxTokenFormDefaults);
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const coverageByKey = useMemo(
    () => new Map((coverage.data?.tokens ?? []).map((entry) => [entry.tokenKey, entry])),
    [coverage.data],
  );
  const tokenList = tokens.data?.tokens ?? [];
  const adding = createToken.isPending;
  const togglingId = updateToken.isPending ? (updateToken.variables?.tokenId ?? null) : null;
  const refreshingId = refreshToken.isPending ? (refreshToken.variables ?? null) : null;

  function update<K extends keyof SandboxTokenFormValues>(
    key: K,
    value: SandboxTokenFormValues[K],
  ): void {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function addToken(): Promise<void> {
    const validationErrors = validateSandboxTokenForm(form);
    setErrors(validationErrors);
    setNotice(null);
    if (validationErrors.length > 0) return;

    try {
      await createToken.mutateAsync(sandboxTokenCreatePayload(form));
      setForm(sandboxTokenFormDefaults());
      setNotice('Токен добавлен. Он сразу доступен в настройках запуска.');
    } catch (error) {
      setNotice(toRussianError(error, 'Не удалось добавить токен'));
    }
  }

  async function toggleToken(token: SandboxToken, enabled: boolean): Promise<void> {
    setNotice(null);
    try {
      await updateToken.mutateAsync({ tokenId: token.id, body: { enabled } });
      setNotice(enabled ? `${token.symbol} включён.` : `${token.symbol} отключён.`);
    } catch (error) {
      setNotice(toRussianError(error, 'Не удалось изменить токен'));
    }
  }

  async function refresh(token: SandboxToken): Promise<void> {
    setNotice(null);
    try {
      const result = await refreshToken.mutateAsync(token.id);
      setNotice(
        `Загружено свечей: ${result.fetched}. Покрытие: ${sandboxCoverageLabels[result.coverage.status].toLowerCase()}.`,
      );
    } catch (error) {
      setNotice(toRussianError(error, 'Не удалось обновить историю токена'));
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Токены песочницы"
      description="Вселенная запусков: реальные рыночные инструменты, только виртуальные деньги."
      size="lg"
      footer={
        <Button variant="secondary" onClick={onClose}>
          Готово
        </Button>
      }
    >
      <div className="space-y-5">
        <div className="rounded-xl border border-zinc-200 p-4">
          <h3 className="text-sm font-medium text-zinc-700">Добавить токен</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block text-sm text-zinc-600">
              Способ
              <Select
                className="mt-1"
                value={form.mode}
                onChange={(event) =>
                  update('mode', event.target.value as SandboxTokenFormValues['mode'])
                }
              >
                <option value="key">Ключ токена</option>
                <option value="chain">Сеть и адрес/пара</option>
              </Select>
            </label>

            {form.mode === 'key' ? (
              <label className="block text-sm text-zinc-600">
                Ключ токена
                <Input
                  className="mt-1"
                  value={form.tokenKey}
                  placeholder="bsc:0x… или binance:BTCUSDT"
                  onChange={(event) => update('tokenKey', event.target.value)}
                />
              </label>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm text-zinc-600">
                  Сеть
                  <Select
                    className="mt-1"
                    value={form.chain}
                    onChange={(event) => update('chain', event.target.value as SandboxChain)}
                  >
                    <option value="bsc">{sandboxChainLabels.bsc}</option>
                    <option value="ethereum">{sandboxChainLabels.ethereum}</option>
                    <option value="binance">{sandboxChainLabels.binance}</option>
                  </Select>
                </label>
                <label className="block text-sm text-zinc-600">
                  {form.chain === 'binance' ? 'Пара' : 'Адрес контракта'}
                  <Input
                    className="mt-1"
                    value={form.identifier}
                    placeholder={form.chain === 'binance' ? 'BTCUSDT' : '0x…'}
                    onChange={(event) => update('identifier', event.target.value)}
                  />
                </label>
              </div>
            )}

            <label className="block text-sm text-zinc-600">
              Символ
              <Input
                className="mt-1"
                value={form.symbol}
                maxLength={40}
                placeholder="CAKE"
                onChange={(event) => update('symbol', event.target.value)}
              />
            </label>
            <label className="block text-sm text-zinc-600">
              Название
              <Input
                className="mt-1"
                value={form.name}
                maxLength={80}
                placeholder="PancakeSwap"
                onChange={(event) => update('name', event.target.value)}
              />
            </label>
            <label className="block text-sm text-zinc-600">
              CoinGecko id (необязательно)
              <Input
                className="mt-1"
                value={form.coingeckoId}
                maxLength={80}
                placeholder="pancakeswap-token"
                onChange={(event) => update('coingeckoId', event.target.value)}
              />
            </label>
            <label className="flex items-end gap-2 pb-2 text-sm text-zinc-600">
              <Switch
                checked={form.enabled}
                onChange={(enabled) => update('enabled', enabled)}
                label="Токен включён"
              />
              Включён
            </label>
          </div>
          <div className="mt-3 flex justify-end">
            <Button onClick={() => void addToken()} disabled={adding}>
              {adding ? 'Добавляю…' : 'Добавить токен'}
            </Button>
          </div>
          {errors.length > 0 ? (
            <ul className="mt-3 list-disc space-y-1 rounded-xl border border-red-200 bg-red-50 py-2 pl-8 pr-4 text-sm text-red-700">
              {errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          ) : null}
        </div>

        {notice ? (
          <div
            role="status"
            className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-700"
          >
            {notice}
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
