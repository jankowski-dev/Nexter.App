import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError, apiPost } from '@/lib/api';
import { FormError, Field } from './form-helpers';
import { twoFactorVerifyResponseSchema } from '@nexter/contracts';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';

export function TwoFactorPage() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      await apiPost('/api/v1/auth/2fa/verify', { code }, twoFactorVerifyResponseSchema);
      await navigate({ to: '/dashboard' });
    } catch (requestError) {
      setError(
        requestError instanceof ApiError ? requestError.message : 'Не удалось подтвердить код.',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-zinc-50">Двухфакторная проверка</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Введите шестизначный код из приложения-аутентификатора.
        </p>
      </div>

      {error ? <FormError>{error}</FormError> : null}

      <form className="space-y-4" onSubmit={submit}>
        <Field label="Код">
          <Input
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            autoComplete="one-time-code"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
            required
          />
        </Field>

        <Button className="w-full" type="submit" disabled={loading}>
          {loading ? 'Проверяем…' : 'Подтвердить'}
        </Button>
      </form>

      <div className="text-center text-sm text-zinc-500">
        <Link className="hover:text-zinc-300" to="/recovery">
          Использовать recovery code
        </Link>
      </div>
    </div>
  );
}
