import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiFetch, apiPost } from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import { FormError, Field } from './form-helpers';
import { authStatusResponseSchema, loginResponseSchema } from '@nexter/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useState, type FormEvent } from 'react';
import { useAuthVisual } from './auth-visual';

export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [shake, setShake] = useState(false);
  const visual = useAuthVisual();

  useEffect(() => {
    visual.reset();
    // Reset the shared logo state when the login screen mounts.
  }, []);

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
      visual.setState('ok');
      visual.setLit(12);
      await new Promise((resolve) => window.setTimeout(resolve, 280));

      if (result.requires2fa) {
        await navigate({ to: '/2fa' });
      } else if (result.requires2faSetup) {
        await navigate({ to: '/setup-2fa' });
      } else {
        await navigate({ to: '/dashboard' });
      }
    } catch (requestError) {
      setError(toRussianError(requestError, 'Не удалось войти. Попробуйте ещё раз.'));
      visual.setState('error');
      visual.setLit(0);
      setShake(true);
      window.setTimeout(() => {
        setShake(false);
        visual.setState('idle');
        visual.setLit(password.length);
      }, 650);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="text-center">
        <h1 className="text-xl font-semibold">Вход</h1>
        <p className="mt-1 text-sm">Пароль и код из приложения-аутентификатора.</p>
      </div>

      {error ? <FormError>{error}</FormError> : null}

      <form className={`space-y-4 ${shake ? 'auth-shake' : ''}`} onSubmit={submit}>
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
            onChange={(event) => {
              const next = event.target.value;
              setPassword(next);
              visual.setLit(next.length);
              if (visual.state === 'error') visual.setState('idle');
            }}
            required
          />
        </Field>

        <Button className="w-full" type="submit" disabled={loading}>
          {loading ? 'Проверяем…' : 'Войти'}
        </Button>
      </form>

      <div className="flex items-center justify-between text-sm">
        <Link className="hover:text-zinc-900" to="/reset-password">
          Забыли пароль?
        </Link>
        {status.data && !status.data.initialized ? (
          <Link className="text-emerald-700 hover:text-emerald-800" to="/setup">
            Первый запуск
          </Link>
        ) : null}
      </div>
    </div>
  );
}
