import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { apiDelete, apiFetch, apiPost } from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import { Field, FormError, FormSuccess } from '@/features/auth/form-helpers';
import {
  recoveryCodesResponseSchema,
  sessionsResponseSchema,
  type SessionSummary,
} from '@nexter/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

export function SecuritySettingsPage() {
  const queryClient = useQueryClient();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [recoveryPassword, setRecoveryPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [newCodes, setNewCodes] = useState<string[]>([]);

  const sessions = useQuery({
    queryKey: ['sessions'],
    queryFn: () => apiFetch('/api/v1/auth/sessions', {}, sessionsResponseSchema),
  });

  const changePassword = useMutation({
    mutationFn: () => apiPost('/api/v1/auth/password', { currentPassword, newPassword }),
    onSuccess: async () => {
      setCurrentPassword('');
      setNewPassword('');
      setError('');
      setMessage('Пароль изменён. Текущая сессия обновлена, остальные устройства отозваны.');
      await queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
    onError: (requestError) => {
      setMessage('');
      setError(toRussianError(requestError, 'Не удалось изменить пароль.'));
    },
  });

  const regenerateCodes = useMutation({
    mutationFn: () =>
      apiPost(
        '/api/v1/auth/recovery-codes',
        { password: recoveryPassword },
        recoveryCodesResponseSchema,
      ),
    onSuccess: (result) => {
      setRecoveryPassword('');
      setError('');
      setMessage('');
      setNewCodes(result.recoveryCodes);
    },
    onError: (requestError) => {
      setError(toRussianError(requestError, 'Не удалось перегенерировать recovery codes.'));
    },
  });

  const revokeSession = useMutation({
    mutationFn: (session: SessionSummary) => apiDelete(`/api/v1/auth/sessions/${session.id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
    onError: (requestError) => {
      setError(toRussianError(requestError, 'Не удалось отозвать сессию.'));
    },
  });

  function submitPassword(event: FormEvent) {
    event.preventDefault();
    setError('');
    setMessage('');
    changePassword.mutate();
  }

  function submitRecoveryCodes(event: FormEvent) {
    event.preventDefault();
    setError('');
    setMessage('');
    regenerateCodes.mutate();
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Безопасность</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Пароль, recovery codes и устройства, на которых открыт Nexter.
        </p>
      </div>

      {message ? <FormSuccess>{message}</FormSuccess> : null}
      {error ? <FormError>{error}</FormError> : null}

      {newCodes.length > 0 ? (
        <Card>
          <CardTitle>Новые recovery codes</CardTitle>
          <CardDescription>Сохраните их. Старые коды больше не действуют.</CardDescription>
          <div className="mt-3 grid grid-cols-2 gap-2 rounded-md border border-zinc-200 bg-zinc-50 p-4 font-mono text-sm">
            {newCodes.map((code) => (
              <span key={code}>{code}</span>
            ))}
          </div>
        </Card>
      ) : null}

      <Card>
        <CardTitle>Смена пароля</CardTitle>
        <form className="mt-4 space-y-4" onSubmit={submitPassword}>
          <Field label="Текущий пароль">
            <Input
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              required
            />
          </Field>
          <Field label="Новый пароль (минимум 12 символов)">
            <Input
              type="password"
              autoComplete="new-password"
              minLength={12}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              required
            />
          </Field>
          <Button type="submit" disabled={changePassword.isPending}>
            {changePassword.isPending ? 'Меняем…' : 'Изменить пароль'}
          </Button>
        </form>
      </Card>

      <Card>
        <CardTitle>Recovery codes</CardTitle>
        <CardDescription>
          Перегенерация отменит все старые коды. Потребуется пароль.
        </CardDescription>
        <form className="mt-4 space-y-4" onSubmit={submitRecoveryCodes}>
          <Field label="Пароль">
            <Input
              type="password"
              autoComplete="current-password"
              value={recoveryPassword}
              onChange={(event) => setRecoveryPassword(event.target.value)}
              required
            />
          </Field>
          <Button type="submit" variant="secondary" disabled={regenerateCodes.isPending}>
            {regenerateCodes.isPending ? 'Генерируем…' : 'Сгенерировать новые коды'}
          </Button>
        </form>
      </Card>

      <Card>
        <CardTitle>Активные сессии</CardTitle>
        <CardDescription>
          Если устройство потеряно или вызывает сомнения — отзовите его сессию.
        </CardDescription>
        <div className="mt-4 space-y-2">
          {sessions.data?.sessions.map((session) => (
            <div
              key={session.id}
              className="flex flex-col gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="truncate text-zinc-700">
                  {session.current
                    ? 'Текущая сессия'
                    : (session.userAgent ?? 'Неизвестное устройство')}
                </div>
                <div className="text-xs text-zinc-500">
                  {session.ip ?? 'IP неизвестен'} ·{' '}
                  {session.lastSeenAt
                    ? new Date(session.lastSeenAt).toLocaleString()
                    : 'нет данных'}
                </div>
                <div className="text-xs text-zinc-500">
                  Истекает: {new Date(session.expiresAt).toLocaleString()}
                </div>
              </div>
              {!session.current ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => revokeSession.mutate(session)}
                  disabled={revokeSession.isPending}
                >
                  Отозвать
                </Button>
              ) : null}
            </div>
          ))}
          {sessions.isPending ? (
            <div className="text-sm text-zinc-500">Загружаем сессии…</div>
          ) : null}
          {sessions.isError ? (
            <div className="text-sm text-red-700">Не удалось загрузить сессии.</div>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
