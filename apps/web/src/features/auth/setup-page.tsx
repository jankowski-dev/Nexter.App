import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiFetch, apiPost } from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import { FormError, FormSuccess, Field } from './form-helpers';
import { authStatusResponseSchema, setupResponseSchema } from '@nexter/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';

export function SetupPage() {
  const navigate = useNavigate();
  const [setupToken, setSetupToken] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const status = useQuery({
    queryKey: ['auth-status'],
    queryFn: () => apiFetch('/api/v1/auth/status', {}, authStatusResponseSchema),
    retry: false,
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');

    if (password !== confirm) {
      setError('Пароли не совпадают');
      return;
    }

    setLoading(true);

    try {
      const result = await apiPost(
        '/api/v1/auth/setup',
        { setupToken, email, password },
        setupResponseSchema,
      );
      setRecoveryCodes(result.recoveryCodes);
    } catch (requestError) {
      setError(toRussianError(requestError, 'Не удалось создать владельца.'));
    } finally {
      setLoading(false);
    }
  }

  if (status.data?.initialized) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold text-zinc-900">Nexter уже настроен</h1>
        <p className="text-sm text-zinc-600">
          Владелец уже создан. Войдите со своим паролем и TOTP.
        </p>
        <Button asChild>
          <Link to="/login">Перейти ко входу</Link>
        </Button>
      </div>
    );
  }

  if (recoveryCodes.length > 0) {
    return (
      <div className="space-y-5">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">Сохраните recovery codes</h1>
          <p className="mt-1 text-sm text-zinc-600">
            Они показываются один раз. Каждый код одноразовый и нужен для восстановления доступа.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 rounded-md border border-zinc-200 bg-zinc-50 p-4 font-mono text-sm text-zinc-800">
          {recoveryCodes.map((code) => (
            <span key={code}>{code}</span>
          ))}
        </div>

        <FormSuccess>Коды сохранены? После продолжения они больше не будут показаны.</FormSuccess>

        <Button className="w-full" onClick={() => void navigate({ to: '/setup-2fa' })}>
          Я сохранил коды — продолжить
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900">Первый запуск</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Создайте единственного владельца Nexter. Setup token задан в окружении сервера.
        </p>
      </div>

      {error ? <FormError>{error}</FormError> : null}

      <form className="space-y-4" onSubmit={submit}>
        <Field label="Setup token">
          <Input
            type="password"
            autoComplete="off"
            value={setupToken}
            onChange={(event) => setSetupToken(event.target.value)}
            required
          />
        </Field>

        <Field label="Email">
          <Input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </Field>

        <Field label="Пароль (минимум 12 символов)">
          <Input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            minLength={12}
            required
          />
        </Field>

        <Field label="Повторите пароль">
          <Input
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            minLength={12}
            required
          />
        </Field>

        <Button className="w-full" type="submit" disabled={loading}>
          {loading ? 'Создаём…' : 'Создать владельца'}
        </Button>
      </form>

      <div className="text-center text-sm text-zinc-500">
        <Link className="hover:text-zinc-900" to="/login">
          Уже есть аккаунт? Войти
        </Link>
      </div>
    </div>
  );
}
