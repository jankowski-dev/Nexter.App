import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiPost } from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import { FormError, Field } from './form-helpers';
import { twoFactorVerifyResponseSchema } from '@nexter/contracts';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';

export function RecoveryPage() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      await apiPost('/api/v1/auth/recovery/verify', { code }, twoFactorVerifyResponseSchema);
      await navigate({ to: '/dashboard' });
    } catch (requestError) {
      setError(toRussianError(requestError, 'Не удалось использовать recovery code.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900">Recovery code</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Введите один из кодов, сохранённых при настройке. Он будет использован один раз.
        </p>
      </div>

      {error ? <FormError>{error}</FormError> : null}

      <form className="space-y-4" onSubmit={submit}>
        <Field label="Recovery code">
          <Input
            autoComplete="off"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            required
          />
        </Field>

        <Button className="w-full" type="submit" disabled={loading}>
          {loading ? 'Проверяем…' : 'Подтвердить'}
        </Button>
      </form>

      <div className="flex justify-between text-sm text-zinc-500">
        <Link className="hover:text-zinc-900" to="/2fa">
          Вернуться к TOTP
        </Link>
        <Link className="hover:text-zinc-900" to="/reset-password">
          Сбросить пароль
        </Link>
      </div>
    </div>
  );
}
