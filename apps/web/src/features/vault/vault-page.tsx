import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Drawer } from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { Textarea } from '@/components/ui/textarea';
import { CopyIcon, EyeIcon } from '@/components/ui/icons';
import { createVaultItem, fetchVault, initializeVault, updateVaultItem } from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import { formatDateTime } from '@/lib/format';
import {
  createSalt,
  decryptVaultItem,
  deriveMasterKey,
  encryptVaultItem,
  generateDataKey,
  generatePassword,
  unwrapDataKey,
  VAULT_ITERATIONS,
  wrapDataKey,
  type VaultItemData,
} from '@/lib/vault-crypto';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAutoDismissNotice } from '@/lib/use-auto-dismiss-notice';
import { useEffect, useState } from 'react';
import type { VaultItem } from '@nexter/contracts';

interface DecryptedItem {
  item: VaultItem;
  data: VaultItemData;
}

function SafeIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 8v1.2M12 14.8V16M8 12h1.2M14.8 12H16M6 20.5v1.5M18 20.5v1.5" />
    </svg>
  );
}

function VaultAuthShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-2 py-6">
      <div className="w-full max-w-md rounded-3xl border border-zinc-800 bg-gradient-to-br from-[#202329] via-[#252932] to-[#1b1e23] p-7 shadow-2xl">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/30">
          <SafeIcon className="h-8 w-8" />
        </div>
        <h2 className="mt-5 text-center text-2xl font-semibold text-white">{title}</h2>
        <p className="mt-2 text-center text-sm leading-6 text-zinc-400">{description}</p>
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}

function safeUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export function VaultPage() {
  const queryClient = useQueryClient();
  const [includeArchived, setIncludeArchived] = useState(false);
  const vault = useQuery({
    queryKey: ['vault', includeArchived],
    queryFn: () => fetchVault(includeArchived),
  });
  const [dataKey, setDataKey] = useState<CryptoKey | null>(null);
  const [decrypted, setDecrypted] = useState<DecryptedItem[]>([]);
  const [decryptFailures, setDecryptFailures] = useState(0);
  const [masterPassword, setMasterPassword] = useState('');
  const [showMasterPassword, setShowMasterPassword] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useAutoDismissNotice(notice, () => setNotice(null), 6000);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<DecryptedItem | null>(null);
  const [title, setTitle] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [url, setUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [itemError, setItemError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!dataKey || !vault.data) {
      setDecrypted([]);
      setDecryptFailures(0);
      return;
    }

    let cancelled = false;

    void Promise.all(
      vault.data.items.map(async (item) => {
        try {
          return { item, data: await decryptVaultItem(dataKey, item.ciphertext, item.iv) };
        } catch {
          return null;
        }
      }),
    ).then((rows) => {
      if (cancelled) return;
      setDecrypted(rows.filter((row): row is DecryptedItem => row !== null));
      setDecryptFailures(rows.filter((row) => row === null).length);
    });

    return () => {
      cancelled = true;
    };
  }, [dataKey, vault.data]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['vault'] });
  };

  const saveItemMutation = useMutation({
    mutationFn: async () => {
      if (!dataKey) throw new Error('Vault is locked');
      const payload = await encryptVaultItem(dataKey, {
        title: title.trim(),
        username: username.trim(),
        password,
        url: url.trim(),
        notes,
      });

      if (editing) {
        return updateVaultItem(editing.item.id, {
          ciphertext: payload.ciphertext,
          iv: payload.iv,
        });
      }

      return createVaultItem(payload);
    },
    onSuccess: () => {
      closeItemDialog();
      invalidate();
    },
    onError: (err) =>
      setItemError(
        err instanceof Error && err.message === 'VAULT_ITEM_TOO_LARGE'
          ? 'Запись слишком большая. Сократите текст заметок или другие поля.'
          : toRussianError(err, 'Не удалось сохранить запись'),
      ),
  });

  const archiveMutation = useMutation({
    mutationFn: (item: VaultItem) => updateVaultItem(item.id, { archived: true }),
    onSuccess: () => {
      setRevealed(null);
      setError(null);
      invalidate();
    },
    onError: (err) => setError(toRussianError(err, 'Не удалось архивировать запись')),
  });

  const restoreMutation = useMutation({
    mutationFn: (item: VaultItem) => updateVaultItem(item.id, { archived: false }),
    onSuccess: () => {
      setRevealed(null);
      setError(null);
      invalidate();
    },
    onError: (err) => setError(toRussianError(err, 'Не удалось вернуть запись')),
  });

  async function setupVault(): Promise<void> {
    setUnlockError(null);
    setNotice(null);

    if (masterPassword.length < 12) {
      setUnlockError('Мастер-пароль должен содержать минимум 12 символов.');
      return;
    }

    if (masterPassword !== confirmPassword) {
      setUnlockError('Пароли не совпадают.');
      return;
    }

    setBusy(true);

    try {
      const salt = createSalt();
      const masterKey = await deriveMasterKey(masterPassword, salt, VAULT_ITERATIONS);
      const key = await generateDataKey();
      const wrapped = await wrapDataKey(key, masterKey);

      await initializeVault({
        salt,
        iterations: VAULT_ITERATIONS,
        wrappedKey: wrapped.ciphertext,
        wrappedKeyIv: wrapped.iv,
      });

      setDataKey(key);
      setMasterPassword('');
      setConfirmPassword('');
      setNotice('Хранилище создано. Мастер-пароль не сохраняется — запомните его.');
      invalidate();
    } catch (err) {
      setUnlockError(toRussianError(err, 'Не удалось создать хранилище'));
    } finally {
      setBusy(false);
    }
  }

  async function unlockVault(): Promise<void> {
    const config = vault.data?.config;
    if (!config) return;

    setUnlockError(null);
    setNotice(null);
    setBusy(true);

    try {
      const masterKey = await deriveMasterKey(masterPassword, config.salt, config.iterations);
      const key = await unwrapDataKey(config.wrappedKey, config.wrappedKeyIv, masterKey);
      setDataKey(key);
      setMasterPassword('');
      setNotice(null);
    } catch {
      setUnlockError('Неверный мастер-пароль.');
    } finally {
      setBusy(false);
    }
  }

  function openCreate() {
    setEditing(null);
    setTitle('');
    setUsername('');
    setPassword('');
    setUrl('');
    setNotes('');
    setItemError(null);
    setDialogOpen(true);
  }

  function openEdit(row: DecryptedItem) {
    setEditing(row);
    setTitle(row.data.title);
    setUsername(row.data.username);
    setPassword(row.data.password);
    setUrl(row.data.url);
    setNotes(row.data.notes);
    setItemError(null);
    setDialogOpen(true);
  }

  function clearItemForm(): void {
    setEditing(null);
    setTitle('');
    setUsername('');
    setPassword('');
    setUrl('');
    setNotes('');
    setItemError(null);
  }

  function closeItemDialog(): void {
    setDialogOpen(false);
    clearItemForm();
  }

  function lockVault(): void {
    setDataKey(null);
    setDecrypted([]);
    setDecryptFailures(0);
    setRevealed(null);
    setMasterPassword('');
    setConfirmPassword('');
    setUnlockError(null);
    closeItemDialog();
    setNotice('Хранилище заблокировано.');
  }

  async function copyPassword(value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setNotice('Пароль скопирован в буфер обмена.');
      setError(null);
    } catch {
      setError('Не удалось скопировать пароль. Браузер запретил доступ к буферу.');
    }
  }

  if (vault.isPending) {
    return (
      <div className="space-y-6">
        <PageHeader title="Хранилище" subtitle="Зашифрованные пароли и доступы." />
        <LoadingRows rows={5} />
      </div>
    );
  }

  if (vault.isError) {
    return (
      <div className="space-y-6">
        <PageHeader title="Хранилище" />
        <ErrorState
          message={toRussianError(vault.error, 'Не удалось загрузить хранилище')}
          onRetry={() => void vault.refetch()}
        />
      </div>
    );
  }

  const config = vault.data?.config;
  const unlocked = Boolean(config && dataKey);
  const query = search.trim().toLowerCase();
  const visibleItems = decrypted.filter((row) => {
    if (!query) return true;
    return [row.data.title, row.data.username, row.data.url].some((value) =>
      value.toLowerCase().includes(query),
    );
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Хранилище"
        subtitle="Пароли шифруются в браузере. Сервер хранит только шифротекст и не знает мастер-пароль."
        actions={
          config ? (
            <>
              <label className="flex items-center gap-2 text-sm text-zinc-600">
                <input
                  type="checkbox"
                  checked={includeArchived}
                  onChange={(event) => {
                    setIncludeArchived(event.target.checked);
                    setRevealed(null);
                  }}
                  className="h-4 w-4 rounded border-zinc-300 bg-white"
                />
                Архив
              </label>
              {unlocked ? (
                <>
                  <Button variant="secondary" onClick={lockVault}>
                    Заблокировать
                  </Button>
                  <Button onClick={openCreate}>Добавить запись</Button>
                </>
              ) : null}
            </>
          ) : undefined
        }
      />

      {notice ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          {notice}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}
      {decryptFailures > 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Не удалось расшифровать записей: {decryptFailures}. Возможно, они созданы с другим
          мастер-паролем или повреждены.
        </div>
      ) : null}

      {!config ? (
        <VaultAuthShell
          title="Создать хранилище"
          description="Придумайте мастер-пароль. Он не отправляется на сервер и не сохраняется. При потере пароля восстановить записи невозможно — это цена end-to-end шифрования."
        >
          <div className="space-y-3">
            <label className="block text-sm text-zinc-300">
              Мастер-пароль
              <div className="relative mt-1">
                <Input
                  className="border-zinc-700 bg-zinc-900/80 pr-10 text-white placeholder:text-zinc-500"
                  type={showMasterPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={masterPassword}
                  onChange={(event) => setMasterPassword(event.target.value)}
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-zinc-400 hover:text-white"
                  onClick={() => setShowMasterPassword((value) => !value)}
                  aria-label={showMasterPassword ? 'Скрыть пароль' : 'Показать пароль'}
                >
                  <EyeIcon />
                </button>
              </div>
            </label>
            <label className="block text-sm text-zinc-300">
              Повторите пароль
              <Input
                className="mt-1 border-zinc-700 bg-zinc-900/80 text-white placeholder:text-zinc-500"
                type={showMasterPassword ? 'text' : 'password'}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </label>
            {unlockError ? <p className="text-sm text-red-300">{unlockError}</p> : null}
            <Button className="w-full" onClick={() => void setupVault()} disabled={busy}>
              {busy ? 'Создаю хранилище…' : 'Создать хранилище'}
            </Button>
          </div>
        </VaultAuthShell>
      ) : !unlocked ? (
        <VaultAuthShell
          title="Хранилище заблокировано"
          description="Введите мастер-пароль, чтобы расшифровать записи в этом браузере."
        >
          <div className="space-y-3">
            <label className="block text-sm text-zinc-300">
              Мастер-пароль
              <div className="relative mt-1">
                <Input
                  className="border-zinc-700 bg-zinc-900/80 pr-10 text-white placeholder:text-zinc-500"
                  type={showMasterPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={masterPassword}
                  onChange={(event) => setMasterPassword(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void unlockVault();
                  }}
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-zinc-400 hover:text-white"
                  onClick={() => setShowMasterPassword((value) => !value)}
                  aria-label={showMasterPassword ? 'Скрыть пароль' : 'Показать пароль'}
                >
                  <EyeIcon />
                </button>
              </div>
            </label>
            {unlockError ? <p className="text-sm text-red-300">{unlockError}</p> : null}
            <Button
              className="w-full"
              onClick={() => void unlockVault()}
              disabled={busy || !masterPassword}
            >
              {busy ? 'Расшифровываю…' : 'Разблокировать'}
            </Button>
          </div>
        </VaultAuthShell>
      ) : (
        <>
          <div className="relative">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Поиск по названию, логину или сайту"
              aria-label="Поиск в хранилище"
              className="pl-9"
            />
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400">
              ⌕
            </span>
          </div>

          {decrypted.length === 0 && decryptFailures === 0 ? (
            <Card>
              <CardTitle>Записей нет</CardTitle>
              <CardDescription>
                Добавьте первый пароль. Он будет зашифрован в браузере перед отправкой.
              </CardDescription>
              <Button className="mt-4" onClick={openCreate}>
                Добавить запись
              </Button>
            </Card>
          ) : visibleItems.length === 0 ? (
            <Card>
              <CardTitle>Ничего не найдено</CardTitle>
              <CardDescription>Попробуйте другое название, логин или сайт.</CardDescription>
            </Card>
          ) : (
            <div className="space-y-2">
              {visibleItems.map((row) => (
                <Card
                  key={row.item.id}
                  className={`p-3 transition-colors hover:border-emerald-300 ${
                    row.item.archivedAt ? 'opacity-60' : ''
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50 text-zinc-700">
                      <SafeIcon className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="truncate text-base font-semibold text-zinc-900">
                          {row.data.title || 'Без названия'}
                        </div>
                        {row.item.archivedAt ? <Badge tone="neutral">Архив</Badge> : null}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-zinc-500">
                        <span>{formatDateTime(row.item.updatedAt)}</span>
                        {row.data.url ? (
                          safeUrl(row.data.url) ? (
                            <a
                              className="truncate text-emerald-800 hover:text-emerald-700"
                              href={safeUrl(row.data.url) ?? undefined}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {row.data.url}
                            </a>
                          ) : (
                            <span className="truncate text-zinc-600">{row.data.url}</span>
                          )
                        ) : null}
                      </div>
                      {row.data.notes ? (
                        <p className="mt-1 line-clamp-1 text-xs text-zinc-600">{row.data.notes}</p>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      {row.data.username ? (
                        <span
                          className="max-w-48 truncate font-mono text-xs text-zinc-600"
                          title={row.data.username}
                        >
                          {row.data.username}
                        </span>
                      ) : null}
                      <code className="rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1 font-mono text-xs text-zinc-700">
                        {revealed === row.item.id ? row.data.password : '••••••••••••'}
                      </code>
                      <Button
                        variant="ghost"
                        className="h-8 w-8 p-0"
                        aria-label={revealed === row.item.id ? 'Скрыть пароль' : 'Показать пароль'}
                        title={revealed === row.item.id ? 'Скрыть' : 'Показать'}
                        onClick={() => setRevealed(revealed === row.item.id ? null : row.item.id)}
                      >
                        <EyeIcon />
                      </Button>
                      <Button
                        variant="ghost"
                        className="h-8 w-8 p-0"
                        aria-label="Копировать пароль"
                        title="Копировать"
                        onClick={() => void copyPassword(row.data.password)}
                      >
                        <CopyIcon />
                      </Button>
                      <Button
                        variant="secondary"
                        className="h-8 px-3 text-xs"
                        onClick={() => openEdit(row)}
                      >
                        Изменить
                      </Button>
                      {row.item.archivedAt ? (
                        <Button
                          variant="secondary"
                          className="h-8 px-3 text-xs"
                          onClick={() => restoreMutation.mutate(row.item)}
                          disabled={restoreMutation.isPending}
                        >
                          Вернуть
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          className="h-8 px-3 text-xs"
                          onClick={() => {
                            if (window.confirm(`Архивировать запись «${row.data.title}»?`)) {
                              archiveMutation.mutate(row.item);
                            }
                          }}
                          disabled={archiveMutation.isPending}
                        >
                          В архив
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      <Drawer
        open={dialogOpen}
        onClose={closeItemDialog}
        title={editing ? 'Изменить запись' : 'Новая запись'}
        titleIcon={<SafeIcon className="h-8 w-8 rounded-lg bg-emerald-50 p-1 text-emerald-700" />}
        description="Поля шифруются в браузере. Сервер получает только шифротекст."
        size="third"
        footer={
          <>
            <Button variant="ghost" onClick={closeItemDialog}>
              Отмена
            </Button>
            <Button
              onClick={() => saveItemMutation.mutate()}
              disabled={saveItemMutation.isPending || !title.trim()}
            >
              {saveItemMutation.isPending ? 'Шифрую…' : 'Сохранить'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <label className="block text-sm text-zinc-600">
            Название
            <Input
              className="mt-1"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Например, Биржа или Сервис"
              maxLength={200}
            />
          </label>
          <label className="block text-sm text-zinc-600">
            Логин
            <Input
              className="mt-1"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="off"
              maxLength={200}
            />
          </label>
          <label className="block text-sm text-zinc-600">
            Пароль
            <div className="mt-1 flex gap-2">
              <Input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                aria-label="Пароль"
                className="font-mono"
                maxLength={500}
              />
              <Button
                variant="secondary"
                onClick={() => setPassword(generatePassword())}
                type="button"
              >
                Сгенерировать
              </Button>
            </div>
          </label>
          <label className="block text-sm text-zinc-600">
            Ссылка
            <Input
              className="mt-1"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://"
              autoComplete="off"
              maxLength={2000}
            />
          </label>
          <label className="block text-sm text-zinc-600">
            Заметки
            <Textarea
              className="mt-1"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              maxLength={4000}
            />
          </label>
          {itemError ? <p className="text-sm text-red-700">{itemError}</p> : null}
        </div>
      </Drawer>
    </div>
  );
}
