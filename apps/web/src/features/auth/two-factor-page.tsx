import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiPost } from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import { FormError, Field } from './form-helpers';
import { twoFactorVerifyResponseSchema } from '@nexter/contracts';
import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useState, type FormEvent } from 'react';
import { useAuthVisual } from './auth-visual';

export function TwoFactorPage() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [shake, setShake] = useState(false);
  const visual = useAuthVisual();

  useEffect(() => {
    visual.reset();
    // Reset the shared logo state when the 2FA screen mounts.
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      await apiPost('/api/v1/auth/2fa/verify', { code }, twoFactorVerifyResponseSchema);
      visual.setState('ok');
      visual.setLit(12);
      await new Promise((resolve) => window.setTimeout(resolve, 280));
      await navigate({ to: '/dashboard' });
    } catch (requestError) {
      setError(toRussianError(requestError, 'Не удалось подтвердить код.'));
      visual.setState('error');
      visual.setLit(0);
      setShake(true);
      window.setTimeout(() => {
        setShake(false);
        visual.setState('idle');
        visual.setLit(Math.min(12, code.length * 2));
      }, 650);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="text-center">
        <h1 className="text-xl font-semibold">Двухфакторная проверка</h1>
        <p className="mt-1 text-sm">Введите шестизначный код из приложения-аутентификатора.</p>
      </div>

      {error ? <FormError>{error}</FormError> : null}

      <form className={`space-y-4 ${shake ? 'auth-shake' : ''}`} onSubmit={submit}>
        <Field label="Код">
          <Input
            className="auth-code-input"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            autoComplete="one-time-code"
            value={code}
            onChange={(event) => {
              const next = event.target.value.replace(/\D/g, '');
              setCode(next);
              visual.setLit(Math.min(12, next.length * 2));
              if (visual.state === 'error') visual.setState('idle');
            }}
            required
          />
        </Field>

        <Button className="w-full" type="submit" disabled={loading}>
          {loading ? 'Проверяем…' : 'Подтвердить'}
        </Button>
      </form>

      <div className="text-center text-sm">
        <Link className="hover:text-zinc-900" to="/recovery">
          Использовать recovery code
        </Link>
      </div>
    </div>
  );
}
