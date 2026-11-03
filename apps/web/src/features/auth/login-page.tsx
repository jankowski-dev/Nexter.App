import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiFetch, apiPost } from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import { FormError, Field } from './form-helpers';
import { authStatusResponseSchema, loginResponseSchema } from '@nexter/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';

export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
    setLoading(true);

    try {
      const result = await apiPost('/api/v1/auth/login', { email, password }, loginResponseSchema);

      if (result.requires2fa) {
        await navigate({ to: '/2fa' });
      } else if (result.requires2faSetup) {
        await navigate({ to: '/setup-2fa' });
      } else {
        await navigate({ to: '/dashboard' });
      }
    } catch (requestError) {
      setError(toRussianError(requestError, 'Не удалось войти. Попробуйте ещё раз.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-zinc-50">Вход</h1>
        <p className="mt-1 text-sm text-zinc-400">Пароль и код из приложения-аутентификатора.</p>
      </div>

      {error ? <FormError>{error}</FormError> : null}

      <form className="space-y-4" onSubmit={submit}>
        <Field label="Email">
          <Input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </Field>

        <Field label="Пароль">
          <Input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </Field>

        <Button className="w-full" type="submit" disabled={loading}>
          {loading ? 'Проверяем…' : 'Войти'}
        </Button>
      </form>

      <div className="flex items-center justify-between text-sm text-zinc-500">
        <Link className="hover:text-zinc-300" to="/reset-password">
          Забыли пароль?
        </Link>
        {status.data && !status.data.initialized ? (
          <Link className="text-emerald-400 hover:text-emerald-300" to="/setup">
            Первый запуск
          </Link>
        ) : null}
      </div>
    </div>
  );
}
